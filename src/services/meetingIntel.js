// ─── Meeting Intelligence service ────────────────────────────────────────────
// Agenda-PDF → bill extraction, tracked-bill matching, and AI analysis of
// meeting transcripts (summary, bills mentioned, amendments to tracked bills).
//
// All AI calls go through the existing api.integrations.Core.InvokeLLM path.
// PDF text extraction reuses extractTextFromPdfUrl from the legiscan service.

import { api } from "@/api/apiClient";
import { extractTextFromPdfUrl } from "@/services/legiscan";

// Matches Georgia bill identifiers: HB/HR/SB/SR (and HC/SC) followed by a
// number with an optional short alpha suffix (e.g. "SB 3EX", "HB 887").
const BILL_RE = /\b([HS][BRCJ])\s*0*(\d{1,4}[A-Z]{0,3})\b/gi;

/** Canonical comparison key for a bill number: "HB 948" → "HB948". */
export const billKey = (bn) =>
  String(bn || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .trim();

/** Pretty bill number: "HB948" → "HB 948". */
export const prettyBill = (bn) => {
  const m = String(bn || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .match(/^([HS][BRCJ])(.+)$/);
  return m ? `${m[1]} ${m[2]}` : String(bn || "").toUpperCase();
};

/** Extract distinct bill numbers from a block of text. */
export const extractBillNumbers = (text) => {
  if (!text) return [];
  const seen = new Set();
  const out = [];
  let m;
  BILL_RE.lastIndex = 0;
  while ((m = BILL_RE.exec(text)) !== null) {
    const pretty = `${m[1].toUpperCase()} ${m[2].toUpperCase()}`;
    const key = billKey(pretty);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(pretty);
    }
  }
  return out;
};

/**
 * Parse the bills referenced in a meeting's agenda PDF.
 * Returns a de-duplicated array of pretty bill numbers (e.g. ["SB 3EX", "HB 12"]).
 * Returns [] if the agenda can't be fetched/parsed (non-fatal).
 */
export async function parseAgendaBills(agendaUrl) {
  if (!agendaUrl) return [];
  try {
    const text = await extractTextFromPdfUrl(agendaUrl);
    return extractBillNumbers(text);
  } catch (err) {
    console.warn("Agenda parse failed:", err?.message || err);
    return [];
  }
}

/**
 * Intersect a list of bill numbers with the user's tracked bill numbers.
 * Comparison is normalization-insensitive. Returns the matching tracked
 * bill numbers (in their tracked-set spelling).
 */
export function matchTrackedBills(billNumbers, trackedNumbers) {
  const trackedByKey = new Map(
    (trackedNumbers || []).map((bn) => [billKey(bn), bn]),
  );
  const hits = new Set();
  for (const bn of billNumbers || []) {
    const tracked = trackedByKey.get(billKey(bn));
    if (tracked) hits.add(tracked);
  }
  return [...hits];
}

/**
 * Analyze a meeting transcript with AI.
 * @param {string} transcriptText  full (or partial) transcript text
 * @param {object} opts
 * @param {string} [opts.title]            meeting title for context
 * @param {string[]} [opts.trackedBills]   the user's tracked bill numbers
 * @param {string[]} [opts.agendaBills]    bills from the agenda for context
 * @returns {Promise<{summary:string, mentioned_bills:string[],
 *   amendments:Array<{bill_number:string, description:string}>}>}
 */
export async function analyzeTranscript(transcriptText, opts = {}) {
  const text = String(transcriptText || "").trim();
  if (text.length < 40) {
    return { summary: "", mentioned_bills: [], amendments: [] };
  }

  const { title = "Legislative meeting", trackedBills = [], agendaBills = [] } =
    opts;

  // Regex pre-pass guarantees we never miss an obvious mention even if the
  // model omits it; the model then refines and adds amendment detail.
  const regexMentions = extractBillNumbers(text);

  const context = text.slice(0, 28000);
  const trackedList = trackedBills.length
    ? trackedBills.map((b) => prettyBill(b)).join(", ")
    : "(none provided)";
  const agendaList = agendaBills.length ? agendaBills.join(", ") : "(unknown)";

  const prompt = `You are analyzing the transcript of a Georgia General Assembly meeting titled "${title}".

Agenda bills (may have changed): ${agendaList}
The user is tracking these bills: ${trackedList}

Transcript:
${context}

Return ONLY valid JSON with exactly these fields:
{
  "summary": "string",
  "mentioned_bills": ["HB 123", "SB 45"],
  "amendments": [
    { "bill_number": "HB 123", "description": "string" }
  ]
}

Requirements:
- summary: a neutral 3-6 sentence summary of what happened in the meeting — which bills were discussed, key testimony, motions, and any votes or outcomes. Plain language.
- mentioned_bills: every Georgia bill number (HB/HR/SB/SR + number) actually discussed in the transcript. Use "HB 123" spacing.
- amendments: ONE entry for each instance where the transcript indicates a NEW amendment, substitute, or substantive change was proposed/adopted to a bill (sunset extensions, funding changes, striking/adding language, committee substitutes, etc.). description = a one-sentence plain-language explanation of the change. If no amendments are evident, return an empty array.
- Do not invent bills or amendments that are not supported by the transcript.`;

  let response;
  try {
    response = await api.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: "object",
        properties: {
          summary: { type: "string" },
          mentioned_bills: { type: "array", items: { type: "string" } },
          amendments: {
            type: "array",
            items: {
              type: "object",
              properties: {
                bill_number: { type: "string" },
                description: { type: "string" },
              },
            },
          },
        },
        required: ["summary"],
      },
    });
  } catch (err) {
    console.warn("Transcript analysis failed:", err?.message || err);
    // Degrade gracefully to the regex mentions with no summary.
    return { summary: "", mentioned_bills: regexMentions, amendments: [] };
  }

  // Merge model + regex mentions, normalized + de-duplicated.
  const mentionSet = new Map();
  for (const bn of [...(response?.mentioned_bills || []), ...regexMentions]) {
    const pretty = prettyBill(bn);
    mentionSet.set(billKey(pretty), pretty);
  }

  const amendments = Array.isArray(response?.amendments)
    ? response.amendments
        .filter((a) => a && a.bill_number)
        .map((a) => ({
          bill_number: prettyBill(a.bill_number),
          description: String(a.description || "").trim(),
        }))
    : [];

  return {
    summary: String(response?.summary || "").trim(),
    mentioned_bills: [...mentionSet.values()],
    amendments,
  };
}
