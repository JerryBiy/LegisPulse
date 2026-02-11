// LegiScan API integration for Georgia bills
// API docs: https://legiscan.com/legiscan

const LEGISCAN_API_KEY = import.meta.env.VITE_LEGISCAN_API_KEY;
const LEGISCAN_BASE_URL = "https://api.legiscan.com/";

// Georgia state ID in LegiScan
const GA_STATE_ID = 11;

/**
 * Make a request to LegiScan API
 */
async function legiscanRequest(operation, params = {}) {
  const url = new URL(LEGISCAN_BASE_URL);
  url.searchParams.append("key", LEGISCAN_API_KEY);
  url.searchParams.append("op", operation);

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, value);
  });

  const response = await fetch(url.toString());
  const data = await response.json();

  if (data.status === "ERROR") {
    throw new Error(data.alert?.message || "LegiScan API error");
  }

  return data;
}

/**
 * Get the current/recent session ID for Georgia
 */
export async function getGASessionId() {
  const data = await legiscanRequest("getSessionList", { state: "GA" });
  const sessions = data.sessions || [];

  // Find the 2025-2026 session or most recent
  const targetSession = sessions.find(
    (s) =>
      s.year_start === 2025 ||
      s.year_start === 2026 ||
      s.session_name.includes("2025"),
  );

  return targetSession?.session_id || sessions[0]?.session_id;
}

/**
 * Fetch all bills for a Georgia session
 */
export async function fetchGABills(sessionId) {
  if (!sessionId) {
    sessionId = await getGASessionId();
  }

  const data = await legiscanRequest("getMasterList", {
    state: "GA",
    id: sessionId,
  });
  const masterList = data.masterlist || {};

  const bills = [];

  for (const [key, item] of Object.entries(masterList)) {
    if (key === "session") continue; // Skip session metadata

    const bill = item.bill || item;

    // LegiScan API returns 'number' field, not 'bill_number'
    const billNumber = bill.bill_number || bill.number;

    bills.push({
      legiscan_id: bill.bill_id,
      bill_number: billNumber,
      title: bill.title || bill.description,
      chamber: bill.chamber || bill.body || determineChamber(billNumber),
      bill_type: determineBillType(bill.bill_type || bill.type),
      sponsor: Array.isArray(bill.sponsors)
        ? bill.sponsors[0]?.name
        : bill.sponsors?.name || "Unknown",
      session_year: bill.session?.year_start || 2026,
      status: mapLegiScanStatus(bill.status, bill.status_desc),
      last_action: bill.last_action || bill.status_desc,
      last_action_date: bill.last_action_date || bill.status_date,
      url: bill.state_link || bill.url,
    });
  }

  return bills;
}

/**
 * Get detailed bill information
 */
export async function fetchBillDetails(billId) {
  const data = await legiscanRequest("getBill", { id: billId });
  const bill = data.bill;

  // LegiScan API returns 'number' field, not 'bill_number'
  const billNumber = bill.bill_number || bill.number;

  return {
    legiscan_id: bill.bill_id,
    bill_number: billNumber,
    title: bill.title,
    description: bill.description,
    chamber: bill.chamber || bill.body || determineChamber(billNumber),
    bill_type: determineBillType(bill.bill_type || bill.type),
    sponsor: bill.sponsors?.[0]?.name || "Unknown",
    co_sponsors: bill.sponsors?.slice(1).map((s) => s.name) || [],
    session_year: bill.session?.year_start || 2026,
    status: mapLegiScanStatus(bill.status, bill.status_desc),
    current_committee: bill.committee?.name,
    last_action: bill.history?.[0]?.action || bill.status_desc,
    last_action_date: bill.history?.[0]?.date || bill.status_date,
    url: bill.state_link || bill.url,
    texts: bill.texts || [],
    votes: bill.votes || [],
    history: bill.history || [],
  };
}

/**
 * Determine chamber from bill number
 */
function determineChamber(billNumber) {
  const normalized = (billNumber || "").trim().toUpperCase();
  // LegiScan numbers typically start with SB/SR/SC/SCres for Senate, HB/HR/HC for House
  if (normalized.startsWith("S")) return "senate";
  if (normalized.startsWith("H")) return "house";
  return "house";
}

/**
 * Determine bill type from LegiScan bill_type
 */
function determineBillType(type) {
  if (!type) return "bill";
  const t = type.toLowerCase();
  if (t.includes("resolution")) return "resolution";
  return "bill";
}

/**
 * Map LegiScan status to app status
 */
function mapLegiScanStatus(statusCode, statusDesc) {
  // LegiScan status codes: 1=Introduced, 2=In Committee, 3=Passed Chamber, 4=Crossover, 5=Passed, 6=Vetoed, 7=Failed

  if (!statusDesc) return "introduced";
  const desc = statusDesc.toLowerCase();

  if (statusCode === 6 || desc.includes("veto")) return "vetoed";
  if (statusCode === 7 || desc.includes("fail") || desc.includes("dead"))
    return "dead";
  if (
    desc.includes("signed") ||
    desc.includes("enacted") ||
    desc.includes("approved")
  )
    return "signed";
  if (desc.includes("governor")) return "sent_to_governor";
  if (statusCode === 5 || (desc.includes("passed") && desc.includes("both")))
    return "passed_both_chambers";
  if (
    statusCode === 4 ||
    desc.includes("crossover") ||
    desc.includes("other chamber")
  )
    return "sent_to_other_chamber";
  if (statusCode === 3 || (desc.includes("passed") && desc.includes("third")))
    return "passed_third_reading";
  if (desc.includes("passed") && desc.includes("second"))
    return "passed_second_reading";
  if (desc.includes("passed") && desc.includes("first"))
    return "passed_first_reading";
  if (statusCode === 2 || desc.includes("committee")) return "in_committee";

  return "introduced";
}

/**
 * Check if API key is configured
 */
export function isLegiScanConfigured() {
  return !!LEGISCAN_API_KEY && LEGISCAN_API_KEY !== "your_legiscan_api_key";
}
