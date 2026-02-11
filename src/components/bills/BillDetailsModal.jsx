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
} from "lucide-react";
import { format } from "date-fns";
import { api as base44 } from "@/api/apiClient";

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
}) {
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [generatedSummary, setGeneratedSummary] = useState(null);

  // Update document title when bill changes
  useEffect(() => {
    if (bill && isOpen) {
      document.title = `${bill.bill_number} - LegisPulse`;
    } else if (!isOpen) {
      document.title = "LegisPulse";
    }
  }, [bill, isOpen]);

  if (!bill) return null;

  const generateAISummary = async () => {
    setIsGeneratingSummary(true);
    try {
      const ocgaSections =
        bill.ocga_sections_affected?.join(", ") || "various sections";
      const prompt = `Analyze Georgia legislative bill ${bill.bill_number} titled "${bill.title}".

This bill affects OCGA sections: ${ocgaSections}

Please provide:
1. A high school level summary explaining what this bill does in simple terms
2. What specific changes it makes to Georgia law
3. Who would be affected by these changes
4. The practical impact on citizens, businesses, or government

Keep the language accessible and explain any legal terms. Focus on real-world implications.`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            plain_language_summary: { type: "string" },
            law_changes: { type: "string" },
            affected_parties: { type: "string" },
            practical_impact: { type: "string" },
          },
        },
      });

      setGeneratedSummary(response);
    } catch (error) {
      console.error("Error generating AI summary:", error);
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
                  {bill.chamber === "house" ? "House" : "Senate"} • Session{" "}
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
              {bill.pdf_url && (
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={bill.pdf_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    View PDF
                  </a>
                </Button>
              )}
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
                {bill.lc_number && (
                  <p className="text-sm text-slate-500 font-mono">
                    LC Number: {bill.lc_number}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-4">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-slate-400" />
                  <span className="text-sm">
                    <strong>Sponsor:</strong> {bill.sponsor}
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

          {/* AI Summary Section */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-purple-500" />
                  AI Analysis
                </CardTitle>
                {!bill.summary && !generatedSummary && (
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
                        Generate Summary
                      </>
                    )}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {bill.summary ? (
                <div className="prose prose-slate max-w-none">
                  <p>{bill.summary}</p>
                  {bill.changes_analysis && (
                    <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                      <h4 className="font-semibold text-blue-900 mb-2">
                        Changes Analysis:
                      </h4>
                      <p className="text-blue-800">{bill.changes_analysis}</p>
                    </div>
                  )}
                </div>
              ) : generatedSummary ? (
                <div className="space-y-4">
                  <div>
                    <h4 className="font-semibold text-slate-900 mb-2">
                      Plain Language Summary:
                    </h4>
                    <p className="text-slate-700">
                      {generatedSummary.plain_language_summary}
                    </p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-slate-900 mb-2">
                      Law Changes:
                    </h4>
                    <p className="text-slate-700">
                      {generatedSummary.law_changes}
                    </p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-slate-900 mb-2">
                      Affected Parties:
                    </h4>
                    <p className="text-slate-700">
                      {generatedSummary.affected_parties}
                    </p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-slate-900 mb-2">
                      Practical Impact:
                    </h4>
                    <p className="text-slate-700">
                      {generatedSummary.practical_impact}
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
                          LC: {sub.lc_number}
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
