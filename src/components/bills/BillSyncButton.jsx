import { useState, useEffect, useRef } from "react";
import { api } from "@/api/apiClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Download, CheckCircle, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { fetchGABills, isLegiScanConfigured } from "@/services/legiscan";

export default function BillSyncButton({ onSyncComplete, autoSync = false }) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [progress, setProgress] = useState({
    current: 0,
    total: 0,
    newBills: 0,
  });
  const autoSyncFired = useRef(false);

  const syncBillsFromWebsite = async () => {
    setIsSyncing(true);
    setSyncStatus(null);
    setProgress({ current: 0, total: 0, newBills: 0 });

    try {
      // Check if LegiScan is configured
      if (!isLegiScanConfigured()) {
        throw new Error(
          "LegiScan API key not configured. Add VITE_LEGISCAN_API_KEY to your .env file.",
        );
      }

      // Fetch bills from LegiScan API and replace store completely to ensure URLs are present
      const bills = await fetchGABills();
      setProgress((prev) => ({ ...prev, total: bills.length }));

      await api.entities.Bill.clearAll();
      await api.entities.Bill.replaceAll(
        bills.map((bill) => ({
          legiscan_id: bill.legiscan_id,
          bill_number: bill.bill_number,
          title: bill.title,
          chamber: bill.chamber,
          bill_type: bill.bill_type,
          sponsor: bill.sponsor,
          sponsor_party: bill.sponsor_party || null,
          sponsors: bill.sponsors || [],
          co_sponsors: bill.co_sponsors || [],
          session_year: bill.session_year,
          status: bill.status,
          last_action: bill.last_action,
          last_action_date: bill.last_action_date,
          url: bill.url,
          pdf_url: null,
          is_tracked: false,
          tags: [],
        })),
      );

      setSyncStatus({
        success: true,
        message: `Synced ${bills.length} bills from LegiScan`,
        newBills: bills.length,
        total: bills.length,
      });

      if (onSyncComplete) {
        onSyncComplete();
      }
    } catch (error) {
      console.error("Error syncing bills:", error);
      setSyncStatus({
        success: false,
        message: error.message || "Failed to sync bills. Please try again.",
        error: error.message,
      });
    }

    setIsSyncing(false);
  };

  useEffect(() => {
    if (autoSync && !autoSyncFired.current && !isSyncing) {
      autoSyncFired.current = true;
      syncBillsFromWebsite();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSync]);

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
            Syncing from LegiScan...
          </>
        ) : (
          <>
            <Download className="w-4 h-4" />
            Sync Bills from LegiScan
          </>
        )}
      </Button>

      {isSyncing && progress.total > 0 && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="p-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-blue-900 font-medium">
                  Processing bills...
                </span>
                <Badge className="bg-blue-600 text-white">
                  {progress.current} / {progress.total}
                </Badge>
              </div>
              <div className="w-full bg-blue-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{
                    width: `${(progress.current / progress.total) * 100}%`,
                  }}
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
        <Card
          className={
            syncStatus.success
              ? "border-green-200 bg-green-50"
              : "border-red-200 bg-red-50"
          }
        >
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              {syncStatus.success ? (
                <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              )}
              <div className="space-y-1">
                <p
                  className={`font-medium ${syncStatus.success ? "text-green-900" : "text-red-900"}`}
                >
                  {syncStatus.message}
                </p>
                {syncStatus.success && (
                  <div className="flex gap-3 text-sm text-green-800">
                    <span>
                      New Bills: <strong>{syncStatus.newBills}</strong>
                    </span>
                    <span>
                      Total: <strong>{syncStatus.total}</strong>
                    </span>
                    <span>
                      Already Exists:{" "}
                      <strong>{syncStatus.total - syncStatus.newBills}</strong>
                    </span>
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
