// LegiScan API integration for Georgia bills
// API docs: https://legiscan.com/legiscan

const LEGISCAN_API_KEY = import.meta.env.VITE_LEGISCAN_API_KEY;
const LEGISCAN_BASE_URL = "https://api.legiscan.com/";

// Georgia state ID in LegiScan
const GA_STATE_ID = 11;

const isLikelyPdfUrl = (url) => {
  if (!url) return false;
  const normalized = String(url).toLowerCase();
  return normalized.includes(".pdf");
};

const isPdfMime = (mime) => {
  if (!mime) return false;
  return String(mime).toLowerCase().includes("pdf");
};

const extractSponsorNames = (sponsors) => {
  if (!Array.isArray(sponsors)) return [];
  return sponsors
    .map((sponsor) => sponsor?.name)
    .filter((name) => typeof name === "string" && name.trim().length > 0);
};

const extractBillNumberValue = (billNumber) => {
  const number = parseInt(
    String(billNumber || "").replace(/\D/g, "") || "0",
    10,
  );
  return Number.isNaN(number) ? 0 : number;
};

const hasSponsorData = (bill) => {
  if (!bill) return false;
  if (Array.isArray(bill.sponsors) && bill.sponsors.length > 0) return true;
  const sponsor = String(bill.sponsor || "").trim();
  return sponsor.length > 0 && sponsor.toLowerCase() !== "unknown";
};

const stripHtml = (value) =>
  String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();

const normalizeWhitespace = (value) =>
  String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const buildBillTextCandidates = (textPayload) => {
  const candidates = [];

  if (typeof textPayload === "string") {
    candidates.push(textPayload);
  }

  if (typeof textPayload === "object" && textPayload) {
    candidates.push(
      textPayload.text,
      textPayload.content,
      textPayload.doc,
      textPayload.document,
      textPayload.bill_text,
      textPayload.body,
      textPayload.full_text,
    );
  }

  return candidates;
};

const decodeBase64ToBinary = (value) => {
  const raw = String(value || "").trim();
  if (!raw || typeof atob !== "function") return "";

  const base64Like = /^[A-Za-z0-9+/=\r\n]+$/.test(raw) && raw.length % 4 === 0;
  if (!base64Like) return "";

  try {
    return atob(raw);
  } catch {
    return "";
  }
};

const binaryToBytes = (binary) =>
  Uint8Array.from(binary, (char) => char.charCodeAt(0));

const looksLikeReadableText = (text) => {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return false;

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 40) return false;

  // Must look like natural language text.
  const hasSentencePunctuation = /[\.!?;:]/.test(normalized);
  const hasNaturalSpacing = /\s/.test(normalized);
  const hasReasonableLength = normalized.length >= 300;

  return hasSentencePunctuation && hasNaturalSpacing && hasReasonableLength;
};

const decodeBase64IfLikely = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const binary = decodeBase64ToBinary(raw);
  if (!binary) {
    return raw;
  }

  try {
    // Detect PDF binary signature and reject as plain text source.
    if (binary.startsWith("%PDF-")) {
      return "";
    }

    const bytes = binaryToBytes(binary);
    let decoded = "";

    try {
      decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    } catch {
      decoded = binary;
    }

    const normalized = normalizeWhitespace(decoded);

    // Prefer UTF-8 decoded text, but if it looks partially corrupted,
    // try the raw decoded binary string as a fallback.
    const replacementCharRatio = normalized.length
      ? (normalized.match(/�/g)?.length || 0) / normalized.length
      : 0;
    if (replacementCharRatio > 0.05) {
      const binaryFallback = normalizeWhitespace(binary);
      return binaryFallback;
    }

    return normalized;
  } catch {
    return raw;
  }
};

const extractPdfBytesFromBillTextPayload = (textPayload) => {
  const candidates = buildBillTextCandidates(textPayload);

  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    const binary = decodeBase64ToBinary(candidate);
    if (!binary) continue;
    if (!binary.startsWith("%PDF-")) continue;
    return binaryToBytes(binary);
  }

  return null;
};

const extractTextFromBillTextPayload = (textPayload) => {
  if (!textPayload) return "";

  const candidates = buildBillTextCandidates(textPayload);

  let bestText = "";

  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    const decoded = decodeBase64IfLikely(candidate);
    if (!decoded) continue;

    const normalized =
      decoded.includes("<") && decoded.includes(">")
        ? normalizeWhitespace(stripHtml(decoded))
        : normalizeWhitespace(decoded);

    if (!normalized) continue;

    if (
      normalized.length > bestText.length &&
      looksLikeReadableText(normalized)
    ) {
      bestText = normalized;
    }
  }

  // Secondary fallback: if no strong candidate matched the heuristic,
  // accept the longest non-empty normalized candidate.
  if (!bestText) {
    for (const candidate of candidates) {
      if (typeof candidate !== "string" || !candidate.trim()) continue;
      const decoded = decodeBase64IfLikely(candidate);
      if (!decoded) continue;

      const normalized =
        decoded.includes("<") && decoded.includes(">")
          ? normalizeWhitespace(stripHtml(decoded))
          : normalizeWhitespace(decoded);

      if (normalized.length > bestText.length) {
        bestText = normalized;
      }
    }
  }

  return bestText;
};

const extractTextFromPdfBytes = async (pdfData) => {
  if (!pdfData?.length) return "";

  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdfWorker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");

    if (pdfjs.GlobalWorkerOptions?.workerSrc !== pdfWorker.default) {
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker.default;
    }

    const loadingTask = pdfjs.getDocument({
      data: pdfData,
      isEvalSupported: false,
    });

    const pdfDocument = await loadingTask.promise;
    const maxPages = Math.min(pdfDocument.numPages || 0, 60);
    const pageTexts = [];

    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) =>
          "str" in item && typeof item.str === "string" ? item.str : "",
        )
        .filter(Boolean)
        .join(" ");

      if (text) pageTexts.push(text);
    }

    const extracted = normalizeWhitespace(pageTexts.join("\n"));
    return extracted;
  } catch (error) {
    console.warn("Unable to extract PDF text for AI context", error);
    return "";
  }
};

const extractTextFromPdfUrl = async (pdfUrl) => {
  if (!pdfUrl) return "";

  try {
    const response = await fetch(pdfUrl);
    if (!response.ok) return "";
    const pdfData = new Uint8Array(await response.arrayBuffer());
    return await extractTextFromPdfBytes(pdfData);
  } catch (error) {
    console.warn("Unable to fetch PDF URL for AI context", error);
    return "";
  }
};

/**
 * Fetch a direct PDF/text link for a bill.
 * Uses getBill to enumerate text versions, then getBillText for the newest
 * text first so we can prefer a direct PDF link when available.
 */
export async function fetchBillPDFLink(legiscanBillId) {
  if (!legiscanBillId) {
    return { pdfLink: null, sponsorNames: [] };
  }

  const data = await legiscanRequest("getBill", { id: legiscanBillId });
  const bill = data.bill || {};
  const sponsorNames = extractSponsorNames(bill.sponsors);
  const texts = Array.isArray(bill.texts) ? [...bill.texts] : [];

  // Prefer most recent text documents first.
  texts.sort((a, b) => {
    const dateA = new Date(a?.date || 0).getTime() || 0;
    const dateB = new Date(b?.date || 0).getTime() || 0;
    return dateB - dateA;
  });

  let fallbackTextLink = null;

  for (const textItem of texts) {
    const docId = textItem?.doc_id || textItem?.text_id || textItem?.id;

    if (!docId) {
      const direct = textItem?.state_link || textItem?.url || null;
      if (direct && !fallbackTextLink) fallbackTextLink = direct;
      if (isLikelyPdfUrl(direct) || isPdfMime(textItem?.mime)) {
        return { pdfLink: direct, sponsorNames };
      }
      continue;
    }

    try {
      const textResponse = await legiscanRequest("getBillText", { id: docId });
      const text = textResponse.text || {};
      const direct =
        text.state_link ||
        text.url ||
        textItem?.state_link ||
        textItem?.url ||
        null;

      if (direct && !fallbackTextLink) fallbackTextLink = direct;

      if (isLikelyPdfUrl(direct) || isPdfMime(text.mime || textItem?.mime)) {
        return { pdfLink: direct, sponsorNames };
      }
    } catch (error) {
      // Continue trying older text records.
      console.warn(`getBillText failed for doc ${docId}:`, error);
    }
  }

  return {
    pdfLink: fallbackTextLink || bill.state_link || bill.url || null,
    sponsorNames,
  };
}

/**
 * Fetch bill text content (for AI summarization context).
 * Uses getBill -> getBillText and returns the newest useful text body.
 */
export async function fetchBillTextForAI(legiscanBillId) {
  if (!legiscanBillId) return "";

  const data = await legiscanRequest("getBill", { id: legiscanBillId });
  const bill = data.bill || {};
  const texts = Array.isArray(bill.texts) ? [...bill.texts] : [];

  texts.sort((a, b) => {
    const dateA = new Date(a?.date || 0).getTime() || 0;
    const dateB = new Date(b?.date || 0).getTime() || 0;
    return dateB - dateA;
  });

  let bestExtractedText = "";

  for (const textItem of texts) {
    const docId = textItem?.doc_id || textItem?.text_id || textItem?.id;
    if (!docId) continue;

    try {
      const textResponse = await legiscanRequest("getBillText", { id: docId });
      const extracted = extractTextFromBillTextPayload(textResponse?.text);
      if (extracted && extracted.length > bestExtractedText.length) {
        bestExtractedText = extracted;

        // Early return once we have a strong candidate to reduce extra API calls.
        if (bestExtractedText.length >= 12000) {
          return bestExtractedText.slice(0, 30000);
        }
      }

      if (bestExtractedText.length < 300) {
        const pdfBytes = extractPdfBytesFromBillTextPayload(textResponse?.text);
        if (pdfBytes?.length) {
          const pdfText = await extractTextFromPdfBytes(pdfBytes);
          if (pdfText && pdfText.length > bestExtractedText.length) {
            bestExtractedText = pdfText;

            if (bestExtractedText.length >= 12000) {
              return bestExtractedText.slice(0, 30000);
            }
          }
        }
      }
    } catch (error) {
      console.warn(`getBillText failed for AI context doc ${docId}:`, error);
    }
  }

  if (bestExtractedText.length < 300) {
    try {
      const { pdfLink } = await fetchBillPDFLink(legiscanBillId);
      if (isLikelyPdfUrl(pdfLink)) {
        const pdfText = await extractTextFromPdfUrl(pdfLink);
        if (pdfText && pdfText.length > bestExtractedText.length) {
          bestExtractedText = pdfText;
        }
      }
    } catch (error) {
      console.warn("PDF fallback failed for AI context", error);
    }
  }

  // Require sufficient text to avoid very short or metadata-only summaries.
  if (bestExtractedText.length < 300) {
    return "";
  }

  return bestExtractedText.slice(0, 30000);
}

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
      sponsors: extractSponsorNames(bill.sponsors),
      co_sponsors: Array.isArray(bill.sponsors)
        ? bill.sponsors
            .slice(1)
            .map((sponsor) => sponsor?.name)
            .filter(Boolean)
        : [],
      session_year: bill.session?.year_start || 2026,
      status: mapLegiScanStatus(statusCode, statusDesc),
      last_action: bill.last_action || statusDesc,
      last_action_date: bill.last_action_date || bill.status_date,
      url: bill.state_link || bill.url,
    });
  }

  // Master list can be missing sponsor names for many bills.
  // Enrich missing sponsors with getBill so cards do not show "Unknown" after sync.
  const MAX_SPONSOR_ENRICHMENT = 200;
  const ENRICHMENT_CONCURRENCY = 8;

  const billsNeedingSponsors = bills
    .filter((bill) => bill.legiscan_id && !hasSponsorData(bill))
    .sort(
      (a, b) =>
        extractBillNumberValue(b.bill_number) -
        extractBillNumberValue(a.bill_number),
    )
    .slice(0, MAX_SPONSOR_ENRICHMENT);

  for (
    let i = 0;
    i < billsNeedingSponsors.length;
    i += ENRICHMENT_CONCURRENCY
  ) {
    const chunk = billsNeedingSponsors.slice(i, i + ENRICHMENT_CONCURRENCY);

    await Promise.allSettled(
      chunk.map(async (billRecord) => {
        try {
          const detailData = await legiscanRequest("getBill", {
            id: billRecord.legiscan_id,
          });
          const sponsorNames = extractSponsorNames(detailData.bill?.sponsors);

          if (sponsorNames.length > 0) {
            billRecord.sponsor = sponsorNames[0];
            billRecord.sponsors = sponsorNames;
            billRecord.co_sponsors = sponsorNames.slice(1);
          }
        } catch (error) {
          console.warn(
            `Failed sponsor enrichment for bill ${billRecord.legiscan_id}:`,
            error,
          );
        }
      }),
    );
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
    sponsors: extractSponsorNames(bill.sponsors),
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
