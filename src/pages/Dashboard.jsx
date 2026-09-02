import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/apiClient";
import { useAuth } from "@/lib/AuthContext";
import { FileText, Globe } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import BillCard from "../components/bills/BillCard";
import BillFilters from "../components/bills/BillFilters";
import BillDetailsModal from "../components/bills/BillDetailsModal";
import BillSyncButton from "../components/bills/BillSyncButton";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/lib/supabase";
import {
  getSessionDisplayName,
  useLegislativeSession,
} from "@/lib/LegislativeSessionContext";

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [displayCount, setDisplayCount] = useState(() => {
    const saved = sessionStorage.getItem("dashboard-display-count");
    return saved ? Math.max(10, parseInt(saved, 10)) : 10;
  });
  const [filters, setFilters] = useState({
    search: "",
    chamber: null,
    bill_type: null,
    status: null,
  });
  const [selectedBill, setSelectedBill] = useState(null);
  const { user: authUser } = useAuth();
  const {
    state,
    selectedSession,
    selectedSessionId,
    isReady,
  } = useLegislativeSession();

  const { data: rawBills = [], isLoading } = useQuery({
    queryKey: ["bills", state, selectedSessionId],
    queryFn: () => api.entities.Bill.list(selectedSessionId, undefined, state),
    enabled: isReady,
  });

  const { data: trackedBillIds = [] } = useQuery({
    queryKey: ["trackedBills", state, selectedSessionId],
    queryFn: () => api.entities.TrackedBill.getNumbers(selectedSessionId, state),
    enabled: isReady,
  });

  // ── Team ────────────────────────────────────────────────────────────────────
  const { data: allTeamData } = useQuery({
    queryKey: ["allTeams"],
    queryFn: () =>
      api.entities.Team.getAll().catch((err) => {
        console.error("[Team] getAll failed:", err?.message, err);
        return { teams: [], __pendingInvites: [] };
      }),
    staleTime: 0,
    retry: 1,
  });
  const allTeams = allTeamData?.teams ?? [];

  // ── LC Tracking data ────────────────────────────────────────────────────────
  const { data: lcTrackingMap = {} } = useQuery({
    queryKey: ["lcTracking", state, selectedSessionId],
    queryFn: () => api.LcTracking.getAll(selectedSessionId, state),
    enabled: isReady,
  });

  // Session-wide LC lookup (every bill, not just tracked) so untracked
  // dashboard cards can still show their LC number. Cached for a while
  // since the background job only updates it hourly.
  const { data: globalLcMap = {} } = useQuery({
    queryKey: ["lcGlobalMap", state, selectedSessionId],
    queryFn: () => api.LcTracking.getGlobalLcMap(selectedSessionId, state),
    enabled: isReady,
    staleTime: 10 * 60 * 1000,
  });

  // Merge: prefer the rich tracked-bill entry (has change-notification
  // state), otherwise fall back to a minimal entry from the global map.
  const lcFor = useCallback(
    (billNumber) => {
      const tracked = lcTrackingMap[billNumber];
      if (tracked) return tracked;
      const lc = globalLcMap[billNumber];
      return lc ? { current_lc: lc } : null;
    },
    [lcTrackingMap, globalLcMap],
  );

  // Use individual useQuery for each team's bills
  const { data: teamBillMap = {} } = useQuery({
    queryKey: [
      "allTeamBills",
      state,
      selectedSessionId,
      allTeams.map((t) => t.id).join(","),
    ],
    queryFn: async () => {
      // Always fetch from DB — never use manual cache shortcut.
      // An empty cached array is truthy, so `if (cached)` would silently
      // return stale data and teammates would miss pre-existing bills.
      const entries = await Promise.all(
        allTeams.map(async (t) => {
          const nums = await api.entities.Team.getBillNumbers(
            t.id,
            selectedSessionId,
            state,
          );
          queryClient.setQueryData(
            ["teamBills", t.id, state, selectedSessionId],
            nums,
          );
          return [t.id, nums];
        }),
      );
      return Object.fromEntries(entries);
    },
    enabled: isReady && allTeams.length > 0,
    staleTime: 0,
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!allTeams.length) return;

    const channels = allTeams.map((team) =>
      supabase
        .channel(`dashboard-team-bills-${team.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "team_bills",
            filter: `team_id=eq.${team.id}`,
          },
          () => {
            queryClient.invalidateQueries({
              queryKey: ["teamBills", team.id, state, selectedSessionId],
            });
            queryClient.invalidateQueries({ queryKey: ["allTeamBills"] });
            queryClient.invalidateQueries({ queryKey: ["allTeamBillNumbers"] });
            queryClient.invalidateQueries({ queryKey: ["sharedTeamBillData"] });
          },
        )
        .subscribe(),
    );

    return () => {
      channels.forEach((channel) => {
        supabase.removeChannel(channel);
      });
    };
  }, [allTeams, queryClient, selectedSessionId, state]);

  const teamBillMutation = useMutation({
    mutationFn: ({
      teamId,
      action,
      billNumber,
      bill,
      sessionId,
      scopeState,
    }) =>
      action === "add"
        ? api.entities.Team.addBill(teamId, bill, sessionId, scopeState)
        : api.entities.Team.removeBill(
            teamId,
            billNumber,
            sessionId,
            scopeState,
          ),
    onMutate: async ({ teamId, action, billNumber, teamKey, combinedKey }) => {
      await queryClient.cancelQueries({ queryKey: teamKey });
      await queryClient.cancelQueries({ queryKey: combinedKey });
      const prev = queryClient.getQueryData(teamKey);
      const prevCombined = queryClient.getQueryData(combinedKey);
      queryClient.setQueryData(teamKey, (old) =>
        action === "add"
          ? [...(old ?? []), billNumber]
          : (old ?? []).filter((n) => n !== billNumber),
      );
      // Also optimistically update the combined map
      queryClient.setQueryData(combinedKey, (old) => {
        if (!old) return old;
        const teamNums = old[teamId] ?? [];
        return {
          ...old,
          [teamId]:
            action === "add"
              ? [...teamNums, billNumber]
              : teamNums.filter((n) => n !== billNumber),
        };
      });
      return { combinedKey, prev, prevCombined, teamKey };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.teamKey) {
        queryClient.setQueryData(ctx.teamKey, ctx.prev);
        queryClient.setQueryData(ctx.combinedKey, ctx.prevCombined);
      }
    },
    onSettled: (_d, _e, { teamKey, combinedKey }) => {
      queryClient.invalidateQueries({
        queryKey: teamKey,
      });
      queryClient.invalidateQueries({
        queryKey: combinedKey,
      });
      queryClient.invalidateQueries({ queryKey: ["allTeamBillNumbers"] });
    },
  });

  const handleToggleTeamBill = (teamId, billNumber) => {
    const currentNums = teamBillMap[teamId] ?? [];
    const isCurrentlyInTeam = currentNums.includes(billNumber);
    const sessionId = selectedSessionId;
    const scopeState = state;
    const teamKey = ["teamBills", teamId, scopeState, sessionId];
    const combinedKey = [
      "allTeamBills",
      scopeState,
      sessionId,
      allTeams.map((team) => team.id).join(","),
    ];
    teamBillMutation.mutate({
      teamId,
      action: isCurrentlyInTeam ? "remove" : "add",
      billNumber,
      bill:
        rawBills.find((candidate) => candidate.bill_number === billNumber) ||
        billNumber,
      combinedKey,
      scopeState,
      sessionId,
      teamKey,
    });
    const team = allTeams.find((t) => t.id === teamId);
    toast({
      title: isCurrentlyInTeam ? "Removed from team" : "Added to team",
      description: `${billNumber} ${isCurrentlyInTeam ? "removed from" : "added to"} ${team?.name ?? "team"}.`,
      duration: 3000,
    });
  };

  const trackMutation = useMutation({
    mutationFn: ({ action, bill, sessionId, scopeState }) =>
      action === "add"
        ? api.entities.TrackedBill.add(sessionId, bill, scopeState)
        : api.entities.TrackedBill.remove(
            sessionId,
            bill.bill_number,
            scopeState,
          ),
    onMutate: async ({ action, bill, trackedKey }) => {
      const key = trackedKey;
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      queryClient.setQueryData(key, (old = []) =>
        action === "add"
          ? [...new Set([...old, bill.bill_number])]
          : old.filter((number) => number !== bill.bill_number),
      );
      return { previous, key };
    },
    onError: (_err, _variables, context) => {
      if (context?.key) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },
    onSettled: (_data, _error, { trackedKey }) =>
      queryClient.invalidateQueries({
        queryKey: trackedKey,
      }),
  });

  const fixBillTypes = (bills) => {
    // Determine bill type from bill number
    return bills.map((bill) => {
      if (!bill.bill_number) return bill;
      const normalized = bill.bill_number.trim().toUpperCase();
      const correctType =
        normalized.startsWith("HR") || normalized.startsWith("SR")
          ? "resolution"
          : "bill";

      // Only update if different
      if (bill.bill_type !== correctType) {
        return { ...bill, bill_type: correctType };
      }
      return bill;
    });
  };

  const bills = useMemo(() => {
    const correctedBills = fixBillTypes(rawBills);
    correctedBills.sort((a, b) => {
      const numA = parseInt(
        String(a.bill_number).replace(/\D/g, "") || "0",
        10,
      );
      const numB = parseInt(
        String(b.bill_number).replace(/\D/g, "") || "0",
        10,
      );
      return numB - numA;
    });
    return correctedBills;
  }, [rawBills]);

  const filteredBills = useMemo(() => {
    let filtered = bills;

    if (filters.search) {
      const normalize = (value) =>
        String(value || "")
          .toLowerCase()
          .normalize("NFKD")
          .replace(/\p{Diacritic}/gu, "")
          .replace(/[^a-z0-9]+/g, " ")
          .trim();

      const normalizeCompact = (value) => normalize(value).replace(/\s+/g, "");

      const searchTokens = normalize(filters.search)
        .split(/\s+/)
        .filter(Boolean);

      const searchCompact = normalizeCompact(filters.search);

      // Check if search looks like a bill number (e.g., HB, HR, SB, SR)
      const isBillNumberSearch = /^(hb|hr|sb|sr|hc|sc)/.test(searchCompact);

      if (isBillNumberSearch) {
        const exactBillMatch = searchCompact.match(
          /^(hb|hr|sb|sr|hc|sc)(\d+)$/,
        );

        // For exact bill-number input like "hb10" or "hb 10", require exact match.
        if (exactBillMatch) {
          const queryPrefix = exactBillMatch[1];
          const queryNumber = parseInt(exactBillMatch[2], 10);

          filtered = filtered.filter((bill) => {
            const billCompact = normalizeCompact(bill.bill_number);
            const billMatch = billCompact.match(/^(hb|hr|sb|sr|hc|sc)(\d+)$/);
            if (!billMatch) return false;

            const billPrefix = billMatch[1];
            const billNumber = parseInt(billMatch[2], 10);
            return billPrefix === queryPrefix && billNumber === queryNumber;
          });
        } else {
          // Prefix-only or partial bill-number searches still do bill-number-only matching.
          filtered = filtered.filter((bill) => {
            const billNumberNormalized = normalize(bill.bill_number);
            const billNumberCompact = normalizeCompact(bill.bill_number);
            return searchTokens.every(
              (token) =>
                billNumberNormalized.includes(token) ||
                billNumberCompact.includes(token.replace(/\s+/g, "")),
            );
          });
        }
      } else {
        filtered = filtered.filter((bill) => {
          // Otherwise, do full-text search
          const searchable = normalize(
            [
              bill.bill_number,
              bill.title,
              bill.sponsor,
              bill.summary,
              bill.current_committee,
              bill.last_action,
              bill.lc_number,
              bill.status,
              bill.bill_type,
              bill.chamber,
              bill.session_year,
            ].join(" "),
          );
          const searchableCompact = searchable.replace(/\s+/g, "");

          return searchTokens.every(
            (token) =>
              searchable.includes(token) ||
              searchableCompact.includes(token.replace(/\s+/g, "")),
          );
        });
      }
    }

    if (filters.chamber) {
      filtered = filtered.filter((bill) => bill.chamber === filters.chamber);
    }

    if (filters.bill_type) {
      filtered = filtered.filter(
        (bill) => bill.bill_type === filters.bill_type,
      );
    }

    if (filters.status) {
      filtered = filtered.filter((bill) => bill.status === filters.status);
    }

    return filtered;
  }, [bills, filters]);

  const displayedBills = useMemo(
    () => filteredBills.slice(0, displayCount),
    [filteredBills, displayCount],
  );

  // Persist display count across navigations
  useEffect(() => {
    sessionStorage.setItem("dashboard-display-count", String(displayCount));
  }, [displayCount]);

  // Save scroll position on scroll
  useEffect(() => {
    const handleScroll = () => {
      sessionStorage.setItem("dashboard-scroll-y", String(window.scrollY));
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Infinite scroll via IntersectionObserver on the sentinel element
  const sentinelRef = useRef(null);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setDisplayCount((prev) => {
            if (prev < filteredBills.length) return prev + 10;
            return prev;
          });
        }
      },
      { rootMargin: "500px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [filteredBills.length]);

  // Restore scroll position once bills are rendered
  const scrollRestored = useRef(false);
  useEffect(() => {
    if (filteredBills.length === 0 || scrollRestored.current) return;
    const saved = sessionStorage.getItem("dashboard-scroll-y");
    if (saved) {
      scrollRestored.current = true;
      requestAnimationFrame(() => {
        window.scrollTo(0, parseInt(saved, 10));
      });
    }
  }, [filteredBills.length]);

  const getBillCounts = () => {
    return {
      total: filteredBills.length,
      house: filteredBills.filter((bill) => bill.chamber === "house").length,
      senate: filteredBills.filter((bill) => bill.chamber === "senate").length,
    };
  };

  const handleToggleTracking = async (billId, billNumber) => {
    if (!authUser) return;
    const bill = rawBills.find((item) => item.id === billId) || {
      id: billId,
      bill_number: billNumber,
    };
    const isCurrentlyTracked = trackedBillIds.includes(billNumber);
    const sessionId = selectedSessionId;
    const scopeState = state;
    trackMutation.mutate({
      action: isCurrentlyTracked ? "remove" : "add",
      bill,
      scopeState,
      sessionId,
      trackedKey: ["trackedBills", scopeState, sessionId],
    });
  };

  const handleBillUpdate = useCallback(
    (updatedBill) => {
      if (!updatedBill?.id) return;
      queryClient.setQueryData(["bills", state, selectedSessionId], (old) =>
        old ? old.map((b) => (b.id === updatedBill.id ? updatedBill : b)) : old,
      );
      setSelectedBill((prev) => {
        if (!prev || prev.id !== updatedBill.id) return prev;
        return { ...prev, ...updatedBill };
      });
    },
    [queryClient, selectedSessionId, state],
  );

  useEffect(() => {
    setSelectedBill(null);
    setDisplayCount(10);
  }, [selectedSessionId]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">
              Legislative Dashboard
            </h1>
            <p className="text-slate-600 mt-1 flex items-center gap-2">
              <Globe className="w-4 h-4" />
              Bills from LegiScan - {getSessionDisplayName(selectedSession)}
            </p>
          </div>
          <BillSyncButton
            onSyncComplete={() => {
              queryClient.invalidateQueries({ queryKey: ["bills"] });
              queryClient.invalidateQueries({ queryKey: ["teamBills"] });
              queryClient.invalidateQueries({ queryKey: ["allTeamBills"] });
              queryClient.invalidateQueries({ queryKey: ["teamBillMeta"] });
              queryClient.invalidateQueries({ queryKey: ["personalBillMeta"] });
              queryClient.invalidateQueries({ queryKey: ["lcTracking"] });
              queryClient.invalidateQueries({ queryKey: ["lcTracking"] });
            }}
          />
        </div>

        {/* Filters */}
        <BillFilters
          filters={filters}
          onFilterChange={setFilters}
          billCounts={getBillCounts()}
        />

        {/* Bills Grid */}
        <div className="space-y-4">
          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-slate-600">Loading bills...</p>
            </div>
          ) : filteredBills.length > 0 ? (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                <AnimatePresence>
                  {displayedBills.map((bill) => (
                    <motion.div
                      key={bill.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      transition={{ duration: 0.2 }}
                    >
                      <BillCard
                        bill={bill}
                        onViewDetails={setSelectedBill}
                        onToggleTracking={handleToggleTracking}
                        isTracked={trackedBillIds.includes(bill.bill_number)}
                        teams={allTeams}
                        teamBillMap={teamBillMap}
                        onToggleTeamBill={handleToggleTeamBill}
                        lcTracking={lcFor(bill.bill_number)}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
              {displayCount < filteredBills.length && (
                <div ref={sentinelRef} className="text-center py-8">
                  <div className="animate-pulse text-slate-600">
                    Loading more bills...
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 text-slate-400 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-slate-900 mb-2">
                No bills found
              </h3>
              <p className="text-slate-600">
                {bills.length === 0
                  ? "No bills have been added yet."
                  : "Try adjusting your filters to see more results."}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <BillDetailsModal
        bill={selectedBill}
        isOpen={!!selectedBill}
        onClose={() => setSelectedBill(null)}
        isTracked={
          selectedBill
            ? trackedBillIds.includes(selectedBill.bill_number)
            : false
        }
        onToggleTracking={handleToggleTracking}
        onBillUpdate={handleBillUpdate}
        teams={allTeams}
        teamBillMap={teamBillMap}
        onToggleTeamBill={handleToggleTeamBill}
        lcTracking={selectedBill ? lcFor(selectedBill.bill_number) : null}
      />
    </div>
  );
}
