// Official Georgia General Assembly X early-alert collector.
//
// X posts are a fast signal, not legislative truth. This job never updates
// public.bills or legislative_bill_cache. It stores the post, detects a small
// allowlist of meaningful movement phrases, and asks Postgres to notify only
// users who personally track (or actively share a team containing) the exact
// session + bill type + bill number.

import { createClient } from "@supabase/supabase-js";

const X_RECENT_SEARCH_URL = "https://api.x.com/2/tweets/search/recent";
const LEGISLATIVE_STATE = "GA";
const DEFAULT_HANDLES = ["GAHouseHub", "GASenatePress"];
const BILL_TYPES = new Set(["HB", "HR", "SB", "SR"]);
const MAX_X_PAGES = 5;

const MOVEMENT_RULES = [
  {
    type: "vetoed",
    confidence: 0.98,
    pattern: /\b(?:vetoed|vetoes|veto)\b/i,
  },
  {
    type: "signed",
    confidence: 0.98,
    pattern: /\b(?:signed(?:\s+into\s+law)?|signs(?:\s+into\s+law)?)\b/i,
  },
  {
    type: "sent_to_governor",
    confidence: 0.96,
    pattern:
      /\b(?:sent|transmitted|delivered|headed)\s+to\s+(?:the\s+)?governor\b/i,
  },
  {
    type: "failed",
    confidence: 0.96,
    pattern:
      /\b(?:failed(?:\s+to\s+pass)?|did\s+not\s+pass|defeated|motion\s+lost)\b/i,
  },
  {
    type: "passed_by_substitute",
    confidence: 0.94,
    pattern:
      /\b(?:passed\s+by\s+substitute|substitute\s+(?:was\s+)?(?:adopted|passed)|(?:adopted|passed)\s+(?:a\s+)?(?:committee\s+)?substitute)\b/i,
  },
  {
    type: "passed_committee",
    confidence: 0.93,
    pattern:
      /\b(?:(?:passed|approved|reported\s+favorably)\s+(?:the\s+)?(?:[\w& -]+\s+)?committee|committee\s+(?:passed|approved|reported\s+favorably|gave\s+(?:a\s+)?do\s+pass))\b/i,
  },
  {
    type: "committee_hearing",
    confidence: 0.9,
    pattern:
      /\b(?:committee\s+hearing|hearing\s+(?:on|for)|(?:will\s+be|was|is|being)\s+heard|set\s+for\s+(?:a\s+)?hearing|on\s+(?:the\s+)?committee\s+agenda)\b/i,
  },
  {
    type: "assigned_to_committee",
    confidence: 0.94,
    pattern:
      /\b(?:assigned|referred|sent)\s+to\s+(?:the\s+)?[\w&' -]*committee\b/i,
  },
  {
    type: "amended",
    confidence: 0.92,
    pattern:
      /\b(?:amended|amendment(?:s)?\s+(?:was|were|is|are)?\s*adopted|adopted\s+(?:an\s+)?amendment)\b/i,
  },
  {
    type: "introduced",
    confidence: 0.92,
    pattern:
      /\b(?:introduced|filed|first\s+read|read\s+for\s+the\s+first\s+time)\b/i,
  },
  {
    type: "passed_house",
    confidence: 0.96,
    pattern:
      /\b(?:(?:passed|adopted|approved)\s+(?:by\s+)?(?:the\s+)?house|house\s+(?:passed|adopted|approved))\b/i,
  },
  {
    type: "passed_senate",
    confidence: 0.96,
    pattern:
      /\b(?:(?:passed|adopted|approved)\s+(?:by\s+)?(?:the\s+)?senate|senate\s+(?:passed|adopted|approved))\b/i,
  },
];

function normalizeHandle(value) {
  const handle = String(value ?? "")
    .trim()
    .replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : null;
}

function getMonitoredHandles() {
  const configured = String(process.env.X_MONITORED_HANDLES ?? "")
    .split(",")
    .map(normalizeHandle)
    .filter(Boolean);
  return [...new Set(configured.length > 0 ? configured : DEFAULT_HANDLES)];
}

function getConfiguredSessionIds() {
  const raw =
    String(process.env.X_LEGISCAN_SESSION_IDS ?? "").trim() ||
    String(process.env.LEGISCAN_SESSION_ID ?? "").trim();
  return new Set(
    raw
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isSafeInteger(value) && value > 0),
  );
}

function canonicalBillReference(billType, billNumber) {
  const type = String(billType ?? "").toUpperCase();
  const number = Number(billNumber);
  if (!BILL_TYPES.has(type) || !Number.isSafeInteger(number) || number <= 0) {
    return null;
  }
  return { billType: type, billNumber: number, billRef: `${type}${number}` };
}

export function extractBillReferences(text) {
  const content = String(text ?? "");
  const found = new Map();
  const add = (type, number) => {
    const reference = canonicalBillReference(type, number);
    if (reference) found.set(reference.billRef, reference);
  };

  for (const match of content.matchAll(/\b(HB|HR|SB|SR)\s*[-#:]?\s*(\d{1,5})\b/gi)) {
    add(match[1], match[2]);
  }

  for (const match of content.matchAll(
    /\b(House|Senate)\s+(Bill|Resolution)\s+(?:No\.?\s*)?(\d{1,5})\b/gi,
  )) {
    const chamber = match[1].toLowerCase() === "house" ? "H" : "S";
    const documentType = match[2].toLowerCase() === "bill" ? "B" : "R";
    add(`${chamber}${documentType}`, match[3]);
  }

  return [...found.values()];
}

function contextForBill(text, billRef) {
  const segments = String(text ?? "")
    .split(/(?<=[.!?])\s+|[\r\n]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const matching = segments.filter((segment) =>
    extractBillReferences(segment).some((item) => item.billRef === billRef),
  );
  return (matching.length > 0 ? matching.join(" ") : String(text ?? ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

function sourceChamber(accountHandle) {
  const handle = String(accountHandle ?? "").toLowerCase();
  if (handle.includes("house")) return "house";
  if (handle.includes("senate")) return "senate";
  return null;
}

export function classifyBillMovements(text, billRef, accountHandle = "") {
  const evidence = contextForBill(text, billRef);
  const movements = [];
  const seen = new Set();
  for (const rule of MOVEMENT_RULES) {
    if (rule.pattern.test(evidence) && !seen.has(rule.type)) {
      seen.add(rule.type);
      movements.push({
        type: rule.type,
        confidence: rule.confidence,
        evidence,
      });
    }
  }

  // Official floor-note posts often say only "HB 10 passes 160-5." When the
  // chamber is omitted from that sentence, the official source account is a
  // useful but lower-confidence chamber signal.
  if (
    !seen.has("passed_committee") &&
    !seen.has("passed_house") &&
    !seen.has("passed_senate") &&
    /\b(?:passes?|passed|adopts?|adopted|approves?|approved)\b/i.test(evidence)
  ) {
    const chamber = sourceChamber(accountHandle);
    if (chamber) {
      movements.push({
        type: chamber === "house" ? "passed_house" : "passed_senate",
        confidence: 0.82,
        evidence,
      });
    }
  }

  // A substitute passage already communicates committee passage; retaining
  // both would produce redundant movement labels for one action.
  if (seen.has("passed_by_substitute")) {
    return movements.filter((movement) => movement.type !== "passed_committee");
  }
  return movements;
}

function sessionYearBounds(session) {
  const name = String(session?.session_name ?? "");
  const years = [...name.matchAll(/\b(20\d{2})\b/g)].map((match) =>
    Number(match[1]),
  );
  const start = Number(session?.year_start) || years[0] || null;
  const end = Number(session?.year_end) || years.at(-1) || start;
  return { start, end };
}

function textSignalsSpecialSession(text) {
  return /\b(?:special|extraordinary)\s+(?:legislative\s+)?session\b/i.test(
    String(text ?? ""),
  );
}

function textSignalsRegularSession(text) {
  return /\bregular\s+(?:legislative\s+)?session\b/i.test(String(text ?? ""));
}

export function resolveSessionForPost({
  post,
  sessions,
  billRefs,
  cachedRefsBySession = new Map(),
  configuredSessionIds = new Set(),
}) {
  const postedYear = new Date(post.postedAt).getUTCFullYear();
  let candidates = (sessions ?? []).filter((session) => {
    const { start, end } = sessionYearBounds(session);
    return !start || !end || (postedYear >= start && postedYear <= end);
  });

  if (configuredSessionIds.size > 0) {
    candidates = candidates.filter((session) =>
      configuredSessionIds.has(Number(session.session_id)),
    );
  }

  if (billRefs.length > 0) {
    const cachedCandidates = candidates.filter((session) => {
      const sessionRefs = cachedRefsBySession.get(Number(session.session_id));
      return billRefs.some((bill) => sessionRefs?.has(bill.billRef));
    });
    if (cachedCandidates.length > 0) candidates = cachedCandidates;
  }

  if (textSignalsSpecialSession(post.content)) {
    candidates = candidates.filter((session) => Boolean(session.is_special));
  } else if (textSignalsRegularSession(post.content)) {
    candidates = candidates.filter((session) => !session.is_special);
  } else if (configuredSessionIds.size === 0) {
    // With no explicit deployment mapping, ordinary posts belong to the one
    // regular session for their year. Special-session posts must say so; this
    // prevents a same-numbered special bill from contaminating the regular
    // feed merely because both exist in the archive.
    const regularCandidates = candidates.filter((session) => !session.is_special);
    if (regularCandidates.length > 0) candidates = regularCandidates;
  }

  if (candidates.length === 1) {
    return { session: candidates[0], reason: null };
  }
  return {
    session: null,
    reason:
      candidates.length === 0
        ? "no verified session matched the post date and bill references"
        : `ambiguous across sessions ${candidates
            .map((session) => session.session_id)
            .join(", ")}`,
  };
}

function buildSearchQuery(handles) {
  return `(${handles.map((handle) => `from:${handle}`).join(" OR ")}) -is:retweet`;
}

function mapXResponsePage(payload) {
  const users = new Map(
    (payload?.includes?.users ?? []).map((user) => [String(user.id), user]),
  );
  const media = new Map(
    (payload?.includes?.media ?? []).map((item) => [item.media_key, item]),
  );
  return (payload?.data ?? []).map((post) => {
    const author = users.get(String(post.author_id)) ?? {};
    const handle = author.username || "unknown";
    const mediaUrls = (post.attachments?.media_keys ?? [])
      .map((key) => media.get(key))
      .map((item) => item?.url || item?.preview_image_url)
      .filter(Boolean);
    return {
      postId: String(post.id),
      accountId: post.author_id ? String(post.author_id) : null,
      accountName: author.name || handle,
      accountHandle: `@${handle}`,
      content: post.text || "",
      postedAt: post.created_at,
      postUrl: `https://x.com/${handle}/status/${post.id}`,
      mediaUrls,
      engagement: post.public_metrics ?? null,
      raw: post,
    };
  });
}

async function fetchRecentXPosts({ bearerToken, handles, sinceId }) {
  const posts = [];
  let nextToken = null;
  let newestId = null;

  for (let page = 0; page < MAX_X_PAGES; page += 1) {
    const url = new URL(X_RECENT_SEARCH_URL);
    url.searchParams.set("query", buildSearchQuery(handles));
    url.searchParams.set("max_results", "100");
    url.searchParams.set(
      "tweet.fields",
      "id,text,author_id,created_at,public_metrics,attachments",
    );
    url.searchParams.set("expansions", "author_id,attachments.media_keys");
    url.searchParams.set("user.fields", "id,name,username");
    url.searchParams.set(
      "media.fields",
      "media_key,type,url,preview_image_url",
    );
    if (sinceId) url.searchParams.set("since_id", sinceId);
    if (nextToken) url.searchParams.set("next_token", nextToken);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });
    if (!response.ok) {
      const message = await response.text().catch(() => "");
      throw new Error(
        `X recent search failed (${response.status}): ${message.slice(0, 300)}`,
      );
    }

    const payload = await response.json();
    posts.push(...mapXResponsePage(payload));
    newestId = payload?.meta?.newest_id || newestId;
    nextToken = payload?.meta?.next_token || null;
    if (!nextToken) break;
  }

  return { posts, newestId };
}

function rowToPost(row) {
  return {
    postId: String(row.post_id),
    accountId: row.account_id ? String(row.account_id) : null,
    accountName: row.account_name,
    accountHandle: row.account_handle,
    content: row.content,
    postedAt: row.posted_at,
    postUrl: row.post_url,
    mediaUrls: row.media_urls ?? [],
    engagement: row.engagement ?? null,
    raw: row.raw ?? null,
  };
}

async function loadSessionContext(supabase, posts, configuredSessionIds) {
  let sessionQuery = supabase
    .from("bill_session_sync_state")
    .select(
      "session_id, session_name, year_start, year_end, is_special, is_prior, last_synced_at",
    )
    .eq("state", LEGISLATIVE_STATE);
  if (configuredSessionIds.size > 0) {
    sessionQuery = sessionQuery.in("session_id", [...configuredSessionIds]);
  }
  const { data: sessions, error: sessionError } = await sessionQuery;
  if (sessionError) throw new Error(`X session lookup failed: ${sessionError.message}`);

  const billRefs = [
    ...new Set(
      posts.flatMap((post) =>
        extractBillReferences(post.content).map((bill) => bill.billRef),
      ),
    ),
  ];
  const cachedRefsBySession = new Map();
  if (billRefs.length > 0 && (sessions ?? []).length > 0) {
    const { data: cacheRows, error: cacheError } = await supabase
      .from("legislative_bill_cache")
      .select("session_id, bill_number")
      .eq("state", LEGISLATIVE_STATE)
      .in(
        "session_id",
        (sessions ?? []).map((session) => session.session_id),
      )
      .in("bill_number", billRefs);
    if (cacheError) throw new Error(`X bill lookup failed: ${cacheError.message}`);
    for (const row of cacheRows ?? []) {
      const sessionId = Number(row.session_id);
      if (!cachedRefsBySession.has(sessionId)) {
        cachedRefsBySession.set(sessionId, new Set());
      }
      cachedRefsBySession.get(sessionId).add(row.bill_number);
    }
  }
  return { sessions: sessions ?? [], cachedRefsBySession };
}

function postRow(post, sessionId, relatedBillNumbers) {
  return {
    state: LEGISLATIVE_STATE,
    session_id: sessionId,
    post_id: post.postId,
    account_id: post.accountId,
    account_name: post.accountName,
    account_handle: post.accountHandle,
    content: post.content,
    posted_at: post.postedAt,
    post_url: post.postUrl,
    related_bill_numbers: relatedBillNumbers,
    media_urls: post.mediaUrls,
    engagement: post.engagement,
    raw: post.raw,
    updated_at: new Date().toISOString(),
  };
}

let running = false;

export async function runXFeedSync() {
  if (running) return { skipped: true, reason: "already running" };
  const bearerToken = String(process.env.X_BEARER_TOKEN ?? "").trim();
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!bearerToken) return { skipped: true, reason: "X_BEARER_TOKEN is not configured" };
  if (!supabaseUrl || !serviceKey) {
    return { skipped: true, reason: "Supabase service credentials are not configured" };
  }

  running = true;
  const startedAt = Date.now();
  const handles = getMonitoredHandles();
  const configuredSessionIds = getConfiguredSessionIds();
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  try {
    const now = new Date().toISOString();
    await supabase.from("x_feed_sync_state").upsert(
      {
        state: LEGISLATIVE_STATE,
        monitored_handles: handles.map((handle) => `@${handle}`),
        last_attempt_at: now,
        updated_at: now,
      },
      { onConflict: "state" },
    );

    const { data: syncState, error: syncStateError } = await supabase
      .from("x_feed_sync_state")
      .select("last_post_id")
      .eq("state", LEGISLATIVE_STATE)
      .maybeSingle();
    if (syncStateError) throw new Error(`X sync-state read failed: ${syncStateError.message}`);

    const [{ posts: fetchedPosts, newestId }, unmatchedResult] = await Promise.all([
      fetchRecentXPosts({
        bearerToken,
        handles,
        sinceId: syncState?.last_post_id ?? null,
      }),
      supabase
        .from("x_unmatched_posts")
        .select("*")
        .eq("state", LEGISLATIVE_STATE)
        .order("posted_at", { ascending: false })
        .limit(500),
    ]);
    if (unmatchedResult.error) {
      throw new Error(`Unmatched X post read failed: ${unmatchedResult.error.message}`);
    }

    const candidateMap = new Map();
    for (const row of unmatchedResult.data ?? []) {
      candidateMap.set(String(row.post_id), rowToPost(row));
    }
    for (const post of fetchedPosts) candidateMap.set(post.postId, post);
    const candidates = [...candidateMap.values()];
    const { sessions, cachedRefsBySession } = await loadSessionContext(
      supabase,
      candidates,
      configuredSessionIds,
    );

    const resolved = [];
    const unmatched = [];
    for (const post of candidates) {
      const billRefs = extractBillReferences(post.content);
      const resolution = resolveSessionForPost({
        post,
        sessions,
        billRefs,
        cachedRefsBySession,
        configuredSessionIds,
      });
      if (!resolution.session) {
        unmatched.push({
          state: LEGISLATIVE_STATE,
          post_id: post.postId,
          account_id: post.accountId,
          account_name: post.accountName,
          account_handle: post.accountHandle,
          content: post.content,
          posted_at: post.postedAt,
          post_url: post.postUrl,
          related_bill_numbers: billRefs.map((bill) => bill.billRef),
          media_urls: post.mediaUrls,
          engagement: post.engagement,
          raw: post.raw,
          unresolved_reason: resolution.reason,
          last_attempt_at: now,
        });
        continue;
      }
      resolved.push({ post, billRefs, sessionId: Number(resolution.session.session_id) });
    }

    if (unmatched.length > 0) {
      const { error } = await supabase
        .from("x_unmatched_posts")
        .upsert(unmatched, { onConflict: "state,post_id" });
      if (error) throw new Error(`Unmatched X post write failed: ${error.message}`);
    }

    if (resolved.length > 0) {
      const { error } = await supabase.from("x_posts").upsert(
        resolved.map(({ post, billRefs, sessionId }) =>
          postRow(
            post,
            sessionId,
            billRefs.map((bill) => bill.billRef),
          ),
        ),
        { onConflict: "state,session_id,post_id" },
      );
      if (error) throw new Error(`X post write failed: ${error.message}`);

      const resolvedPostIds = resolved.map(({ post }) => post.postId);
      const { error: deleteError } = await supabase
        .from("x_unmatched_posts")
        .delete()
        .eq("state", LEGISLATIVE_STATE)
        .in("post_id", resolvedPostIds);
      if (deleteError) {
        throw new Error(`Resolved X quarantine cleanup failed: ${deleteError.message}`);
      }
    }

    let matchedBillCount = 0;
    let notifiedCount = 0;
    for (const { post, billRefs, sessionId } of resolved) {
      for (const bill of billRefs) {
        const movements = classifyBillMovements(
          post.content,
          bill.billRef,
          post.accountHandle,
        );
        if (movements.length === 0) continue;
        matchedBillCount += 1;
        const { data, error } = await supabase.rpc("record_x_bill_early_alert", {
          p_state: LEGISLATIVE_STATE,
          p_session_id: sessionId,
          p_post_id: post.postId,
          p_bill_type: bill.billType,
          p_bill_number: bill.billNumber,
          p_movements: movements,
        });
        if (error) {
          throw new Error(
            `X alert fan-out failed for ${bill.billRef}: ${error.message}`,
          );
        }
        notifiedCount += Number(data) || 0;
      }
    }

    const finishedAt = new Date().toISOString();
    const { error: finishError } = await supabase.from("x_feed_sync_state").upsert(
      {
        state: LEGISLATIVE_STATE,
        monitored_handles: handles.map((handle) => `@${handle}`),
        last_post_id: newestId || syncState?.last_post_id || null,
        last_attempt_at: now,
        last_success_at: finishedAt,
        last_error: null,
        fetched_count: fetchedPosts.length,
        matched_count: matchedBillCount,
        notified_count: notifiedCount,
        updated_at: finishedAt,
      },
      { onConflict: "state" },
    );
    if (finishError) throw new Error(`X sync-state update failed: ${finishError.message}`);

    const summary = {
      fetched: fetchedPosts.length,
      processed: candidates.length,
      resolved: resolved.length,
      unmatched: unmatched.length,
      matchedBills: matchedBillCount,
      notified: notifiedCount,
      sessionIds: [...new Set(resolved.map((item) => item.sessionId))],
      handles: handles.map((handle) => `@${handle}`),
      tookMs: Date.now() - startedAt,
    };
    console.log(
      `[x-feed] fetched=${summary.fetched} resolved=${summary.resolved} ` +
        `unmatched=${summary.unmatched} matchedBills=${summary.matchedBills} ` +
        `notified=${summary.notified} tookMs=${summary.tookMs}`,
    );
    return summary;
  } catch (error) {
    const failedAt = new Date().toISOString();
    await supabase.from("x_feed_sync_state").upsert(
      {
        state: LEGISLATIVE_STATE,
        monitored_handles: handles.map((handle) => `@${handle}`),
        last_attempt_at: failedAt,
        last_error: String(error?.message || error).slice(0, 1000),
        updated_at: failedAt,
      },
      { onConflict: "state" },
    );
    throw error;
  } finally {
    running = false;
  }
}

export function startXFeedScheduler() {
  if (!process.env.X_BEARER_TOKEN) {
    console.log("[x-feed] scheduler disabled (X_BEARER_TOKEN is not configured)");
    return;
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log("[x-feed] scheduler disabled (no Supabase service credentials)");
    return;
  }
  const interval = Math.max(
    30_000,
    Number(process.env.X_SYNC_INTERVAL_MS) || 60_000,
  );
  const tick = () => {
    runXFeedSync().catch((error) =>
      console.error("[x-feed] scheduled run failed:", error.message),
    );
  };
  setTimeout(tick, 10_000);
  setInterval(tick, interval);
  console.log(
    `[x-feed] scheduler started for ${getMonitoredHandles()
      .map((handle) => `@${handle}`)
      .join(", ")} (every ${interval}ms)`,
  );
}
