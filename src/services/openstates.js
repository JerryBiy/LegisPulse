// ─── Open States API v3 Client ────────────────────────────────
// Fetches Georgia General Assembly events + associated bills.
// Docs: https://v3.openstates.org/docs
// Requires VITE_OPENSTATES_API_KEY in .env

const OPENSTATES_BASE = "https://v3.openstates.org";
const API_KEY = import.meta.env.VITE_OPENSTATES_API_KEY;

// Use the human-readable name — the OCD ID intermittently causes 400 errors
// when percent-encoded by the browser's URL constructor.
const GA_JURISDICTION = "Georgia";

/**
 * Generic GET helper with API-key auth and retry for transient errors.
 * @param {string} path
 * @param {Record<string, string | string[]>} [params]
 * @param {number} [retries=2]
 */
async function get(path, params = {}, retries = 2) {
  if (!API_KEY) {
    console.warn(
      "VITE_OPENSTATES_API_KEY is not set — skipping Open States fetch.",
    );
    return null;
  }

  const url = new URL(path, OPENSTATES_BASE);
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    // Support repeated params (e.g. include=a&include=b)
    if (Array.isArray(v)) {
      v.forEach((val) => url.searchParams.append(k, val));
    } else {
      url.searchParams.set(k, v);
    }
  });

  const res = await fetch(url.toString(), {
    headers: {
      "X-API-KEY": API_KEY,
      Accept: "application/json",
    },
  });

  // Retry on transient errors (rate-limit 429, server errors 500+, and the
  // intermittent 400s the API sometimes sends)
  if (
    !res.ok &&
    retries > 0 &&
    [400, 429, 500, 502, 503, 504].includes(res.status)
  ) {
    const delay = res.status === 429 ? 4000 : 1500;
    console.warn(
      `Open States API ${res.status} — retrying in ${delay}ms (${retries} left)`,
    );
    await new Promise((r) => setTimeout(r, delay));
    return get(path, params, retries - 1);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Open States API ${res.status}: ${text.slice(0, 300)}`);
  }

  return res.json();
}

/**
 * Fetch Georgia legislative events within a date range.
 *
 * Open States v3 GET /events
 * Query params:
 *   jurisdiction  – e.g. "Georgia" or the OCD id
 *   after         – ISO date string, limit to events starting after this date
 *   before        – ISO date string, limit to events starting before this date
 *   per_page      – max results per page (max 20 for events endpoint)
 *   page          – 1-indexed
 *
 * Each event includes:
 *   - name, description, classification, start_date, end_date
 *   - location { name, url }
 *   - links [{ url, note }]
 *   - participants [{ name, entity_type, note }]
 *   - agenda [{ description, related_entities [{ name, entity_type, ... }] }]
 *     (related_entities contain associated bills)
 *
 * @param {string} [startDate] ISO string
 * @param {string} [endDate]   ISO string
 * @returns {Promise<Array>} normalised events
 */
export async function fetchGAEvents(startDate, endDate, maxPages = 5) {
  if (!API_KEY) return [];

  const allEvents = [];
  let page = 1;
  // The events endpoint rejects per_page > 20 with a 400
  const perPage = 20;

  // Paginate through all results
  while (true) {
    let data;
    try {
      data = await get("/events", {
        jurisdiction: GA_JURISDICTION,
        after: startDate ? startDate.slice(0, 10) : undefined,
        before: endDate ? endDate.slice(0, 10) : undefined,
        per_page: String(perPage),
        page: String(page),
        // Only request the fields we use: links for URLs, agenda for bills,
        // participants for committee/speaker info.
        include: ["links", "agenda", "participants"],
      });
    } catch (err) {
      // On rate-limit or network error mid-pagination, return what we have so far
      console.warn("Open States pagination stopped:", err.message);
      break;
    }

    if (!data || !data.results || data.results.length === 0) break;

    allEvents.push(...data.results);

    // If we got fewer than perPage, we're done
    if (data.results.length < perPage) break;
    page++;

    // Safety cap — caller can raise this for historical backfills
    if (page > maxPages) break;
  }

  return allEvents.map(normalizeEvent);
}

/**
 * Fetch a single event's details (includes full agenda + related bills).
 * @param {string} eventId  Open States event ID (e.g. "ocd-event/…")
 */
export async function fetchGAEventDetail(eventId) {
  if (!API_KEY) return null;

  // The v3 API uses the full OCD ID as path:
  // GET /events/{event_id}
  const data = await get(`/events/${encodeURIComponent(eventId)}`, {
    include: ["links", "agenda", "participants"],
  });
  if (!data) return null;
  return normalizeEvent(data);
}

// ─── Normalise into a calendar-friendly shape ────────────────
function normalizeEvent(ev) {
  // Collect associated bills from agenda items
  const bills = [];
  const seenBillIds = new Set();
  (ev.agenda ?? []).forEach((item) => {
    (item.related_entities ?? []).forEach((rel) => {
      // Bills are nested in rel.bill object per the v3 schema
      if (rel.bill) {
        const billId = rel.bill.id ?? rel.bill.identifier;
        if (billId && !seenBillIds.has(billId)) {
          seenBillIds.add(billId);
          bills.push({
            id: rel.bill.id ?? null,
            identifier: rel.bill.identifier ?? rel.name ?? "Unknown",
            title: rel.bill.title ?? "",
            session: rel.bill.session ?? "",
            openstates_url: rel.bill.openstates_url ?? "",
            note: item.description ?? "",
          });
        }
      }
    });
  });

  // Participants (committees, speakers, etc.)
  const participants = (ev.participants ?? []).map((p) => ({
    name: p.name,
    role: p.note ?? p.entity_type ?? "",
  }));

  // Location
  const locationName = ev.location?.name ?? "";
  const locationUrl = ev.location?.url ?? "";

  // Links
  const links = (ev.links ?? []).map((l) => ({
    url: l.url,
    note: l.note ?? "",
  }));

  // Check if Open States already provided a link to a *specific* video
  // (not a generic channel/streams page).
  const videoLink = links.find((l) => {
    const u = (l.url ?? "").toLowerCase();
    const n = (l.note ?? "").toLowerCase();
    const isVideoRelated =
      u.includes("vimeo.com/") ||
      u.includes("youtube.com/watch") ||
      u.includes("youtu.be/") ||
      n.includes("video");
    // Exclude generic channel/streams pages — we build better URLs ourselves
    const isGenericChannel =
      u.includes("/streams") ||
      u.includes("/@") ||
      u.match(/youtube\.com\/(channel|c|user)\//);
    return isVideoRelated && !isGenericChannel;
  });

  // Build start/end times
  const startTime = ev.start_date || new Date().toISOString();
  // end_date can be "" (empty string) from the API — treat as missing
  const endTime =
    (ev.end_date && ev.end_date.length > 0 ? ev.end_date : null) ??
    (ev.end && ev.end.length > 0 ? ev.end : null) ??
    // Default: 1 hour after start
    new Date(new Date(startTime).getTime() + 3600000).toISOString();

  // All-day heuristic: if the time portion is midnight or missing
  const allDay =
    ev.all_day === true ||
    startTime.length <= 10 ||
    startTime.endsWith("T00:00:00+00:00");

  // Determine chamber color from event name
  const nameLower = (ev.name ?? "").toLowerCase();
  const eventColor = nameLower.startsWith("senate")
    ? "leg-senate"
    : nameLower.startsWith("house")
      ? "leg-house"
      : "gold";

  // Derive video link — build a channel-specific YouTube search URL
  // that targets the exact committee name + date for the event.
  let videoUrl = videoLink ? videoLink.url : null;
  if (!videoUrl) {
    const channel = nameLower.startsWith("senate")
      ? "@GeorgiaStateSenate"
      : nameLower.startsWith("house")
        ? "@georgiahouseofreps"
        : null;
    if (channel) {
      // Extract committee name: strip "Senate " or "House " prefix
      const committeeName = (ev.name ?? "")
        .replace(/^(Senate|House)\s+/i, "")
        .trim();
      // Format the date portion for the search query
      let dateQuery = "";
      try {
        const d = new Date(startTime);
        if (!isNaN(d.getTime())) {
          const months = [
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December",
          ];
          dateQuery = `${months[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`;
        }
      } catch {
        // ignore
      }
      const query = [committeeName, dateQuery].filter(Boolean).join(" ");
      videoUrl = `https://www.youtube.com/${channel}/search?query=${encodeURIComponent(query)}`;
    }
  }

  return {
    // Core fields — compatible with our calendar event shape
    id: ev.id,
    title: ev.name ?? "GA Legislature Event",
    description: ev.description ?? "",
    start_time: startTime,
    end_time: endTime,
    all_day: allDay,
    color: eventColor,
    location: locationName,
    location_url: locationUrl,

    // Legislative-specific
    classification: ev.classification ?? "",
    bills,
    participants,
    links,
    videoUrl,
    scheduleUrl: "https://www.legis.ga.gov/schedule/all",

    // Marker
    _source: "openstates",
  };
}

// ═══════════════════════════════════════════════════════════════
// Committee-related API functions
// ═══════════════════════════════════════════════════════════════

const GRAPHQL_URL = "/api/openstates-graphql";

/**
 * Execute a GraphQL query against the Open States GraphQL API.
 * Uses the same API key as the REST API.
 */
async function graphql(query, variables = {}) {
  if (!API_KEY) return null;

  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "X-API-KEY": API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Open States GraphQL ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`Open States GraphQL error: ${json.errors[0].message}`);
  }
  return json.data;
}

/**
 * Fetch all committees (organizations) for a given chamber via GraphQL.
 * @param {"upper"|"lower"} chamber  "upper" = Senate, "lower" = House
 * @returns {Promise<Array<{id:string, name:string, chamber:string, parent:string|null}>>}
 */
export async function fetchGACommittees(chamber) {
  if (!API_KEY) return [];

  const chamberLabel = chamber === "upper" ? "Senate" : "House";

  const query = `
    {
      jurisdiction(name: "Georgia") {
        organizations(classification: "committee", first: 100) {
          edges {
            node {
              id
              name
              classification
              parent {
                name
              }
            }
          }
        }
      }
    }
  `;

  try {
    const data = await graphql(query);
    const orgs = data?.jurisdiction?.organizations?.edges ?? [];

    return orgs
      .map((e) => e.node)
      .filter((org) => {
        // Filter by chamber based on parent org name
        const parent = (org.parent?.name ?? "").toLowerCase();
        if (chamber === "upper") return parent.includes("senate");
        if (chamber === "lower") return parent.includes("house");
        return true;
      })
      .map((org) => ({
        id: org.id,
        name: org.name,
        chamber: chamberLabel,
        parent: org.parent?.name ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    console.warn("Open States committees fetch failed:", err.message);
    return [];
  }
}

/**
 * Fetch bills associated with a committee via GraphQL.
 * Uses searchQuery to find candidates, then verifies each bill has the
 * committee in its action relatedEntities (referral, committee-passage, etc.).
 * @param {string} committeeName
 * @param {"upper"|"lower"} chamber
 * @returns {Promise<Array>}
 */
export async function fetchBillsByCommittee(committeeName, chamber) {
  if (!API_KEY) return [];

  const chamberParam = chamber === "upper" ? "upper" : "lower";
  const committeeNameLower = committeeName.toLowerCase();

  // Use GraphQL to search for candidate bills and pull relatedEntities
  // to verify committee assignment
  let allBills = [];
  let cursor = null;
  const PAGE_SIZE = 100;
  const MAX_PAGES = 5;

  for (let page = 0; page < MAX_PAGES; page++) {
    const afterClause = cursor ? `, after: "${cursor}"` : "";
    const query = `{
      bills(
        jurisdiction: "Georgia",
        chamber: "${chamberParam}",
        searchQuery: "${committeeName.replace(/"/g, '\\"')}",
        first: ${PAGE_SIZE}${afterClause}
      ) {
        edges {
          cursor
          node {
            id
            identifier
            title
            openstatesUrl
            abstracts { abstract }
            sponsorships { name classification primary }
            actions {
              description
              date
              classification
              organization { name classification }
              relatedEntities { name entityType }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }`;

    let data;
    try {
      data = await graphql(query);
    } catch (err) {
      console.warn("GraphQL bills-by-committee fetch failed:", err.message);
      break;
    }

    const edges = data?.bills?.edges ?? [];
    if (edges.length === 0) break;

    allBills.push(...edges.map((e) => e.node));

    if (!data.bills.pageInfo.hasNextPage) break;
    cursor = data.bills.pageInfo.endCursor;
  }

  // Filter to bills that actually reference this committee in action relatedEntities
  const verifiedBills = allBills.filter((bill) =>
    (bill.actions ?? []).some((action) =>
      (action.relatedEntities ?? []).some(
        (re) =>
          re.entityType === "organization" &&
          re.name.toLowerCase() === committeeNameLower,
      ),
    ),
  );

  // Normalize bills
  return verifiedBills.map((bill) => {
    const actions = (bill.actions ?? []).map((a) => ({
      description: a.description,
      date: a.date,
      classification: a.classification,
      chamber: a.organization?.classification ?? "",
      organization: a.organization?.name ?? "",
      relatedEntities: a.relatedEntities ?? [],
    }));

    // Committee-relevant actions (referral, passage, etc.)
    const committeeActions = actions.filter((a) =>
      (a.relatedEntities ?? []).some(
        (re) =>
          re.entityType === "organization" &&
          re.name.toLowerCase() === committeeNameLower,
      ),
    );

    // Determine if the bill's LAST committee-related action is for THIS committee
    const lastCommitteeAction = [...actions]
      .reverse()
      .find((a) =>
        (a.relatedEntities ?? []).some(
          (re) => re.entityType === "organization",
        ),
      );
    const isCurrentlyAssigned =
      lastCommitteeAction &&
      (lastCommitteeAction.relatedEntities ?? []).some(
        (re) =>
          re.entityType === "organization" &&
          re.name.toLowerCase() === committeeNameLower,
      );

    const sponsors = (bill.sponsorships ?? []).map((s) => ({
      name: s.name,
      role:
        s.classification === "primary" || s.primary ? "primary" : "cosponsor",
      party: s.party ?? "",
    }));

    const lastAction = actions[actions.length - 1];

    return {
      id: bill.id,
      identifier: bill.identifier,
      title: bill.title,
      session: "",
      chamber: chamberParam === "upper" ? "Senate" : "House",
      openstates_url: bill.openstatesUrl ?? "",
      latest_action: lastAction?.description ?? "",
      latest_action_date: lastAction?.date ?? "",
      actions,
      committeeActions,
      isCurrentlyAssigned: !!isCurrentlyAssigned,
      sponsors,
      abstract: bill.abstracts?.[0]?.abstract ?? "",
    };
  });
}
