import React, { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  isRichTextHtml,
  listToRichHtml,
  plainTextToRichHtml,
  RichTextContent,
  RichTextEditor,
  richTextHasContent,
  sanitizeRichTextHtml,
} from "@/components/ui/rich-text-editor";
import {
  ArrowLeft,
  Building2,
  User,
  ExternalLink,
  Sparkles,
  ThumbsUp,
  ThumbsDown,
  HelpCircle,
  Scale,
  FileText,
  Wrench,
  StickyNote,
  Save,
  Pencil,
  RefreshCw,
  ArrowRight,
} from "lucide-react";
import { api } from "@/api/apiClient";
import { fetchBillTextForAI } from "@/services/legiscan";

// ── Analysis shape helpers ───────────────────────────────────────────────────

const fromLines = (text) =>
  String(text ?? "")
    .split("\n")
    .map((line) =>
      line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim(),
    )
    .filter(Boolean);

const normalizeProse = (value) => {
  const text = String(value ?? "");
  return isRichTextHtml(text)
    ? sanitizeRichTextHtml(text)
    : plainTextToRichHtml(text);
};

const normalizeList = (value, ordered = false) => {
  if (Array.isArray(value)) return listToRichHtml(value, ordered);
  const text = String(value ?? "");
  if (isRichTextHtml(text)) return sanitizeRichTextHtml(text);
  return listToRichHtml(fromLines(text), ordered);
};

const RICH_TEXT_FIELDS = [
  "short_summary",
  "arguments_for",
  "arguments_against",
  "questions",
  "current_law",
  "what_it_does",
  "proposed_modifications",
  "misc_notes",
];

const normalizeAnalysis = (analysis = {}) => ({
  short_summary: normalizeProse(analysis.short_summary),
  arguments_for: normalizeList(analysis.arguments_for),
  arguments_against: normalizeList(analysis.arguments_against),
  questions: normalizeList(analysis.questions, true),
  current_law: normalizeProse(analysis.current_law),
  what_it_does: normalizeProse(analysis.what_it_does),
  proposed_modifications: normalizeProse(analysis.proposed_modifications),
  misc_notes: normalizeProse(analysis.misc_notes),
  generated_at: analysis.generated_at ?? null,
});

const hasAnyContent = (a) =>
  RICH_TEXT_FIELDS.some((field) => richTextHasContent(a[field]));

const sanitizeAnalysis = (analysis) => {
  const sanitized = { ...analysis };
  for (const field of RICH_TEXT_FIELDS) {
    sanitized[field] = sanitizeRichTextHtml(analysis[field]);
  }
  return sanitized;
};

const getStatusColor = (status) => {
  const colors = {
    introduced: "bg-blue-100 text-blue-800 border-blue-200",
    in_committee: "bg-yellow-100 text-yellow-800 border-yellow-200",
    passed_first_reading: "bg-purple-100 text-purple-800 border-purple-200",
    passed_second_reading: "bg-purple-100 text-purple-800 border-purple-200",
    passed_third_reading: "bg-green-100 text-green-800 border-green-200",
    sent_to_other_chamber: "bg-indigo-100 text-indigo-800 border-indigo-200",
    passed_both_chambers: "bg-green-100 text-green-800 border-green-200",
    sent_to_governor: "bg-orange-100 text-orange-800 border-orange-200",
    signed: "bg-emerald-100 text-emerald-800 border-emerald-200",
    vetoed: "bg-red-100 text-red-800 border-red-200",
    dead: "bg-gray-100 text-gray-800 border-gray-200",
  };
  return colors[status] || colors.introduced;
};

// Defined outside TrackedBillDetail so typing never remounts the active editor.
const AnalysisSection = ({ icon: Icon, iconClass, title, children }) => (
  <Card>
    <CardHeader className="pb-3">
      <CardTitle className="text-lg flex items-center gap-2">
        <Icon className={`w-5 h-5 ${iconClass}`} />
        {title}
      </CardTitle>
    </CardHeader>
    <CardContent>{children}</CardContent>
  </Card>
);

export default function TrackedBillDetail({
  bill,
  analysis,
  onSave,
  onBack,
  lcTracking,
}) {
  const saved = useMemo(() => normalizeAnalysis(analysis), [analysis]);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(saved);
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiError, setAiError] = useState("");

  // Re-sync local form whenever the saved analysis changes and we're not
  // mid-edit (e.g. switching to a different bill).
  useEffect(() => {
    if (!editing) setForm(saved);
  }, [saved, editing]);

  if (!bill) return null;

  const sponsors =
    Array.isArray(bill.sponsors) && bill.sponsors.length
      ? bill.sponsors
      : [bill.sponsor, ...(bill.co_sponsors || [])].filter(Boolean);
  const sponsorsText = sponsors.length ? sponsors.join(", ") : "Unknown";
  const pdfLink = bill.pdf_url || bill.url || null;
  const lcNumber = bill.lc_number || lcTracking?.current_lc;

  const setField = (key, value) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const persist = (next) => {
    const payload = sanitizeAnalysis({
      ...next,
      generated_at: next.generated_at ?? null,
    });
    setForm(payload);
    onSave(payload);
  };

  const handleSave = () => {
    persist(form);
    setEditing(false);
  };

  const handleCancel = () => {
    setForm(saved);
    setEditing(false);
  };

  const generateAnalysis = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    setAiError("");
    try {
      if (!bill.legiscan_id) {
        throw new Error(
          "Bill text is not available for this item, so AI analysis cannot be generated.",
        );
      }

      let billText = "";
      try {
        billText = await fetchBillTextForAI(bill.legiscan_id);
      } catch (err) {
        console.warn("Unable to fetch bill text for AI context", err);
      }
      if (!billText) {
        throw new Error(
          "Bill text is not available from LegiScan for this bill. AI analysis was not generated.",
        );
      }

      const aiContext = billText.slice(0, 30000);
      billText = null;

      const ocga =
        bill.ocga_sections_affected?.join(", ") || "various OCGA sections";

      const prompt = `You are a nonpartisan legislative policy analyst preparing a committee memo for Georgia bill ${bill.bill_number} titled "${bill.title}". This bill affects OCGA sections: ${ocga}.

Bill text and context:
${aiContext}

Return ONLY valid JSON with exactly these fields:
{
  "short_summary": "string",
  "arguments_for": ["string", "string", "string"],
  "arguments_against": ["string", "string", "string"],
  "questions": ["string", "string", "string", "string"],
  "current_law": "string",
  "what_it_does": "string",
  "proposed_modifications": "string",
  "misc_notes": "string"
}

Requirements:
- short_summary: 2-4 sentences in plain, neutral language summarizing the substantive changes the bill makes to current law. Start with the sponsor/representative context if available.
- arguments_for: exactly 3 distinct, substantive bullet points arguing FOR passage.
- arguments_against: exactly 3 distinct, substantive bullet points arguing AGAINST passage.
- questions: exactly 4 thoughtful, "outside the box" questions members should ask in committee. Avoid obvious yes/no questions; probe second-order effects, fiscal impact, enforcement, and unintended consequences.
- current_law: describe the relevant existing OCGA law that this bill changes, in neutral language.
- what_it_does: a detailed, structured breakdown of what the bill does. Use clear legislative language. Use line breaks / sub-points where helpful. If it creates an offense, outline who it applies to, prohibited conduct, and penalties. If it changes funding/fees, outline source, amounts, and distribution. If procedural, outline responsibilities, deadlines, and enforcement.
- proposed_modifications: suggested improvements to the bill, including any typo fixes or drafting/clarity issues you notice. If none, say so briefly.
- misc_notes: any miscellaneous notes, caveats, or useful resources/links. If none, say so briefly.
Maintain accuracy and track closely to the bill text. Be detailed but concise.`;

      const response = await api.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            short_summary: { type: "string" },
            arguments_for: { type: "array", items: { type: "string" } },
            arguments_against: { type: "array", items: { type: "string" } },
            questions: { type: "array", items: { type: "string" } },
            current_law: { type: "string" },
            what_it_does: { type: "string" },
            proposed_modifications: { type: "string" },
            misc_notes: { type: "string" },
          },
          required: ["short_summary", "what_it_does"],
        },
      });

      const next = normalizeAnalysis({
        ...response,
        generated_at: new Date().toISOString(),
      });

      setForm(next);
      setEditing(true); // let the user review/edit before it's considered final
      persist(next); // but also persist immediately so a refresh keeps it
    } catch (err) {
      console.error("Error generating bill analysis:", err);
      setAiError(
        err?.message ||
          "Failed to generate analysis. Check your AI API key and try again.",
      );
    }
    setIsGenerating(false);
  };

  const generated = hasAnyContent(saved) || hasAnyContent(form);

  return (
    <div className="space-y-6">
      {/* Back + actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Button
          variant="ghost"
          onClick={onBack}
          className="gap-2 text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        <div className="flex items-center gap-2">
          {!editing ? (
            <>
              <Button
                onClick={generateAnalysis}
                disabled={isGenerating}
                className="bg-purple-600 hover:bg-purple-700 gap-2"
              >
                {isGenerating ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    {generated ? "Regenerate" : "Generate Analysis"}
                  </>
                )}
              </Button>
              <Button variant="outline" onClick={() => setEditing(true)} className="gap-2">
                <Pencil className="w-4 h-4" />
                Edit
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={handleCancel}>
                Cancel
              </Button>
              <Button onClick={handleSave} className="bg-blue-600 hover:bg-blue-700 gap-2">
                <Save className="w-4 h-4" />
                Save
              </Button>
            </>
          )}
        </div>
      </div>

      {aiError && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
          {aiError}
        </div>
      )}

      {/* Bill header */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div
                className={`p-2 rounded-lg ${
                  bill.chamber === "house"
                    ? "bg-blue-100 text-blue-600"
                    : "bg-purple-100 text-purple-600"
                }`}
              >
                <Building2 className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-slate-900">
                  {bill.bill_number}
                  {lcNumber && (
                    <span className="ml-2 text-sm font-mono font-normal text-slate-400">
                      {lcNumber}
                    </span>
                  )}
                </h2>
                <p className="text-sm text-slate-500">
                  {bill.chamber === "house" ? "House" : "Senate"} · Session{" "}
                  {bill.session_year}
                </p>
              </div>
            </div>
            {pdfLink && (
              <Button variant="outline" size="sm" asChild className="gap-2">
                <a href={pdfLink} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-4 h-4" />
                  View PDF
                </a>
              </Button>
            )}
          </div>

          <h3 className="font-semibold text-slate-900 mt-4">{bill.title}</h3>

          <div className="flex items-center gap-2 mt-3 text-sm text-slate-600">
            <User className="w-4 h-4 text-slate-400 shrink-0" />
            <span>{sponsorsText}</span>
          </div>

          {lcTracking?.previous_lc &&
            lcTracking.previous_lc !== lcTracking.current_lc &&
            lcTracking.lc_changed_at &&
            Date.now() - new Date(lcTracking.lc_changed_at).getTime() <
              24 * 60 * 60 * 1000 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 mt-3 rounded-md bg-amber-50 border border-amber-200 text-sm w-fit">
                <RefreshCw className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span className="text-amber-800 font-medium">LC Changed:</span>
                <span className="font-mono text-amber-700">
                  {lcTracking.previous_lc}
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span className="font-mono text-amber-900 font-semibold">
                  {lcTracking.current_lc}
                </span>
              </div>
            )}

          <div className="flex flex-wrap gap-2 mt-4">
            {bill.status && (
              <Badge className={getStatusColor(bill.status)} variant="outline">
                {bill.status
                  .replace(/_/g, " ")
                  .replace(/\b\w/g, (l) => l.toUpperCase())}
              </Badge>
            )}
            {bill.current_committee && (
              <Badge variant="outline" className="text-xs font-normal">
                {bill.current_committee}
              </Badge>
            )}
          </div>

          {saved.generated_at && !editing && (
            <p className="text-xs text-slate-400 mt-4">
              AI analysis last generated{" "}
              {new Date(saved.generated_at).toLocaleString()}
            </p>
          )}
        </CardContent>
      </Card>

      {!generated && !editing && (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center">
            <Sparkles className="w-10 h-10 text-purple-300 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-slate-900">
              No analysis yet
            </h3>
            <p className="text-slate-600 mt-1 mb-4 max-w-md mx-auto">
              Generate an AI draft of the summary, arguments, questions, and
              law changes — then edit any section to refine it.
            </p>
            <Button
              onClick={generateAnalysis}
              disabled={isGenerating}
              className="bg-purple-600 hover:bg-purple-700 gap-2"
            >
              <Sparkles className="w-4 h-4" />
              Generate Analysis
            </Button>
          </CardContent>
        </Card>
      )}

      {(generated || editing) && (
        <>
          {/* Short summary */}
          <AnalysisSection
            icon={Sparkles}
            iconClass="text-purple-500"
            title="Short Summary"
          >
            {editing ? (
              <RichTextEditor
                minHeight={100}
                placeholder="A short, neutral summary of what the bill does..."
                value={form.short_summary}
                onChange={(value) => setField("short_summary", value)}
              />
            ) : (
              <RichTextContent value={saved.short_summary} />
            )}
          </AnalysisSection>

          {/* Arguments for / against */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <AnalysisSection
              icon={ThumbsUp}
              iconClass="text-green-600"
              title="Arguments For Passage"
            >
              {editing ? (
                <RichTextEditor
                  minHeight={150}
                  placeholder="Add supporting arguments, evidence, and expected benefits..."
                  value={form.arguments_for}
                  onChange={(value) => setField("arguments_for", value)}
                />
              ) : (
                <RichTextContent value={saved.arguments_for} />
              )}
            </AnalysisSection>

            <AnalysisSection
              icon={ThumbsDown}
              iconClass="text-red-600"
              title="Arguments Against Passage"
            >
              {editing ? (
                <RichTextEditor
                  minHeight={150}
                  placeholder="Add concerns, tradeoffs, and possible unintended consequences..."
                  value={form.arguments_against}
                  onChange={(value) => setField("arguments_against", value)}
                />
              ) : (
                <RichTextContent value={saved.arguments_against} />
              )}
            </AnalysisSection>
          </div>

          {/* Questions */}
          <AnalysisSection
            icon={HelpCircle}
            iconClass="text-amber-600"
            title="Questions for Members to Ask"
          >
            {editing ? (
              <RichTextEditor
                minHeight={150}
                placeholder="Add questions members should ask in committee..."
                value={form.questions}
                onChange={(value) => setField("questions", value)}
              />
            ) : (
              <RichTextContent value={saved.questions} />
            )}
          </AnalysisSection>

          {/* Current law */}
          <AnalysisSection
            icon={Scale}
            iconClass="text-slate-600"
            title="Current Law (OCGA)"
          >
            {editing ? (
              <RichTextEditor
                minHeight={130}
                placeholder="The relevant existing law this bill changes..."
                value={form.current_law}
                onChange={(value) => setField("current_law", value)}
              />
            ) : (
              <RichTextContent value={saved.current_law} />
            )}
          </AnalysisSection>

          {/* What it does */}
          <AnalysisSection
            icon={FileText}
            iconClass="text-blue-600"
            title="What Does This Bill Do?"
          >
            {editing ? (
              <RichTextEditor
                minHeight={180}
                placeholder="A detailed breakdown of the bill's provisions..."
                value={form.what_it_does}
                onChange={(value) => setField("what_it_does", value)}
              />
            ) : (
              <RichTextContent value={saved.what_it_does} />
            )}
          </AnalysisSection>

          {/* Proposed modifications */}
          <AnalysisSection
            icon={Wrench}
            iconClass="text-orange-600"
            title="Proposed Modifications"
          >
            {editing ? (
              <RichTextEditor
                minHeight={130}
                placeholder="Suggested changes, drafting fixes, typos..."
                value={form.proposed_modifications}
                onChange={(value) => setField("proposed_modifications", value)}
              />
            ) : (
              <RichTextContent value={saved.proposed_modifications} />
            )}
          </AnalysisSection>

          {/* Misc notes */}
          <AnalysisSection
            icon={StickyNote}
            iconClass="text-indigo-500"
            title="Miscellaneous Notes & Resources"
          >
            {editing ? (
              <RichTextEditor
                minHeight={130}
                placeholder="Notes, caveats, links to resources..."
                value={form.misc_notes}
                onChange={(value) => setField("misc_notes", value)}
              />
            ) : (
              <RichTextContent value={saved.misc_notes} />
            )}
          </AnalysisSection>
        </>
      )}
    </div>
  );
}
