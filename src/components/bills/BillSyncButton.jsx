import { useState, useEffect, useRef } from "react";
import { api } from "@/api/apiClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw,
  Download,
  CheckCircle,
  AlertCircle,
  WrenchIcon,
  FileSearch,
  Landmark,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  fetchGABills,
  isLegiScanConfigured,
  fetchLCNumbersForBills,
  enrichBillsWithDetails,
} from "@/services/legiscan";

function isMaintenance(msg) {
  return typeof msg === "string" && msg.toLowerCase().includes("maintenance");
}

// Which phase of syncing are we in
// null | "bills" | "committees" | "lc"
function PhaseLabel({ phase }) {
  if (phase === "bills") return "Fetching bill list from LegiScan…";
  if (phase === "committees") return "Loading committee & history data…";
  if (phase === "lc") return "Fetching LC numbers for tracked bills…";
  return "Working…";
}

export default function BillSyncButton({ onSyncComplete, autoSync = false }) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [phase, setPhase] = useState(null); // "bills" | "committees" | "lc"
  const [phaseProgress, setPhaseProgress] = useState({ current: 0, total: 0 });
  const autoSyncFired = useRef(false);

  const syncBillsFromWebsite = async () => {
    setIsSyncing(true);
    setSyncStatus(null);
    setPhase(null);
    setPhaseProgress({ current: 0, total: 0 });

    try {
      if (!isLegiScanConfigured()) {
        throw new Error(
          "LegiScan API key not configured. Add VITE_LEGISCAN_API_KEY to your .env file.",
        );
      }

      // ── Phase 1: fetch master list ───────────────────────────────────────
      setPhase("bills");
      const bills = await fetchGABills();
      setPhaseProgress({ current: bills.length, total: bills.length });

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
          current_committee: bill.current_committee || null,
          url: bill.url,
          pdf_url: null,
          is_tracked: false,
          tags: [],
          // store change_hash so future syncs can skip unchanged bills
          extra: bill.change_hash ? { change_hash: bill.change_hash } : null,
        })),
      );

      // ── Phase 2: enrich every bill with committee name + full history ────
      // getMasterList only has pending_committee_id (an integer). The only
      // reliable source for committee.name and the complete history array is
      // the individual getBill endpoint. Without history, the Committees page
      // has no data for bills that have already left committee.
      setPhase("committees");
      setPhaseProgress({ current: 0, total: bills.length });

      try {
        const billsWithIds = bills.filter((b) => b.legiscan_id);
        const enriched = await enrichBillsWithDetails(
          billsWithIds,
          (current, total) => setPhaseProgress({ current, total }),
        );

        if (enriched.length > 0) {
          await api.entities.Bill.bulkUpdateCommitteeData(enriched);
          console.log(
            `[Committees] Enriched ${enriched.length} bills with committee + history data.`,
            `${enriched.filter((e) => e.current_committee).length} have an active committee assignment.`,
          );
        }
      } catch (enrichErr) {
        // Non-fatal — basic bill list is already saved
        console.warn("[Committees] Detail enrichment failed (non-fatal):", enrichErr);
      }

      // ── Phase 3: LC numbers for tracked bills ───────────────────────────
      setPhase("lc");
      try {
        const profile = await api.auth.me().catch(() => null);
        const personalTracked = profile?.tracked_bill_ids ?? [];

        const allTeamData = await api.entities.Team.getAll().catch(() => ({ teams: [] }));
        let teamBillNumbers = [];
        for (const team of allTeamData?.teams ?? []) {
          try {
            const nums = await api.entities.Team.getBillNumbers(team.id);
            teamBillNumbers = teamBillNumbers.concat(nums);
          } catch {
            /* skip */
          }
        }

        const allTrackedNumbers = [
          ...new Set([...personalTracked, ...teamBillNumbers]),
        ];
        const trackedBillsWithIds = bills.filter(
          (b) => allTrackedNumbers.includes(b.bill_number) && b.legiscan_id,
        );

        if (trackedBillsWithIds.length > 0) {
          setPhaseProgress({ current: 0, total: trackedBillsWithIds.length });

          const lcResults = await fetchLCNumbersForBills(
            trackedBillsWithIds,
            (current, total) => setPhaseProgress({ current, total }),
          );

          const lcEntries = Object.entries(lcResults)
            .filter(([, lc]) => lc)
            .map(([bill_number, lc_number]) => ({ bill_number, lc_number }));

          if (lcEntries.length > 0) {
            await api.entities.Bill.updateLcNumbers(lcEntries);
            await api.LcTracking.batchUpsert(lcEntries);
          }

          console.log(
            `[LC] Extracted LC numbers for ${lcEntries.length}/${trackedBillsWithIds.length} tracked bills`,
          );
        }
      } catch (lcErr) {
        console.warn("[LC] LC enrichment failed (non-fatal):", lcErr);
      }

      setPhase(null);
      setSyncStatus({
        success: true,
        message: `Synced ${bills.length} bills from LegiScan`,
        total: bills.length,
      });

      setTimeout(() => setSyncStatus(null), 4000);

      if (onSyncComplete) onSyncComplete();
    } catch (error) {
      const msg = error.message || "Failed to sync bills. Please try again.";
      setPhase(null);
      setSyncStatus({
        success: false,
        maintenance: isMaintenance(msg),
        message: isMaintenance(msg)
          ? "LegiScan API is currently offline for maintenance. Please try again later."
          : msg,
        error: isMaintenance(msg) ? null : msg,
      });
    }

    setIsSyncing(false);
  };

  useEffect(() => {
    if (autoSync && !autoSyncFired.current && !isSyncing) {
      autoSyncFired.current = true;
      if (syncStatus?.maintenance) return;
      syncBillsFromWebsite();
    }
  }, [autoSync, syncStatus?.maintenance]);

  const progressPct =
    phaseProgress.total > 0
      ? Math.round((phaseProgress.current / phaseProgress.total) * 100)
      : 0;

  const phaseIcon =
    phase === "committees" ? (
      <Landmark className="w-3 h-3" />
    ) : (
      <FileSearch className="w-3 h-3" />
    );

  return (
    <div className="space-y-3">
      <Button
        onClick={syncBillsFromWebsite}
        disabled={isSyncing}
        className={
          syncStatus?.maintenance
            ? "bg-amber-600 hover:bg-amber-700 gap-2"
            : "bg-green-600 hover:bg-green-700 gap-2"
        }
      >
        {isSyncing ? (
          <>
            <RefreshCw className="w-4 h-4 animate-spin" />
            Syncing from LegiScan…
          </>
        ) : syncStatus?.maintenance ? (
          <>
            <WrenchIcon className="w-4 h-4" />
            LegiScan Offline — Retry
          </>
        ) : (
          <>
            <Download className="w-4 h-4" />
            Sync Bills from LegiScan
          </>
        )}
      </Button>

      {isSyncing && phase && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-blue-900 font-medium">
                <PhaseLabel phase={phase} />
              </span>
              {phaseProgress.total > 0 && (
                <Badge className="bg-blue-600 text-white tabular-nums">
                  {phaseProgress.current} / {phaseProgress.total}
                </Badge>
              )}
            </div>

            {phaseProgress.total > 0 && (
              <div className="w-full bg-blue-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-150"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            )}

            <p className="text-xs text-blue-700 flex items-center gap-1">
              {phaseIcon}
              {phase === "committees"
                ? "Fetching full bill details so the Committees tab can show historical data. This takes a few minutes."
                : phase === "lc"
                  ? "Extracting LC draft numbers from bill texts…"
                  : "Downloading bill list…"}
            </p>
          </CardContent>
        </Card>
      )}

      {syncStatus && (
        <Card
          className={
            syncStatus.success
              ? "border-green-200 bg-green-50"
              : syncStatus.maintenance
                ? "border-amber-200 bg-amber-50"
                : "border-red-200 bg-red-50"
          }
        >
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              {syncStatus.success ? (
                <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
              ) : syncStatus.maintenance ? (
                <WrenchIcon className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              )}
              <div className="space-y-1">
                <p
                  className={`font-medium ${
                    syncStatus.success
                      ? "text-green-900"
                      : syncStatus.maintenance
                        ? "text-amber-900"
                        : "text-red-900"
                  }`}
                >
                  {syncStatus.message}
                </p>
                {syncStatus.success && (
                  <p className="text-sm text-green-800">
                    Total bills synced: <strong>{syncStatus.total}</strong>
                  </p>
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
