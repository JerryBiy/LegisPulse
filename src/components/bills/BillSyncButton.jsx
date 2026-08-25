import { useState } from "react";
import {
  AlertCircle,
  CheckCircle,
  Download,
  RefreshCw,
  WrenchIcon,
} from "lucide-react";
import { useLegislativeSession } from "@/lib/LegislativeSessionContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

function isMaintenance(message) {
  return typeof message === "string" && message.toLowerCase().includes("maintenance");
}

export default function BillSyncButton({ onSyncComplete }) {
  const {
    sessions,
    isSyncingAllSessions,
    allSessionSyncProgress,
    syncAllSessions,
  } = useLegislativeSession();
  const [syncStatus, setSyncStatus] = useState(null);

  const handleSync = async () => {
    setSyncStatus(null);
    try {
      const result = await syncAllSessions();
      const failures = result?.failures?.length ?? 0;
      setSyncStatus({
        success: failures === 0,
        partial: failures > 0,
        message:
          failures > 0
            ? `Updated ${result.results.length - failures} of ${sessions.length} sessions. ${failures} failed.`
            : `All ${sessions.length} sessions are up to date.`,
        total: result?.totalBills ?? 0,
      });
      onSyncComplete?.();
    } catch (error) {
      const message = error?.message || "Failed to sync bills. Please try again.";
      setSyncStatus({
        success: false,
        maintenance: isMaintenance(message),
        message: isMaintenance(message)
          ? "LegiScan is currently offline for maintenance. Please try again later."
          : message,
      });
    }
  };

  const completed = allSessionSyncProgress.completed ?? 0;
  const total = allSessionSyncProgress.total || sessions.length;
  const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="space-y-3">
      <Button
        onClick={handleSync}
        disabled={isSyncingAllSessions || sessions.length === 0}
        className="bg-green-600 hover:bg-green-700 gap-2"
      >
        {isSyncingAllSessions ? (
          <>
            <RefreshCw className="w-4 h-4 animate-spin" />
            Syncing all sessions…
          </>
        ) : (
          <>
            <Download className="w-4 h-4" />
            Sync all sessions
          </>
        )}
      </Button>

      {isSyncingAllSessions && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-blue-900 font-medium truncate">
                {allSessionSyncProgress.currentSession || "Preparing LegiScan sessions…"}
              </span>
              <Badge className="bg-blue-600 text-white tabular-nums">
                {completed} / {total}
              </Badge>
            </div>
            <div className="w-full bg-blue-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-150"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <p className="text-xs text-blue-700">
              Updating every session so changing the global session never shows a stale bill list.
            </p>
          </CardContent>
        </Card>
      )}

      {syncStatus && (
        <Card
          className={
            syncStatus.success
              ? "border-green-200 bg-green-50"
              : syncStatus.maintenance || syncStatus.partial
                ? "border-amber-200 bg-amber-50"
                : "border-red-200 bg-red-50"
          }
        >
          <CardContent className="p-4 flex items-start gap-3">
            {syncStatus.success ? (
              <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
            ) : syncStatus.maintenance ? (
              <WrenchIcon className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            )}
            <div>
              <p className="font-medium">{syncStatus.message}</p>
              {syncStatus.total > 0 && (
                <p className="text-sm mt-1">Bills refreshed: {syncStatus.total}</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
