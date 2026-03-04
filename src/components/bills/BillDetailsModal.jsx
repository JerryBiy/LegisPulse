import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  User,
  Calendar,
  Building2,
  AlertCircle,
  ExternalLink,
  Star,
  StarOff,
  Sparkles,
  BookOpen,
  Users,
  Shield,
  AlertTriangle,
  StickyNote,
  UserCheck,
  Check,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import { format } from "date-fns";
import { api } from "@/api/apiClient";
import { fetchBillPDFLink, fetchBillTextForAI } from "@/services/legiscan";

const isLikelyPdfUrl = (url) => {
  if (!url) return false;
  return String(url).toLowerCase().includes(".pdf");
};

const formatKeyLabel = (key) =>
  String(key || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

const formatAiText = (value) => {
  if (value === null || value === undefined) return "";

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";

    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        return formatAiText(parsed);
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => formatAiText(item))
      .filter(Boolean)
      .join("\n");
  }

  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, entryValue]) => {
        const formattedValue = formatAiText(entryValue);
        if (!formattedValue) return "";
        return `${formatKeyLabel(key)}: ${formattedValue}`;
      })
      .filter(Boolean)
      .join("\n");
  }

  return String(value);
};

const pickSectionText = (response, keys = []) => {
  if (!response || typeof response !== "object") return "";

  for (const key of keys) {
    const direct = formatAiText(response[key]);
    if (direct) return direct;
  }

  for (const nested of Object.values(response)) {
    if (!nested || typeof nested !== "object" || Array.isArray(nested))
      continue;
    for (const key of keys) {
      const nestedValue = formatAiText(nested[key]);
      if (nestedValue) return nestedValue;
    }
  }

  return "";
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

export default function BillDetailsModal({
  bill,
  isOpen,
  onClose,
  isTracked,
  onToggleTracking,
  onBillUpdate,
  isInTeam,
  onAddToTeam,
  teamMeta,
  onTeamMetaChange,
  teamMembers,
  personalMeta,
  onPersonalMetaChange,
  teams,
  teamBillMap,
  onToggleTeamBill,
  lcTracking,
}) {
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [generatedSummary, setGeneratedSummary] = useState(null);
  const [aiError, setAiError] = useState("");
  const [pdfLink, setPdfLink] = useState(null);
  const [pdfStatus, setPdfStatus] = useState("idle");
  const [resolvedSponsors, setResolvedSponsors] = useState([]);

  useEffect(() => {
    if (!bill) {
      setResolvedSponsors([]);
      return;
    }

    const initialSponsors =
      Array.isArray(bill.sponsors) && bill.sponsors.length
        ? bill.sponsors
        : [bill.sponsor, ...(bill.co_sponsors || [])].filter(Boolean);
    setResolvedSponsors(initialSponsors);
  }, [bill]);

  useEffect(() => {
    setGeneratedSummary(null);
    setAiError("");
  }, [bill?.id, isOpen]);

  useEffect(() => {
    if (!bill || !isOpen) return;

    const currentLink = bill?.pdf_url || bill?.url || null;
    const hasDirectPdf = isLikelyPdfUrl(currentLink);

    if (currentLink && hasDirectPdf) {
      setPdfLink(currentLink);
      setPdfStatus("ready");
      return;
    }

    // No direct PDF yet; attempt to fetch from LegiScan getBillText.
    if (currentLink) {
      setPdfLink(currentLink);
    } else {
      setPdfLink(null);
    }
    setPdfStatus("loading");

    if (bill.legiscan_id) {
      fetchBillPDFLink(bill.legiscan_id)
        .then(async (result) => {
          const link = result?.pdfLink || null;
          const sponsorNames = Array.isArray(result?.sponsorNames)
            ? result.sponsorNames
            : [];

          if (sponsorNames.length > 0) {
            setResolvedSponsors(sponsorNames);
          }

          if (link) {
            setPdfLink(link);
            setPdfStatus("ready");

            if (bill.id) {
              const primarySponsor =
                sponsorNames[0] || bill.sponsor || "Unknown";
              const coSponsors = sponsorNames.slice(1);
              const existingSponsors = Array.isArray(bill.sponsors)
                ? bill.sponsors
                : [];

              const needsPdfUpdate = link !== bill.pdf_url;
              const needsSponsorUpdate =
                sponsorNames.length > 0 &&
                (primarySponsor !== bill.sponsor ||
                  JSON.stringify(sponsorNames) !==
                    JSON.stringify(existingSponsors) ||
                  JSON.stringify(coSponsors) !==
                    JSON.stringify(
                      Array.isArray(bill.co_sponsors) ? bill.co_sponsors : [],
                    ));

              if (!needsPdfUpdate && !needsSponsorUpdate) {
                return;
              }

              try {
                const updatedBill = await api.entities.Bill.update(bill.id, {
                  pdf_url: link,
                  sponsor: primarySponsor,
                  sponsors: sponsorNames,
                  co_sponsors: coSponsors,
                });

                if (onBillUpdate && updatedBill) {
                  onBillUpdate(updatedBill);
                }
              } catch (error) {
                console.warn("Failed to cache resolved bill metadata", error);
              }
            }
          } else {
            setPdfStatus("notfound");
          }
        })
        .catch((err) => {
          console.error("Failed to fetch PDF link", err);
          setPdfStatus(currentLink ? "ready" : "notfound");
        });
    } else {
      setPdfStatus(currentLink ? "ready" : "notfound");
    }
  }, [bill, isOpen]);

  // Update document title when bill changes
  useEffect(() => {
    if (bill && isOpen) {
      document.title = `${bill.bill_number} - LegisPulse`;
    } else if (!isOpen) {
      document.title = "LegisPulse";
    }
  }, [bill, isOpen]);

  if (!bill) return null;

  const allSponsors =
    resolvedSponsors.length > 0
      ? resolvedSponsors
      : [bill.sponsor, ...(bill.co_sponsors || [])].filter(Boolean);
  const sponsorsText = allSponsors.length ? allSponsors.join(", ") : "Unknown";
  const safeBillSummary = formatAiText(bill.summary);
  const safeBillChanges = formatAiText(bill.changes_analysis);

  const generateAISummary = async () => {
    // Guard against double-clicks or concurrent invocations.
    if (isGeneratingSummary) return;
    setIsGeneratingSummary(true);
    setAiError("");
    try {
      const ocgaSections =
        bill.ocga_sections_affected?.join(", ") || "various sections";
      if (!bill.legiscan_id) {
        throw new Error(
          "Bill text is not available for this item, so AI summary cannot be generated.",
        );
      }

      let billTextContext = "";
      try {
        billTextContext = await fetchBillTextForAI(bill.legiscan_id);
      } catch (error) {
        console.warn("Unable to fetch bill text for AI context", error);
      }

      if (!billTextContext) {
        throw new Error(
          "Bill text is not available from LegiScan for this bill. AI summary was not generated.",
        );
      }

      // Trim context and release the full string reference to free memory.
      const aiContext = billTextContext.slice(0, 30000);
      billTextContext = null;

      const prompt = `You are analyzing Georgia legislative bill ${bill.bill_number} titled "${bill.title}".

    This bill affects OCGA sections: ${ocgaSections}

    Bill text and context:
    ${aiContext}

    Return ONLY valid JSON with exactly these two string fields:
    {
      "short_summary": "...",
      "what_does_this_do": "..."
    }

    Requirements:
    for short_summary: make one to two sentence in 7th grade language summarizing only the substantive changes the bill makes to current law.
    for what_does_this_do: 
    - Summarize only the substantive changes the bill makes to current law.
    - Use clear, neutral, legislative language suitable for caucus memos.
    - Do not include policy arguments or analysis.
    - Organize the summary in a logical structure based on the content of the bill.
    - Use bullet points when helpful.
    - If the bill creates or modifies an offense, clearly outline: Who it applies to; What conduct is prohibited; Penalties (fine ranges, jail/prison ranges, minimums and maximums); Any sentence limitations (probation, suspension, merger rules, etc.)
    - If the bill changes funding, taxes, or fees, clearly outline: Revenue source; Amounts or caps; Distribution formula; Effective dates
    - If the bill changes administrative or procedural law, clearly outline: Agency responsibilities; Reporting requirements; Deadlines; Enforcement mechanisms
    - If the bill includes presumptions, burden of proof standards, hardship provisions, or exceptions, include those.
    - Maintain accuracy and track closely to the bill text.
    - Be detailed but concise.`;

      console.groupCollapsed(
        `[AI Debug] Generate Summary payload for ${bill.bill_number}`,
      );
      console.log("Bill ID", bill.id);
      console.log("LegiScan ID", bill.legiscan_id);
      console.log("OCGA sections", ocgaSections);
      console.log("Bill text context length", aiContext.length);
      console.log("Bill text preview (start)", aiContext.slice(0, 1200));
      console.log(
        "Bill text preview (end)",
        aiContext.length > 1200 ? aiContext.slice(-1200) : aiContext,
      );
      console.log(
        "Bill text context truncated to 30000",
        aiContext.length >= 30000,
      );
      console.log("Prompt length", prompt.length);
      console.log("Prompt preview (start)", prompt.slice(0, 2000));
      console.log(
        "Prompt preview (end)",
        prompt.length > 2000 ? prompt.slice(-2000) : prompt,
      );
      console.groupEnd();

      const response = await api.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            short_summary: { type: "string" },
            what_does_this_do: { type: "string" },
          },
          required: ["short_summary", "what_does_this_do"],
        },
      });

      const normalizedSummary = {
        short_summary: pickSectionText(response, [
          "short_summary",
          "summary",
          "plain_summary",
          "plain_language_summary",
          "brief_summary",
          "overview",
        ]),
        what_does_this_do: pickSectionText(response, [
          "what_does_this_do",
          "detailed_summary",
          "details",
          "long_summary",
          "law_changes",
          "changes",
          "practical_impact",
          "impact",
        ]),
      };

      const hasAnySection = Object.values(normalizedSummary).some(Boolean);
      if (!hasAnySection) {
        const fallback = formatAiText(response);
        if (fallback) {
          normalizedSummary.short_summary = fallback;
        } else {
          throw new Error(
            "AI returned an empty summary. Please click Regenerate Summary.",
          );
        }
      }

      setGeneratedSummary(normalizedSummary);

      if (bill?.id) {
        const summaryText = normalizedSummary.short_summary;
        const changesText = normalizedSummary.what_does_this_do;

        const updatedBill = await api.entities.Bill.update(bill.id, {
          summary: summaryText,
          changes_analysis: changesText,
        });

        if (onBillUpdate && updatedBill) {
          onBillUpdate(updatedBill);
        }
      }
    } catch (error) {
      console.error("Error generating AI summary:", error);
      setAiError(
        error?.message ||
          "Failed to generate summary. Check your AI API key and try again.",
      );
    }
    setIsGeneratingSummary(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
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
                <h2 className="text-xl font-bold">{bill.bill_number}</h2>
                <p className="text-sm text-slate-500 font-normal">
                  {bill.chamber === "house" ? "House" : "Senate"} | Session{" "}
                  {bill.session_year}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onToggleTracking(bill.id, bill.bill_number)}
              >
                {isTracked ? (
                  <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />
                ) : (
                  <StarOff className="w-5 h-5 text-slate-400" />
                )}
              </Button>
              {/* Multi-team dropdown */}
              {teams && teams.length > 0 && onToggleTeamBill && bill && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant={
                        teams.some((t) =>
                          (teamBillMap?.[t.id] ?? []).includes(
                            bill.bill_number,
                          ),
                        )
                          ? "default"
                          : "outline"
                      }
                      size="sm"
                      className={
                        teams.some((t) =>
                          (teamBillMap?.[t.id] ?? []).includes(
                            bill.bill_number,
                          ),
                        )
                          ? "bg-green-600 hover:bg-green-700 text-white gap-2"
                          : "border-green-200 text-green-600 hover:bg-green-50 gap-2"
                      }
                    >
                      <Users className="w-4 h-4" />
                      {teams.some((t) =>
                        (teamBillMap?.[t.id] ?? []).includes(bill.bill_number),
                      )
                        ? `In ${teams.filter((t) => (teamBillMap?.[t.id] ?? []).includes(bill.bill_number)).length} Team${teams.filter((t) => (teamBillMap?.[t.id] ?? []).includes(bill.bill_number)).length !== 1 ? "s" : ""}`
                        : "Add to Team"}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[180px]">
                    {teams.map((t) => {
                      const inThisTeam = (teamBillMap?.[t.id] ?? []).includes(
                        bill.bill_number,
                      );
                      return (
                        <DropdownMenuItem
                          key={t.id}
                          onClick={(e) => {
                            e.preventDefault();
                            onToggleTeamBill(t.id, bill.bill_number);
                          }}
                          className="flex items-center gap-2 cursor-pointer"
                        >
                          <span
                            className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                              inThisTeam
                                ? "bg-green-600 border-green-600"
                                : "border-slate-300"
                            }`}
                          >
                            {inThisTeam && (
                              <Check className="w-3 h-3 text-white" />
                            )}
                          </span>
                          <span className="text-sm truncate">{t.name}</span>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {/* Legacy single-team button */}
              {onAddToTeam && !teams?.length && (
                <Button
                  variant={isInTeam ? "default" : "outline"}
                  size="sm"
                  onClick={onAddToTeam}
                  className={
                    isInTeam
                      ? "bg-green-600 hover:bg-green-700 text-white gap-2"
                      : "border-green-200 text-green-600 hover:bg-green-50 gap-2"
                  }
                >
                  <Users className="w-4 h-4" />
                  {isInTeam ? "In Team" : "Add to Team"}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={pdfStatus !== "ready"}
                onClick={() => {
                  if (pdfLink) {
                    window.open(pdfLink, "_blank", "noopener,noreferrer");
                  }
                }}
                className="gap-2"
              >
                <ExternalLink className="w-4 h-4" />
                {pdfStatus === "ready"
                  ? "View PDF"
                  : pdfStatus === "loading"
                    ? "Fetching PDF..."
                    : "PDF not available"}
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Bill Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Bill Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="font-semibold text-slate-900 mb-2">
                  {bill.title}
                </h3>
                {(bill.lc_number || lcTracking?.current_lc) && (
                  <div className="space-y-1">
                    <p className="text-sm text-slate-500 font-mono">
                      LC Number: {bill.lc_number || lcTracking?.current_lc}
                    </p>
                    {lcTracking?.previous_lc &&
                      lcTracking.previous_lc !== lcTracking.current_lc && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-amber-50 border border-amber-200 text-sm">
                          <RefreshCw className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                          <span className="text-amber-800 font-medium">
                            LC Changed:
                          </span>
                          <span className="font-mono text-amber-700">
                            {lcTracking.previous_lc}
                          </span>
                          <ArrowRight className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                          <span className="font-mono text-amber-900 font-semibold">
                            {lcTracking.current_lc}
                          </span>
                        </div>
                      )}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-4">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-slate-400" />
                  <span className="text-sm">
                    <strong>Sponsors:</strong> {sponsorsText}
                  </span>
                </div>
                {bill.last_action_date && (
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-slate-400" />
                    <span className="text-sm">
                      <strong>Last Action:</strong>{" "}
                      {format(new Date(bill.last_action_date), "MMM d, yyyy")}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge
                  className={getStatusColor(bill.status)}
                  variant="outline"
                >
                  {bill.status
                    .replace(/_/g, " ")
                    .replace(/\b\w/g, (l) => l.toUpperCase())}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {bill.bill_type.replace(/_/g, " ")}
                </Badge>
              </div>

              {bill.current_committee && (
                <div className="flex items-center gap-2 p-3 bg-orange-50 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-orange-500" />
                  <span className="text-sm text-slate-700">
                    <strong>Current Committee:</strong> {bill.current_committee}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* OCGA Sections Affected */}
          {bill.ocga_sections_affected &&
            bill.ocga_sections_affected.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <BookOpen className="w-5 h-5" />
                    OCGA Sections Affected
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {bill.ocga_sections_affected.map((section, index) => (
                      <Badge
                        key={index}
                        variant="outline"
                        className="font-mono"
                      >
                        {section}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

          {/* Team Notes — only when opened from team context */}
          {teamMeta && onTeamMetaChange && (
            <Card className="border-indigo-200 bg-indigo-50/30">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <StickyNote className="w-5 h-5 text-indigo-500" />
                  Team Notes
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Flag */}
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium text-slate-700 w-32 shrink-0">
                    Risk Flag
                  </label>
                  <Select
                    value={teamMeta.flag || "_none"}
                    onValueChange={(val) =>
                      onTeamMetaChange({ flag: val === "_none" ? null : val })
                    }
                  >
                    <SelectTrigger className="h-9 w-[160px]">
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">
                        <span className="text-slate-400">None</span>
                      </SelectItem>
                      <SelectItem value="low">
                        <span className="flex items-center gap-1 text-green-700">
                          <Shield className="w-3 h-3" /> Low Risk
                        </span>
                      </SelectItem>
                      <SelectItem value="high">
                        <span className="flex items-center gap-1 text-red-700">
                          <AlertTriangle className="w-3 h-3" /> High Risk
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Policy Assistant */}
                {teamMembers && teamMembers.length > 0 && (
                  <div className="flex items-center gap-3">
                    <label className="text-sm font-medium text-slate-700 w-32 shrink-0">
                      Policy Assistant
                    </label>
                    <Select
                      value={teamMeta.policy_assistant || "_none"}
                      onValueChange={(val) =>
                        onTeamMetaChange({
                          policy_assistant: val === "_none" ? null : val,
                        })
                      }
                    >
                      <SelectTrigger className="h-9 w-[220px]">
                        <SelectValue placeholder="Unassigned" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">
                          <span className="text-slate-400">Unassigned</span>
                        </SelectItem>
                        {teamMembers.map((m) => (
                          <SelectItem key={m.user_id} value={m.user_id}>
                            {m.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Bill Summary Notes */}
                <div>
                  <label className="text-sm font-medium text-slate-700 block mb-1">
                    Bill Summary Notes
                  </label>
                  <Textarea
                    placeholder="Add team notes about this bill..."
                    className="min-h-[100px] resize-y"
                    defaultValue={teamMeta.bill_summary_notes || ""}
                    onBlur={(e) =>
                      onTeamMetaChange({ bill_summary_notes: e.target.value })
                    }
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Personal Notes — only when opened from tracked bills context */}
          {personalMeta && onPersonalMetaChange && (
            <Card className="border-blue-200 bg-blue-50/30">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <StickyNote className="w-5 h-5 text-blue-500" />
                  My Notes
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Flag */}
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium text-slate-700 w-32 shrink-0">
                    Risk Flag
                  </label>
                  <Select
                    value={personalMeta.flag || "_none"}
                    onValueChange={(val) =>
                      onPersonalMetaChange({
                        flag: val === "_none" ? null : val,
                      })
                    }
                  >
                    <SelectTrigger className="h-9 w-[160px]">
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">
                        <span className="text-slate-400">None</span>
                      </SelectItem>
                      <SelectItem value="low">
                        <span className="flex items-center gap-1 text-green-700">
                          <Shield className="w-3 h-3" /> Low Risk
                        </span>
                      </SelectItem>
                      <SelectItem value="high">
                        <span className="flex items-center gap-1 text-red-700">
                          <AlertTriangle className="w-3 h-3" /> High Risk
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Bill Summary Notes */}
                <div>
                  <label className="text-sm font-medium text-slate-700 block mb-1">
                    Bill Summary Notes
                  </label>
                  <Textarea
                    placeholder="Add your personal notes about this bill..."
                    className="min-h-[100px] resize-y"
                    defaultValue={personalMeta.bill_summary_notes || ""}
                    onBlur={(e) =>
                      onPersonalMetaChange({
                        bill_summary_notes: e.target.value,
                      })
                    }
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* AI Summary Section */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-purple-500" />
                  AI Analysis
                </CardTitle>
                <Button
                  onClick={generateAISummary}
                  disabled={isGeneratingSummary}
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  {isGeneratingSummary ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      {safeBillSummary || generatedSummary
                        ? "Regenerate Summary"
                        : "Generate Summary"}
                    </>
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {aiError && (
                <p className="text-sm text-red-600 mb-4">{aiError}</p>
              )}
              {safeBillSummary ? (
                <div className="prose prose-slate max-w-none">
                  <div>
                    <h4 className="font-semibold text-slate-900 mb-2">
                      Short Summary:
                    </h4>
                    <p className="whitespace-pre-line">{safeBillSummary}</p>
                  </div>
                  {safeBillChanges && (
                    <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                      <h4 className="font-semibold text-blue-900 mb-2">
                        What does this do:
                      </h4>
                      <p className="text-blue-800 whitespace-pre-line">
                        {safeBillChanges}
                      </p>
                    </div>
                  )}
                </div>
              ) : generatedSummary ? (
                <div className="space-y-4">
                  <div>
                    <h4 className="font-semibold text-slate-900 mb-2">
                      Short Summary:
                    </h4>
                    <p className="text-slate-700 whitespace-pre-line">
                      {generatedSummary.short_summary}
                    </p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-slate-900 mb-2">
                      What does this do:
                    </h4>
                    <p className="text-slate-700 whitespace-pre-line">
                      {generatedSummary.what_does_this_do}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-slate-500 italic">
                  No AI analysis available. Click "Generate Summary" to create
                  one.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Substitute Bills */}
          {bill.substitute_bills && bill.substitute_bills.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Substitute Versions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {bill.substitute_bills.map((sub, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-3 border border-slate-200 rounded-lg"
                    >
                      <div>
                        <p className="font-semibold">{sub.substitute_number}</p>
                        <p className="text-sm text-slate-500">
                          {sub.lc_number}
                        </p>
                        {sub.date_introduced && (
                          <p className="text-sm text-slate-500">
                            {format(
                              new Date(sub.date_introduced),
                              "MMM d, yyyy",
                            )}
                          </p>
                        )}
                      </div>
                      {sub.pdf_url && (
                        <Button variant="outline" size="sm" asChild>
                          <a
                            href={sub.pdf_url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink className="w-4 h-4 mr-2" />
                            View PDF
                          </a>
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
