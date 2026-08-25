// ─── Legis.GA.gov private API client ─────────────────────────
// Reverse-engineered from the public legis.ga.gov Angular app.
// Auth flow:
//   1. Compute  key = SHA512("QFpCwKfd7f" + OBSCURE_KEY + "letvarconst" + ms)
//   2. GET /api/authentication/token?key={key}&ms={ms}  →  JWT string
//   3. Send "Authorization: Bearer <jwt>" on subsequent calls
// CORS is wide-open on the legis.ga.gov API, so we can call it directly
// from the browser without a proxy.

const API_BASE = "https://www.legis.ga.gov/api";
const OBSCURE_KEY = "jVEXFFwSu36BwwcP83xYgxLAhLYmKk";
const TOKEN_SALT = "QFpCwKfd7f";
const TOKEN_CONST = "letvarconst";

// Chamber type enum (matches the API's ChamberType)
export const CHAMBER = { HOUSE: 1, SENATE: 2, JOINT: 3 };
const CHAMBER_SHORT = { 1: "H", 2: "S", 3: "J" };
const CHAMBER_NAME = { 1: "House", 2: "Senate", 3: "Joint" };

// Document type enum (1 = Bill, 2 = Resolution)
const DOC_SHORT = { 1: "B", 2: "R" };

// ─── Token cache ─────────────────────────────────────────────
let cachedToken = null;
let cachedTokenExpiresAt = 0;
let pendingTokenPromise = null;

async function sha512Hex(input) {
  const data = new TextEncoder().encode(input);
  const hashBuf = await crypto.subtle.digest("SHA-512", data);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function fetchToken() {
  const ms = Date.now();
  const key = await sha512Hex(TOKEN_SALT + OBSCURE_KEY + TOKEN_CONST + ms);
  const res = await fetch(
    `${API_BASE}/authentication/token?key=${key}&ms=${ms}`,
  );
  if (!res.ok) {
    throw new Error(`legis.ga.gov token request failed: ${res.status}`);
  }
  // Response body is a JSON-encoded string (with surrounding quotes)
  const raw = await res.text();
  const jwt = raw.trim().replace(/^"|"$/g, "");
  // JWT tokens from this API expire after ~5 minutes — refresh 30s early
  cachedToken = jwt;
  cachedTokenExpiresAt = ms + 4.5 * 60 * 1000;
  return jwt;
}

async function getToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken;
  if (pendingTokenPromise) return pendingTokenPromise;
  pendingTokenPromise = fetchToken().finally(() => {
    pendingTokenPromise = null;
  });
  return pendingTokenPromise;
}

async function apiFetch(
  path,
  /** @type {{method?: string, body?: any, retry?: boolean}} */ {
    method = "GET",
    body,
    retry = true,
  } = {},
) {
  const token = await getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && retry) {
    // Token might be stale — drop cache and try once more
    cachedToken = null;
    cachedTokenExpiresAt = 0;
    return apiFetch(path, { method, body, retry: false });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `legis.ga.gov ${method} ${path} failed: ${res.status} ${text.slice(0, 200)}`,
    );
  }
  if (res.status === 204) return null;
  return res.json();
}

// ─── Sessions ────────────────────────────────────────────────
let cachedSessionDirectory = null;
let cachedSessionDirectoryAt = 0;

const configuredLegiscanSessionId = Number(
  import.meta.env.VITE_LEGIS_GA_LEGISCAN_SESSION_ID,
);
const configuredGaSessionId = Number(
  import.meta.env.VITE_LEGIS_GA_SESSION_ID,
);

const isPositiveSessionId = (value) =>
  Number.isSafeInteger(Number(value)) && Number(value) > 0;

/** Backwards-compatible check for the optional deployment override. */
export function isLegisGaSessionMapped(legiscanSessionId) {
  return (
    isPositiveSessionId(configuredLegiscanSessionId) &&
    isPositiveSessionId(configuredGaSessionId) &&
    Number(legiscanSessionId) === configuredLegiscanSessionId
  );
}

async function getSessionDirectory() {
  if (
    cachedSessionDirectory &&
    Date.now() - cachedSessionDirectoryAt < 10 * 60 * 1000
  ) {
    return cachedSessionDirectory;
  }
  const data = await apiFetch("/committees/details/87");
  cachedSessionDirectory = data ?? {};
  cachedSessionDirectoryAt = Date.now();
  return cachedSessionDirectory;
}

function sessionYears(session) {
  const explicitStart = Number(
    session?.yearStart ?? session?.year_start ?? session?.startYear,
  );
  const explicitEnd = Number(
    session?.yearEnd ?? session?.year_end ?? session?.endYear,
  );
  const label = [
    session?.name,
    session?.description,
    session?.title,
    session?.label,
    session?.sessionName,
    session?.session_name,
    session?.library,
  ]
    .filter(Boolean)
    .join(" ");
  const labelYears = [...label.matchAll(/\b(20\d{2})\b/g)].map((match) =>
    Number(match[1]),
  );
  return {
    start: explicitStart || labelYears[0] || null,
    end: explicitEnd || labelYears[1] || labelYears[0] || null,
    label,
  };
}

function normalizeProviderSession(session) {
  const id = Number(
    session?.id ??
      session?.sessionId ??
      session?.session_id ??
      session?.value ??
      session?.key,
  );
  if (!isPositiveSessionId(id)) return null;
  const { start, end, label } = sessionYears(session);
  const specialFlag =
    session?.special ??
    session?.isSpecial ??
    session?.is_special ??
    (session?.type != null ? Number(session.type) === 2 : null);
  const special =
    specialFlag == null
      ? /\bspecial\b/i.test(label)
      : specialFlag === true || Number(specialFlag) === 1;
  return {
    id,
    start,
    end,
    label:
      session?.description ||
      session?.name ||
      session?.sessionName ||
      session?.session_name ||
      label,
    library: String(session?.library || "").trim(),
    special,
  };
}

function sessionMapping(legiscanSessionId, providerSession, source) {
  const specialNumberMatch = providerSession.library.match(/EX(\d*)$/i);
  return {
    legiscanSessionId,
    gaSessionId: providerSession.id,
    gaSessionLabel: providerSession.label,
    gaSessionLibrary: providerSession.library,
    isSpecialSession: providerSession.special,
    specialSessionNumber: providerSession.special
      ? Number(specialNumberMatch?.[1] || 1)
      : null,
    yearStart: providerSession.start,
    yearEnd: providerSession.end,
    source,
  };
}

/**
 * Resolve the current provider session id from a committee detail response.
 * Cached briefly so a provider-side session change is revalidated.
 */
export async function getCurrentSessionId() {
  const data = await getSessionDirectory();
  return data?.sessionId ?? null;
}

/**
 * Resolve a LegiScan session to the separate legis.ga.gov session namespace.
 * The provider's session directory is matched by year range and regular vs.
 * special session. LegiScan IDs are never passed to legis.ga.gov endpoints.
 */
export async function resolveLegisGaSessionMapping(legiscanSession) {
  const legiscanSessionId = Number(legiscanSession?.session_id);
  if (!isPositiveSessionId(legiscanSessionId)) {
    throw new Error("A valid LegiScan session is required.");
  }

  const directory = await getSessionDirectory();
  const sessions = (Array.isArray(directory?.sessions) ? directory.sessions : [])
    .map(normalizeProviderSession)
    .filter(Boolean);
  const selectedStart = Number(legiscanSession?.year_start) || null;
  const selectedEnd = Number(legiscanSession?.year_end) || selectedStart;
  const selectedSpecial = Boolean(legiscanSession?.special);

  if (isLegisGaSessionMapped(legiscanSessionId)) {
    const configured = sessions.find(
      (session) => session.id === configuredGaSessionId,
    );
    if (!configured) {
      throw new Error(
        "The configured legis.ga.gov session is not present in the official session directory.",
      );
    }
    if (
      selectedStart &&
      (configured.start !== selectedStart ||
        configured.end !== selectedEnd ||
        configured.special !== selectedSpecial)
    ) {
      throw new Error(
        "The configured legis.ga.gov session does not match the selected LegiScan session.",
      );
    }
    return sessionMapping(legiscanSessionId, configured, "configuration");
  }

  const exact = sessions.filter(
    (session) =>
      selectedStart &&
      session.start === selectedStart &&
      session.end === selectedEnd &&
      session.special === selectedSpecial,
  );
  if (exact.length === 1) {
    return sessionMapping(
      legiscanSessionId,
      exact[0],
      "provider-directory",
    );
  }

  const currentId = Number(directory?.sessionId);
  const current = sessions.find((session) => session.id === currentId);
  if (
    isPositiveSessionId(currentId) &&
    !selectedSpecial &&
    selectedStart &&
    current?.start === selectedStart &&
    current?.end === selectedEnd &&
    !current.special
  ) {
    return sessionMapping(
      legiscanSessionId,
      current,
      "provider-current-session",
    );
  }

  throw new Error(
    "No exact legis.ga.gov session matches the selected LegiScan session.",
  );
}

/** Compatibility wrapper for callers that only have a configured ID pair. */
export async function verifyLegisGaSessionMapping(legiscanSessionId) {
  if (!isLegisGaSessionMapped(legiscanSessionId)) {
    throw new Error(
      "No verified legis.ga.gov mapping is configured for this LegiScan session.",
    );
  }
  return {
    legiscanSessionId: Number(legiscanSessionId),
    gaSessionId: configuredGaSessionId,
    source: "configuration",
  };
}

// ─── Bill versions (LC / substitute tracking) ────────────────
// Version names carry the LC number + substitute/chamber label, e.g.
// "Sen Ctee Sub :LC 59 0475S", "LC 33 9902S/RCS", "LC 44 3392/a".
const VERSION_LC_REGEX = /LC\s+\d+\s+\d+[A-Za-z]*(?:\/[A-Za-z]+)?/i;

function extractVersionLc(name) {
  const m = String(name || "").match(VERSION_LC_REGEX);
  if (!m) return null;
  return m[0].replace(/\s+/g, " ").trim().toUpperCase();
}

// Identify which chamber a version belongs to. Prefer an explicit
// committee-substitute label ("Sen Ctee Sub", "Hou Ctee Sub"); otherwise
// inspect the LC substitute suffix. The indicator is the trailing letters —
// after the last "/" when present (e.g. "9886S/HS" → HS → House,
// "9902S/RCS" → RCS → Senate), else the letters right after the number.
// "/A" (amendment) carries no chamber.
function versionChamber(name) {
  const n = String(name || "").toLowerCase();
  if (/\bsen(ate)?\b/.test(n)) return "Senate";
  if (/\bhou(se)?\b/.test(n)) return "House";
  const lc = extractVersionLc(name);
  if (!lc) return null;
  let sfx = "";
  if (lc.includes("/")) {
    sfx = lc.slice(lc.lastIndexOf("/") + 1).toUpperCase();
  } else {
    const m = lc.match(/\d+([A-Z]+)\s*$/i);
    sfx = m ? m[1].toUpperCase() : "";
  }
  if (sfx.includes("H")) return "House";
  if (sfx.includes("S")) return "Senate";
  return null;
}

/**
 * Fetch the LC-bearing versions for a bill from legis.ga.gov, oldest first.
 * Each entry = { versionNumber, name, lc, chamber, isCurrent }. Floor
 * amendments and other non-LC entries are excluded so the list maps 1:1
 * to LegiScan's substantive text versions.
 *
 * @param {number} legislationId legis.ga.gov internal legislation id
 */
export async function fetchBillVersionsGa(legislationId) {
  if (!legislationId) return [];
  const data = await apiFetch(`/legislation/Detail/${legislationId}`);
  const versions = Array.isArray(data?.versions) ? data.versions : [];
  return versions
    .map((v) => ({
      versionNumber: v?.versionNumber ?? 0,
      name: String(v?.name ?? ""),
      lc: extractVersionLc(v?.name),
      chamber: versionChamber(v?.name),
      isCurrent: !!v?.isCurrent,
    }))
    .filter((v) => v.lc)
    .sort((a, b) => a.versionNumber - b.versionNumber);
}

// ─── Committees ──────────────────────────────────────────────

/**
 * Fetch all committees in the given chamber for the current session.
 * @param {number} chamber  CHAMBER.HOUSE | CHAMBER.SENATE
 */
export async function fetchCommittees(chamber, providerSessionId = null) {
  const sessionId = providerSessionId ?? (await getCurrentSessionId());
  if (!sessionId) return [];
  const list = await apiFetch(`/committees/List/${sessionId}`);
  return (list ?? [])
    .filter((c) => Number(c.chamber) === Number(chamber))
    .map((c) => ({
      id: c.id,
      name: c.name,
      chamber: CHAMBER_NAME[Number(c.chamber)] ?? "Unknown",
      chamberType: Number(c.chamber),
      sessionId: c.sessionId ?? sessionId,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Fetch every committee in the current session (all chambers).
 * Result includes a numeric `chamberType` (1=House, 2=Senate, 3=Joint).
 */
export async function fetchAllCommittees(providerSessionId = null) {
  const sessionId = providerSessionId ?? (await getCurrentSessionId());
  if (!sessionId) return [];
  const list = await apiFetch(`/committees/List/${sessionId}`);
  return (list ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    chamberType: Number(c.chamber),
    chamber: CHAMBER_NAME[Number(c.chamber)] ?? "Unknown",
    sessionId: c.sessionId ?? sessionId,
  }));
}

/**
 * Normalise a committee name (or meeting subject) to a comparable key.
 *  - strips trailing "(House)", "(Senate)", "(Joint)"
 *  - strips trailing ": ..." annotations ("Rules Committee: Upon Adjournment")
 *  - strips "Committee" / "Subcommittee" suffix
 *  - collapses whitespace, ampersands, "and", punctuation
 */
export function normalizeCommitteeKey(s) {
  if (!s) return "";
  let v = String(s);
  // Drop trailing "(House)" / "(Senate)" / "(Joint)" markers
  v = v.replace(/\s*\((house|senate|joint)\)\s*$/i, "");
  // Drop trailing ": …" annotations
  v = v.replace(/\s*:\s*.+$/, "");
  // Drop trailing "Committee" / "Subcommittee"
  v = v.replace(/\s+(sub)?committee\s*$/i, "");
  return v
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Try to match a meeting subject to a committee from the list.
 *  - Skips floor sessions and other non-committee meetings.
 *  - Returns the matched committee or null.
 */
export function matchMeetingToCommittee(meeting, committees) {
  if (!meeting || !committees?.length) return null;
  const subject = meeting.title ?? meeting.subject ?? "";
  if (!subject) return null;
  const lower = subject.toLowerCase();
  // Skip non-committee events
  if (lower.includes("floor session")) return null;
  if (lower.includes("caucus")) return null;
  if (lower.includes("press conference")) return null;

  const key = normalizeCommitteeKey(subject);
  if (!key) return null;

  // Prefer same-chamber match
  const chamber = meeting.chamber ?? null;
  const sameChamber = chamber
    ? committees.filter((c) => c.chamberType === chamber)
    : committees;

  // Exact normalised match first
  let hit = sameChamber.find((c) => normalizeCommitteeKey(c.name) === key);
  if (hit) return hit;

  // Substring match (committee key contained in meeting key or vice-versa)
  hit = sameChamber.find((c) => {
    const ck = normalizeCommitteeKey(c.name);
    return ck && (key.startsWith(ck) || ck.startsWith(key));
  });
  if (hit) return hit;

  // Fall back to any chamber with the same heuristics
  if (chamber) {
    hit = committees.find((c) => normalizeCommitteeKey(c.name) === key);
    if (hit) return hit;
    hit = committees.find((c) => {
      const ck = normalizeCommitteeKey(c.name);
      return ck && (key.startsWith(ck) || ck.startsWith(key));
    });
    if (hit) return hit;
  }
  return null;
}

/**
 * Fetch full details for a single committee (members, address, sessions, …).
 */
export async function fetchCommitteeDetails(
  committeeId,
  expectedProviderSessionId = null,
) {
  if (!committeeId) return null;
  const data = await apiFetch(`/committees/details/${committeeId}`);
  if (!data) return null;
  if (
    expectedProviderSessionId != null &&
    isPositiveSessionId(data.sessionId) &&
    Number(data.sessionId) !== Number(expectedProviderSessionId)
  ) {
    throw new Error(
      "legis.ga.gov returned committee details from a different session.",
    );
  }
  return {
    id: data.id,
    name: data.name,
    sessionId: data.sessionId,
    sessions: data.sessions ?? [],
    description: data.description ?? "",
    address: data.address ?? null,
    members: (data.members ?? []).map(normalizeMember),
    membersArchive: (data.membersArchive ?? []).map(normalizeMember),
    staff: data.staff ?? [],
    subcommittees: data.subcommittees ?? [],
    buttons: data.buttonGroup?.buttons ?? [],
  };
}

function normalizeMember(m) {
  const district = m.district
    ? `${m.district.number}${m.district.suffix ?? ""}`
    : "";
  return {
    id: m.id,
    name: (m.name ?? "").trim(),
    role: m.role ?? "Member",
    roleSort: m.roleSort ?? 99,
    district,
    dateVacated: m.dateVacated ?? null,
  };
}

// ─── Bills assigned to a committee ───────────────────────────

/**
 * Build a human-readable bill identifier like "HB 44" or "SR 12".
 */
function buildBillIdentifier(bill) {
  const chamber = CHAMBER_SHORT[bill.chamberType] ?? "";
  const doc = DOC_SHORT[bill.documentType] ?? "";
  const num = bill.number ?? "";
  const suffix = bill.suffix ? bill.suffix.trim() : "";
  return `${chamber}${doc} ${num}${suffix ? " " + suffix : ""}`.trim();
}

function chamberLabelFromBill(bill) {
  // Use the originating chamber based on chamberType
  if (bill.chamberType === 2) return "Senate";
  if (bill.chamberType === 1) return "House";
  return "Joint";
}

function buildLegisUrl(bill) {
  // Public-facing URL for the legislation page on legis.ga.gov
  // Example: https://www.legis.ga.gov/legislation/{legislationId}
  if (!bill.legislationId) return "";
  return `https://www.legis.ga.gov/legislation/${bill.legislationId}`;
}

function committeeReferenceId(reference) {
  const value =
    reference?.id ??
    reference?.committeeId ??
    reference?.committee_id ??
    reference;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) ? numeric : null;
}

function normalizeBill(bill, committeeId) {
  const identifier = buildBillIdentifier(bill);
  const sponsors = (bill.sponsors ?? []).map((s) => ({
    name: (s.name ?? "").trim().replace(/,\s*/, ", "),
    district: s.district ?? "",
    sponsorType: s.sponsorType,
  }));
  return {
    id: bill.legislationId,
    legislationId: bill.legislationId,
    identifier,
    number: bill.number,
    title: bill.caption ?? "",
    chamber: chamberLabelFromBill(bill),
    chamberType: bill.chamberType,
    documentType: bill.documentType,
    suffix: (bill.suffix ?? "").trim(),
    status: bill.status ?? "",
    statusDate: bill.statusDate ?? "",
    actVetoNumber: bill.actVetoNumber ?? "",
    session: bill.session ?? null,
    houseCommittee: bill.houseCommittee ?? null,
    senateCommittee: bill.senateCommittee ?? null,
    isCurrentlyAssigned:
      committeeReferenceId(bill.houseCommittee) === Number(committeeId) ||
      committeeReferenceId(bill.senateCommittee) === Number(committeeId),
    sponsors,
    // Convenience fields used by the existing BillRow component
    abstract: "",
    latest_action: bill.status ?? "",
    latest_action_date: bill.statusDate ?? "",
    openstates_url: buildLegisUrl(bill),
    committeeActions: [],
  };
}

/**
 * Fetch every bill in the current session that is assigned to the given
 * committee. Pages through the API until the full result set is collected.
 *
 * @param {number} committeeId
 * @param {number} [sessionId] defaults to the current session
 */
export async function fetchCommitteeBills(committeeId, sessionId = null) {
  if (!committeeId) return [];
  const sid = sessionId ?? (await getCurrentSessionId());
  if (!sid) return [];

  const pageSize = 50;
  let page = 1;
  const all = [];

  while (true) {
    // POST /api/Legislation/Search/{pageSize}/{pageIndex0}
    const data = await apiFetch(`/Legislation/Search/${pageSize}/${page - 1}`, {
      method: "POST",
      body: { sessionId: sid, committeeIds: [committeeId] },
    });
    const results = data?.results ?? [];
    all.push(...results);
    if (results.length < pageSize) break;
    page++;
    if (page > 20) break; // safety
  }

  if (
    all.some(
      (bill) =>
        isPositiveSessionId(bill?.session?.id) &&
        Number(bill.session.id) !== Number(sid),
    )
  ) {
    throw new Error(
      "legis.ga.gov returned committee bills from a different session.",
    );
  }

  return all.map((bill) => normalizeBill(bill, committeeId));
}

// ─── Calendar / Meetings ─────────────────────────────────────

// The /api/meetings endpoint requires startDate / endDate formatted via the
// JS `Date.prototype.toDateString()` (e.g. "Tue Feb 03 2026").
function toDateString(d) {
  const date = d instanceof Date ? d : new Date(d);
  return date.toDateString();
}

function chamberQueryValue(chamber) {
  // The website passes the ChamberType enum value (1, 2) or null for "All"
  if (chamber == null || chamber === "all" || chamber === "All") return null;
  if (typeof chamber === "number") return chamber;
  const c = String(chamber).toLowerCase();
  if (c.startsWith("h")) return CHAMBER.HOUSE;
  if (c.startsWith("s")) return CHAMBER.SENATE;
  if (c.startsWith("j")) return CHAMBER.JOINT;
  return null;
}

function getMeetingProviderSessionId(meeting) {
  const value =
    meeting?.sessionId ??
    meeting?.session_id ??
    meeting?.legislativeSessionId ??
    meeting?.legislative_session_id ??
    meeting?.session?.id ??
    meeting?.session?.sessionId ??
    null;
  const numeric = Number(value);
  return isPositiveSessionId(numeric) ? numeric : null;
}

const meetingDateKey = (meeting) =>
  String(meeting?.start_time ?? meeting?.start ?? "").slice(0, 10);

const meetingTitle = (meeting) =>
  String(meeting?.title ?? meeting?.subject ?? "").trim();

/**
 * Discover special-session boundaries from official floor-session entries.
 * The meetings API has no session field, but each called session restarts its
 * legislative-day counter at LD1. The range ends on that cluster's last floor
 * day (Georgia special sessions are constitutionally short).
 */
export function deriveSpecialSessionWindows(meetings) {
  const floorMeetings = (meetings ?? []).filter((meeting) =>
    /floor session/i.test(meetingTitle(meeting)),
  );
  const starts = [
    ...new Set(
      floorMeetings
        .filter((meeting) => /\bLD\s*1\b/i.test(meetingTitle(meeting)))
        .map(meetingDateKey)
        .filter(Boolean),
    ),
  ].sort();

  return starts.map((startDate, index) => {
    const nextStart = starts[index + 1] ?? null;
    const maxEnd = new Date(`${startDate}T12:00:00Z`);
    maxEnd.setUTCDate(maxEnd.getUTCDate() + 45);
    const maxEndKey = maxEnd.toISOString().slice(0, 10);
    const floorDates = floorMeetings
      .map(meetingDateKey)
      .filter(
        (date) =>
          date >= startDate &&
          date <= maxEndKey &&
          (!nextStart || date < nextStart),
      )
      .sort();
    return {
      startDate,
      endDate: floorDates.at(-1) || startDate,
    };
  });
}

const isInterimStudyMeeting = (meeting) =>
  /\b(?:study committee|blue[- ]ribbon)\b/i.test(meetingTitle(meeting));

/**
 * Keep meetings on the selected side of regular/special session boundaries.
 * Special sessions fail closed when their LD1 window cannot be identified.
 */
export function filterMeetingsForSession(meetings, mapping, specialWindows) {
  if (!mapping) return [];
  const windows = specialWindows ?? [];
  if (mapping.isSpecialSession) {
    const target = windows[(mapping.specialSessionNumber || 1) - 1];
    if (!target) return [];
    return (meetings ?? [])
      .filter((meeting) => {
        const date = meetingDateKey(meeting);
        return (
          date >= target.startDate &&
          date <= target.endDate &&
          !isInterimStudyMeeting(meeting)
        );
      })
      .map((meeting) => ({
        ...meeting,
        is_special_session: true,
        session_label: mapping.gaSessionLabel || "Special Session",
      }));
  }

  return (meetings ?? [])
    .filter((meeting) => {
      const date = meetingDateKey(meeting);
      return !windows.some(
        (window) => date >= window.startDate && date <= window.endDate,
      );
    })
    .map((meeting) => ({
      ...meeting,
      is_special_session: false,
      session_label: mapping.gaSessionLabel || "Regular Session",
    }));
}

function normalizeMeeting(m, providerSession = null) {
  const providerSessionId =
    typeof providerSession === "object"
      ? providerSession?.gaSessionId
      : providerSession;
  const startIso = m.start ?? new Date().toISOString();
  const startDate = new Date(startIso);
  // The API does not return an end time; default to +1h
  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

  const name = (m.subject ?? "").trim();
  const lower = name.toLowerCase();

  // Chamber → display color (matches the existing event-color palette)
  let color = "gold";
  if (m.chamber === CHAMBER.SENATE || lower.includes("(senate)"))
    color = "leg-senate";
  else if (m.chamber === CHAMBER.HOUSE || lower.includes("(house)"))
    color = "leg-house";

  // Classification: floor session vs. committee meeting
  const classification = lower.includes("floor session")
    ? "Floor Session"
    : "Committee Meeting";

  // The direct livestream URL the website uses (e.g. a Vimeo showcase URL).
  // This already points to the correct room/chamber video — no need to guess.
  const videoUrl = m.livestreamUrl || null;
  const rawAgendaUrl = String(m.agendaUri || "").trim();
  const agendaUrl = /^https?:\/\//i.test(rawAgendaUrl)
    ? rawAgendaUrl.replace(/^http:\/\//i, "https://")
    : null;

  // Build a public legis.ga.gov link for the meeting (the schedule page)
  const dateStr = `${startDate.getMonth() + 1}-${startDate.getDate()}-${startDate.getFullYear()}`;
  const scheduleUrl = `https://www.legis.ga.gov/schedule/all?start=${dateStr}&end=${dateStr}`;

  return {
    id: `legis-${m.id}`,
    title: name || "Legislative Event",
    description: (m.body ?? "").trim(),
    start_time: startIso,
    end_time: endDate.toISOString(),
    all_day: m.isTbd === true,
    color,
    location: (m.location ?? "").trim(),
    location_url: "",
    classification,
    bills: [], // not exposed by this endpoint
    participants: [],
    links: agendaUrl ? [{ url: agendaUrl, note: "Agenda (PDF)" }] : [],
    videoUrl,
    agendaUrl,
    scheduleUrl,
    willBroadcast: !!m.willBroadcast,
    isVimeo: !!m.isVimeo,
    chamber: m.chamber,
    provider_session_id:
      getMeetingProviderSessionId(m) ??
      (isPositiveSessionId(providerSessionId)
        ? Number(providerSessionId)
        : null),
    session_label:
      typeof providerSession === "object"
        ? providerSession?.gaSessionLabel || null
        : null,
    is_special_session:
      typeof providerSession === "object"
        ? Boolean(providerSession?.isSpecialSession)
        : false,
    _source: "legis-ga",
  };
}

/**
 * Fetch legislative meetings/events from legis.ga.gov for a date range.
 *
 * @param {string|Date} startDate
 * @param {string|Date} endDate
 * @param {1|2|3|null|"house"|"senate"} [chamber]  Optional chamber filter
 * @param {number|object|null} [expectedProviderSession] verified mapping or id
 * @returns {Promise<Array>}
 */
export async function fetchGAMeetings(
  startDate,
  endDate,
  chamber = null,
  expectedProviderSession = null,
) {
  if (!startDate || !endDate) return [];

  const params = new URLSearchParams();
  params.set("startDate", toDateString(startDate));
  params.set("endDate", toDateString(endDate));
  const ch = chamberQueryValue(chamber);
  if (ch != null) params.set("chamber", String(ch));

  const data = await apiFetch(`/meetings?${params.toString()}`);
  if (!Array.isArray(data)) return [];
  const expectedProviderSessionId =
    typeof expectedProviderSession === "object"
      ? expectedProviderSession?.gaSessionId
      : expectedProviderSession;
  if (expectedProviderSessionId != null) {
    const expected = Number(expectedProviderSessionId);
    const sessionIds = data.map(getMeetingProviderSessionId);
    if (
      sessionIds.some(
        (sessionId) => sessionId != null && sessionId !== expected,
      )
    ) {
      throw new Error(
        "legis.ga.gov returned meetings from a different provider session.",
      );
    }
  }
  return data.map((meeting) =>
    normalizeMeeting(meeting, expectedProviderSession),
  );
}
