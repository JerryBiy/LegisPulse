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

    // Try to get detailed status info, use last_action as the status description
    const statusCode = bill.status || 1;
    const statusDesc = bill.last_action || "Introduced";

    bills.push({
      legiscan_id: bill.bill_id,
      bill_number: billNumber,
      title: bill.title || bill.description,
      chamber: bill.chamber || bill.body || determineChamber(billNumber),
      bill_type: determineBillType(billNumber),
      sponsor: Array.isArray(bill.sponsors)
        ? bill.sponsors[0]?.name
        : bill.sponsors?.name || "Unknown",
      session_year: bill.session?.year_start || 2026,
      status: mapLegiScanStatus(statusCode, statusDesc),
      last_action: bill.last_action || statusDesc,
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
    bill_type: determineBillType(billNumber),
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
 * Determine bill type from bill number prefix
 * HB/SB = bill, HR/SR = resolution
 */
function determineBillType(billNumber) {
  if (!billNumber) return "bill";
  const normalized = billNumber.trim().toUpperCase();
  // HR and SR are resolutions
  if (normalized.startsWith("HR") || normalized.startsWith("SR")) {
    return "resolution";
  }
  return "bill";
}

/**
 * Map LegiScan status to app status
 */
function mapLegiScanStatus(statusCode, statusDesc) {
  // LegiScan status codes: 1=Introduced, 2=In Committee, 3=Passed Chamber, 4=Crossover, 5=Passed, 6=Vetoed, 7=Failed

  // Default to introduced if no data
  if (!statusCode && !statusDesc) return "introduced";

  // Convert statusCode to number if it's a string
  const code = parseInt(statusCode, 10) || 1;

  // Normalize description to lowercase
  const desc = (statusDesc || "").toLowerCase();

  // Check descriptions for common LegiScan action text patterns

  // Signed/Enacted
  if (
    desc.includes("signed") ||
    desc.includes("enacted") ||
    desc.includes("approved")
  )
    return "signed";

  // Vetoed/Failed/Dead
  if (desc.includes("veto") || desc.includes("vetoed")) return "vetoed";
  if (
    desc.includes("fail") ||
    desc.includes("dead") ||
    desc.includes("died in")
  )
    return "dead";

  // Governor
  if (desc.includes("governor") && !desc.includes("approved by"))
    return "sent_to_governor";

  // Passed both chambers
  if (desc.includes("passed") && desc.includes("both"))
    return "passed_both_chambers";

  // Reading levels (check these early)
  if (desc.includes("third") && desc.includes("read"))
    return "passed_third_reading";
  if (desc.includes("second") && desc.includes("read"))
    return "passed_second_reading";
  if (desc.includes("first") && desc.includes("read"))
    return "passed_first_reading";

  // Crossover / Sent to other chamber
  if (desc.includes("crossover")) return "sent_to_other_chamber";
  if (desc.includes("sent to")) return "sent_to_other_chamber";
  if (
    desc.includes("referred to") &&
    (desc.includes("senate") || desc.includes("house"))
  )
    return "sent_to_other_chamber";

  // Committee actions
  if (desc.includes("assigned to") || desc.includes("referred to"))
    return "in_committee";
  if (
    (desc.includes("committee") || desc.includes("subcommittee")) &&
    !desc.includes("passed")
  )
    return "in_committee";

  // Fallback to status code
  switch (code) {
    case 6:
      return "vetoed";
    case 7:
      return "dead";
    case 5:
      return "passed_both_chambers";
    case 4:
      return "sent_to_other_chamber";
    case 3:
      return "passed_third_reading";
    case 2:
      return "in_committee";
    case 1:
    default:
      return "introduced";
  }
}

/**
 * Check if API key is configured
 */
export function isLegiScanConfigured() {
  return !!LEGISCAN_API_KEY && LEGISCAN_API_KEY !== "your_legiscan_api_key";
}
