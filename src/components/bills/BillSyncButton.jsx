import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Download, CheckCircle, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function BillSyncButton({ onSyncComplete }) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [progress, setProgress] = useState({ current: 0, total: 0, newBills: 0 });

  const syncBillsFromWebsite = async () => {
    setIsSyncing(true);
    setSyncStatus(null);
    setProgress({ current: 0, total: 0, newBills: 0 });

    try {
      // Fetch current bills from database
      const existingBills = await base44.entities.Bill.list();
      const existingBillNumbers = new Set(existingBills.map(b => b.bill_number));

      setProgress(prev => ({ ...prev, total: 1 }));

      // Use InvokeLLM with web context to fetch bills from legis.ga.gov
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `Go to https://www.legis.ga.gov and find ALL bills for the 2025-2026 Georgia legislative session (this is a two-year consecutive session).

IMPORTANT: Get ALL bills starting from:
- House Bills: HB 1, HB 2, HB 3... up to the most recent HB number
- Senate Bills: SB 1, SB 2, SB 3... up to the most recent SB number
- House Resolutions: HR 1, HR 2... up to the most recent
- Senate Resolutions: SR 1, SR 2... up to the most recent

For EACH bill, extract:
- bill_number (e.g., HB 1, SB 23, HR 45, SR 12)
- title (official title)
- chamber (house or senate)
- bill_type (bill, resolution, or constitutional_amendment)
- sponsor (primary sponsor name)
- status (current status)
- last_action (most recent action description)
- last_action_date (date of last action)
- session_year (2025 or 2026 based on when it was introduced)

Return a comprehensive list of ALL bills from the 2025-2026 session.`,
        add_context_from_internet: true,
        response_json_schema: {
          type: "object",
          properties: {
            bills: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  bill_number: { type: "string" },
                  title: { type: "string" },
                  chamber: { type: "string" },
                  bill_type: { type: "string" },
                  sponsor: { type: "string" },
                  status: { type: "string" },
                  last_action: { type: "string" },
                  last_action_date: { type: "string" },
                  session_year: { type: "integer" }
                }
              }
            }
          }
        }
      });

      const bills = response.bills || [];
      setProgress(prev => ({ ...prev, total: bills.length }));

      // Filter out bills that already exist
      const newBills = bills.filter(bill => !existingBillNumbers.has(bill.bill_number));
      
      // Create new bills in database
      let created = 0;
      for (const bill of newBills) {
        try {
          await base44.entities.Bill.create({
            bill_number: bill.bill_number,
            title: bill.title,
            chamber: bill.chamber.toLowerCase(),
            bill_type: bill.bill_type || "bill",
            sponsor: bill.sponsor,
            session_year: bill.session_year || 2026,
            status: mapStatus(bill.status),
            last_action: bill.last_action,
            last_action_date: bill.last_action_date || new Date().toISOString().split('T')[0],
            is_tracked: false,
            tags: []
          });
          created++;
          setProgress(prev => ({ 
            ...prev, 
            current: prev.current + 1,
            newBills: created
          }));
        } catch (error) {
          console.error(`Error creating bill ${bill.bill_number}:`, error);
        }
      }

      setSyncStatus({
        success: true,
        message: `Synced ${bills.length} bills from 2025-2026 GA session`,
        newBills: created,
        total: bills.length
      });

      if (onSyncComplete) {
        onSyncComplete();
      }
    } catch (error) {
      console.error("Error syncing bills:", error);
      setSyncStatus({
        success: false,
        message: "Failed to sync bills. Please try again.",
        error: error.message
      });
    }

    setIsSyncing(false);
  };

  const mapStatus = (status) => {
    if (!status) return "introduced";
    const statusLower = status.toLowerCase();
    
    if (statusLower.includes("signed") || statusLower.includes("approved")) return "signed";
    if (statusLower.includes("veto")) return "vetoed";
    if (statusLower.includes("governor")) return "sent_to_governor";
    if (statusLower.includes("passed") && statusLower.includes("both")) return "passed_both_chambers";
    if (statusLower.includes("third reading")) return "passed_third_reading";
    if (statusLower.includes("second reading")) return "passed_second_reading";
    if (statusLower.includes("first reading")) return "passed_first_reading";
    if (statusLower.includes("committee")) return "in_committee";
    if (statusLower.includes("dead") || statusLower.includes("failed")) return "dead";
    
    return "introduced";
  };

  return (
    <div className="space-y-3">
      <Button
        onClick={syncBillsFromWebsite}
        disabled={isSyncing}
        className="bg-green-600 hover:bg-green-700 gap-2"
      >
        {isSyncing ? (
          <>
            <RefreshCw className="w-4 h-4 animate-spin" />
            Syncing from legis.ga.gov...
          </>
        ) : (
          <>
            <Download className="w-4 h-4" />
            Sync Bills from GA Legislature
          </>
        )}
      </Button>

      {isSyncing && progress.total > 0 && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="p-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-blue-900 font-medium">Processing bills...</span>
                <Badge className="bg-blue-600 text-white">
                  {progress.current} / {progress.total}
                </Badge>
              </div>
              <div className="w-full bg-blue-200 rounded-full h-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
              {progress.newBills > 0 && (
                <p className="text-xs text-blue-800">
                  Found {progress.newBills} new bills
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {syncStatus && (
        <Card className={syncStatus.success ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              {syncStatus.success ? (
                <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              )}
              <div className="space-y-1">
                <p className={`font-medium ${syncStatus.success ? "text-green-900" : "text-red-900"}`}>
                  {syncStatus.message}
                </p>
                {syncStatus.success && (
                  <div className="flex gap-3 text-sm text-green-800">
                    <span>New Bills: <strong>{syncStatus.newBills}</strong></span>
                    <span>Total: <strong>{syncStatus.total}</strong></span>
                    <span>Already Exists: <strong>{syncStatus.total - syncStatus.newBills}</strong></span>
                  </div>
                )}
                {syncStatus.error && (
                  <p className="text-xs text-red-700">{syncStatus.error}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}