// server/lcRecheck.js
//
// Background tracker for the LC (Legislative Counsel draft) number of
// EVERY bill in the active Georgia session, run from the Render Node
// server (legis.ga.gov firewalls Supabase's edge IPs, so the scrape
// can't run from a Supabase Edge Function — see git history for the
// retired supabase/functions/lc-recheck function).
//
// Source of truth: legis.ga.gov's own (reverse-engineered) API.
//   1. Enumerate all legislation via POST /api/Legislation/Search.
//   2. For each bill, read GET /api/legislation/Detail/{id}; the
//      `versions[]` list carries the LC number in each version name
//      (e.g. "Sen Ctee Sub :LC 59 0475S"). The newest version that
//      carries an LC token is the bill's current LC number.
//
// Detected changes are written to the global `bill_lc_history` table
// so every user (personal or team) sees the update without clicking
// Sync.
//
// ── Efficiency ───────────────────────────────────────────────────
// Fetching a detail page for ~5,500 bills every run would be slow, so
// the job is incremental:
//   • Enumeration (Search) is cheap (~55 calls) and runs every time to
//     pick up new bills and status changes.
//   • A bill's version list only changes when its status advances, so
//     we store each bill's `status_date` and only re-fetch the detail
//     page when that date moves (or the bill is new / has no LC yet).
//     Steady-state runs therefore touch only a handful of bills.
//   • The first (cold) run backfills every bill; subsequent runs are
//     cheap. An optional wall-clock budget keeps HTTP-triggered runs
//     responsive.
//
// ── Environment variables ────────────────────────────────────────
//   SUPABASE_URL                - required (project URL)
//   SUPABASE_SERVICE_ROLE_KEY   - required (service-role key, writes)
//   LEGISCAN_SESSION_ID         - required LegiScan session_id
//   LEGIS_GA_SESSION_ID         - required matching legis.ga.gov session id
//   LC_RECHECK_SECRET           - optional shared secret for the HTTP
//                                 trigger (header x-recheck-secret)
//   LC_RECHECK_INTERVAL_MS      — optional scheduler interval (ms)

import dns from "node:dns";
import { webcrypto as crypto } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// Prefer IPv4 — some hosts publish flaky AAAA records.
try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  /* older Node — ignore */
}

// ── legis.ga.gov API constants (mirror of src/services/legisGa.js) ─
const LEGIS_GA_BASE = "https://www.legis.ga.gov/api";
const LEGISLATIVE_STATE = "GA";
const OBSCURE_KEY = "jVEXFFwSu36BwwcP83xYgxLAhLYmKk";
const TOKEN_SALT = "QFpCwKfd7f";
const TOKEN_CONST = "letvarconst";

const CHAMBER_SHORT = { 1: "H", 2: "S", 3: "J" };
const DOC_SHORT = { 1: "B", 2: "R" };

const SEARCH_PAGE_SIZE = 100;
const DETAIL_CONCURRENCY = 8;
const FLUSH_EVERY = 250;

// ── LC extraction ────────────────────────────────────────────────
// Version names look like: "LC 33 9902S/RCS", "Sen Ctee Sub :LC 59
// 0475S", "LC 44 3392/a". Pull the LC token out and normalise to
// upper-case so case-only re-issues don't read as a change.
const LC_REGEX = /LC\s+\d+\s+\d+[A-Za-z]*(?:\/[A-Za-z]+)?/i;

function extractLcFromName(name) {
  if (!name) return null;
  const m = String(name).match(LC_REGEX);
  if (!m) return null;
  return m[0].replace(/\s+/g, " ").trim().toUpperCase();
}

/** Newest version (highest versionNumber) whose name carries an LC token. */
function currentLcFromVersions(versions) {
  if (!Array.isArray(versions) || versions.length === 0) return null;
  const sorted = [...versions].sort(
    (a, b) => (b?.versionNumber ?? 0) - (a?.versionNumber ?? 0),
  );
  for (const v of sorted) {
    const lc = extractLcFromName(String(v?.name ?? ""));
    if (lc) return lc;
  }
  return null;
}

// ── Token handling ───────────────────────────────────────────────
let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function sha512Hex(input) {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-512", data);
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function fetchToken() {
  const ms = Date.now();
  const key = await sha512Hex(TOKEN_SALT + OBSCURE_KEY + TOKEN_CONST + ms);
  const res = await fetch(
    `${LEGIS_GA_BASE}/authentication/token?key=${key}&ms=${ms}`,
  );
  if (!res.ok) throw new Error(`legis token request failed: ${res.status}`);
  const raw = await res.text();
  cachedToken = raw.trim().replace(/^"|"$/g, "");
  cachedTokenExpiresAt = ms + 4.5 * 60 * 1000; // refresh 30s before 5min expiry
  return cachedToken;
}

async function getToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken;
  return fetchToken();
}

async function legisGaFetch(
  path,
  { method = "GET", body, retry = true } = {},
) {
  const token = await getToken();
  const res = await fetch(`${LEGIS_GA_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && retry) {
    cachedToken = null;
    cachedTokenExpiresAt = 0;
    return legisGaFetch(path, { method, body, retry: false });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `legis.ga.gov ${method} ${path} ${res.status} ${text.slice(0, 120)}`,
    );
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── Session + enumeration ────────────────────────────────────────
async function getCurrentGaSessionId() {
  // Committee 87 (Ag & Consumer Affairs) is long-standing; its detail
  // payload carries the current sessionId.
  const data = await legisGaFetch("/committees/details/87");
  return data?.sessionId ?? null;
}

/**
 * This LegiScan session id scopes database rows only. It is not the unrelated
 * legis.ga.gov sessionId consumed by the scraper endpoints below.
 */
function getConfiguredLegiscanSessionId() {
  const raw = String(process.env.LEGISCAN_SESSION_ID ?? "").trim();
  if (!/^\d+$/.test(raw)) return null;
  const sessionId = Number(raw);
  return Number.isSafeInteger(sessionId) && sessionId > 0 ? sessionId : null;
}

function getConfiguredGaSessionId() {
  const raw = String(process.env.LEGIS_GA_SESSION_ID ?? "").trim();
  if (!/^\d+$/.test(raw)) return null;
  const sessionId = Number(raw);
  return Number.isSafeInteger(sessionId) && sessionId > 0 ? sessionId : null;
}

function buildBillNumber(b) {
  const chamber = CHAMBER_SHORT[b?.chamberType];
  const doc = DOC_SHORT[b?.documentType];
  const num = b?.number;
  if (!chamber || !doc || num == null) return null;
  const suffix = b?.suffix ? String(b.suffix).trim() : "";
  return `${chamber}${doc}${num}${suffix}`.toUpperCase();
}

async function enumerateAllBills(gaSessionId) {
  const out = [];
  let page = 0;
  let total = Infinity;
  while (page * SEARCH_PAGE_SIZE < total && page < 300) {
    const data = await legisGaFetch(
      `/Legislation/Search/${SEARCH_PAGE_SIZE}/${page}`,
      { method: "POST", body: { sessionId: gaSessionId } },
    );
    const results = data?.results ?? [];
    if (typeof data?.resultCount === "number") total = data.resultCount;
    for (const r of results) {
      const bill_number = buildBillNumber(r);
      if (!bill_number || !r?.legislationId) continue;
      out.push({
        bill_number,
        legislation_id: r.legislationId,
        status_date: String(r?.statusDate ?? ""),
      });
    }
    if (results.length < SEARCH_PAGE_SIZE) break;
    page += 1;
  }
  // De-dupe by bill_number (keep first seen).
  const seen = new Map();
  for (const r of out) if (!seen.has(r.bill_number)) seen.set(r.bill_number, r);
  return [...seen.values()];
}

async function fetchCurrentLc(legislationId) {
  const data = await legisGaFetch(`/legislation/Detail/${legislationId}`);
  return currentLcFromVersions(data?.versions ?? []);
}

// ── Main entry point ─────────────────────────────────────────────
// Runs are serialised: a second concurrent call is a no-op that
// returns { skipped: true }.
let running = false;

/**
 * @param {object} [opts]
 * @param {number} [opts.budgetMs] Wall-clock budget; 0 = unlimited.
 * @returns {Promise<object>} summary
 */
export async function runLcRecheck({ budgetMs = 0 } = {}) {
  const legiscanSessionId = getConfiguredLegiscanSessionId();
  const configuredGaSessionId = getConfiguredGaSessionId();
  if (!legiscanSessionId || !configuredGaSessionId) {
    const reason =
      "LEGISCAN_SESSION_ID and LEGIS_GA_SESSION_ID must define an explicit provider-session mapping";
    console.warn(`[lc-recheck] skipped: ${reason}`);
    return { skipped: true, reason, state: LEGISLATIVE_STATE };
  }
  if (running) return { skipped: true, reason: "already running" };
  running = true;
  const startedAt = Date.now();
  const overBudget = () => budgetMs > 0 && Date.now() - startedAt > budgetMs;

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    running = false;
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for lc-recheck",
    );
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  try {
    // 1. Resolve the independent legis.ga.gov source session and enumerate it.
    // `legiscanSessionId` is deliberately never passed to this source API.
    const gaSessionId = await getCurrentGaSessionId();
    if (!gaSessionId) {
      throw new Error("could not resolve current legis.ga.gov sessionId");
    }
    if (Number(gaSessionId) !== configuredGaSessionId) {
      throw new Error(
        `configured legis.ga.gov session ${configuredGaSessionId} does not match current provider session ${gaSessionId}`,
      );
    }
    console.log(
      `[lc-recheck] DB scope state=${LEGISLATIVE_STATE} ` +
        `LegiScan session_id=${legiscanSessionId}; ` +
        `source legis.ga.gov sessionId=${gaSessionId}`,
    );
    const allBills = await enumerateAllBills(gaSessionId);

    // 2. Load existing history to compute the incremental work set.
    const { data: existingRows, error: histErr } = await supabase
      .from("bill_lc_history")
      .select(
        "bill_number, current_lc, previous_lc, lc_changed_at, status_date",
      )
      .eq("state", LEGISLATIVE_STATE)
      .eq("session_id", legiscanSessionId);
    if (histErr) throw new Error(`history read failed: ${histErr.message}`);
    const existingMap = new Map();
    for (const r of existingRows ?? []) existingMap.set(r.bill_number, r);

    // A bill needs a detail fetch when it is new, has never resolved an
    // LC, or its status date advanced since we last looked.
    const workSet = allBills.filter((b) => {
      const ex = existingMap.get(b.bill_number);
      if (!ex) return true;
      if (!ex.current_lc) return true;
      return (ex.status_date ?? "") !== b.status_date;
    });

    // 3. Detail fetch + change detection (optionally time-boxed).
    const now = new Date().toISOString();
    let pending = [];
    const changes = [];
    let processed = 0;
    let resolved = 0;

    const flush = async () => {
      if (!pending.length) return;
      const batch = pending;
      pending = [];
      const { error } = await supabase
        .from("bill_lc_history")
        .upsert(batch, { onConflict: "state,session_id,bill_number" });
      if (error) {
        throw new Error(`history upsert failed: ${error.message}`);
      }
    };

    let timedOut = false;
    for (let i = 0; i < workSet.length; i += DETAIL_CONCURRENCY) {
      if (overBudget()) {
        timedOut = true;
        break;
      }
      const chunk = workSet.slice(i, i + DETAIL_CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map((b) =>
          fetchCurrentLc(b.legislation_id).then((lc) => ({ b, lc })),
        ),
      );
      for (const r of results) {
        if (r.status !== "fulfilled") continue; // retry next run (status_date unchanged)
        const { b, lc } = r.value;
        processed += 1;
        const ex = existingMap.get(b.bill_number);
        const oldLc = ex?.current_lc ?? null;
        // Never drop a known LC if a later (LC-less) version appears.
        const newLc = lc ?? oldLc;
        if (newLc) resolved += 1;
        const isChange = oldLc !== null && newLc !== null && oldLc !== newLc;
        pending.push({
          state: LEGISLATIVE_STATE,
          session_id: legiscanSessionId,
          bill_number: b.bill_number,
          legislation_id: b.legislation_id,
          status_date: b.status_date,
          current_lc: newLc,
          previous_lc: isChange ? oldLc : (ex?.previous_lc ?? null),
          lc_changed_at: isChange ? now : (ex?.lc_changed_at ?? null),
          updated_at: now,
        });
        if (isChange) {
          changes.push({
            bill_number: b.bill_number,
            previous_lc: oldLc,
            current_lc: newLc,
          });
        }
      }
      if (pending.length >= FLUSH_EVERY) await flush();
    }
    await flush();

    // 4. Mirror changed LC numbers into per-user `bills.lc_number` so
    //    already-tracked cards reflect the new value immediately.
    for (const c of changes) {
      const { error: mirrorError } = await supabase
        .from("bills")
        .update({ lc_number: c.current_lc })
        .eq("state", LEGISLATIVE_STATE)
        .eq("session_id", legiscanSessionId)
        .eq("bill_number", c.bill_number);
      if (mirrorError) {
        throw new Error(
          `bill LC mirror update failed for ${c.bill_number}: ${mirrorError.message}`,
        );
      }
    }

    const summary = {
      state: LEGISLATIVE_STATE,
      legiscanSessionId,
      gaSessionId,
      totalBills: allBills.length,
      work: workSet.length,
      processed,
      resolved,
      changed: changes.length,
      remaining: Math.max(0, workSet.length - processed),
      timedOut,
      tookMs: Date.now() - startedAt,
      changes,
    };
    console.log(
      `[lc-recheck] state=${summary.state} ` +
        `LegiScanSession=${summary.legiscanSessionId} ` +
        `gaSession=${summary.gaSessionId} total=${summary.totalBills} ` +
        `work=${summary.work} ` +
        `processed=${summary.processed} resolved=${summary.resolved} ` +
        `changed=${summary.changed} timedOut=${summary.timedOut} ` +
        `tookMs=${summary.tookMs}`,
    );
    return summary;
  } finally {
    running = false;
  }
}

/**
 * Start the recurring background scan. Runs once shortly after boot,
 * then every `LC_RECHECK_INTERVAL_MS` (default 1h). No-ops if Supabase
 * credentials are missing so local/dev servers don't crash.
 */
export function startLcRecheckScheduler() {
  const legiscanSessionId = getConfiguredLegiscanSessionId();
  const configuredGaSessionId = getConfiguredGaSessionId();
  if (!legiscanSessionId || !configuredGaSessionId) {
    console.log(
      "[lc-recheck] scheduler disabled " +
        "(LEGISCAN_SESSION_ID and LEGIS_GA_SESSION_ID must be mapped)",
    );
    return;
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log("[lc-recheck] scheduler disabled (no Supabase service creds)");
    return;
  }
  const interval = Number(process.env.LC_RECHECK_INTERVAL_MS) || 60 * 60 * 1000;
  const tick = () => {
    runLcRecheck({ budgetMs: 0 }).catch((err) =>
      console.error("[lc-recheck] scheduled run failed:", err.message),
    );
  };
  // First run 20s after boot so it doesn't compete with cold-start traffic.
  setTimeout(tick, 20_000);
  setInterval(tick, interval);
  console.log(
    `[lc-recheck] scheduler started for ${LEGISLATIVE_STATE} ` +
      `LegiScan session_id=${legiscanSessionId} ` +
      `legis.ga.gov sessionId=${configuredGaSessionId} (every ${interval}ms)`,
  );
}
