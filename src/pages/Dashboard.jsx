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
    session_year: null,
  });
  const [selectedBill, setSelectedBill] = useState(null);
  const { user: authUser } = useAuth();

  const { data: rawBills = [], isLoading } = useQuery({
    queryKey: ["bills"],
    queryFn: () => api.entities.Bill.list(),
  });

  const { data: userData } = useQuery({
    queryKey: ["profile"],
    queryFn: () => api.auth.me().catch(() => null),
  });

  const trackedBillIds = userData?.tracked_bill_ids ?? [];

  // ── Team ────────────────────────────────────────────────────────────────────
  const { data: team } = useQuery({
    queryKey: ["team"],
    queryFn: () =>
      api.entities.Team.getOrCreate().catch((err) => {
        console.error("[Team] getOrCreate failed:", err?.message, err);
        return null;
      }),
    staleTime: 0,
    retry: 1,
  });
  const teamId = team?.id;

  const { data: teamBillNumbers = [] } = useQuery({
    queryKey: ["teamBills", teamId],
    queryFn: () => api.entities.Team.getBillNumbers(teamId),
    enabled: !!teamId,
  });

  const teamBillMutation = useMutation({
    mutationFn: ({ action, billNumber }) =>
      action === "add"
        ? api.entities.Team.addBill(teamId, billNumber)
        : api.entities.Team.removeBill(teamId, billNumber),
    onMutate: async ({ action, billNumber }) => {
      await queryClient.cancelQueries({ queryKey: ["teamBills", teamId] });
      const prev = queryClient.getQueryData(["teamBills", teamId]);
      queryClient.setQueryData(["teamBills", teamId], (old) =>
        action === "add"
          ? [...(old ?? []), billNumber]
          : (old ?? []).filter((n) => n !== billNumber),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      queryClient.setQueryData(["teamBills", teamId], ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["teamBills", teamId] });
    },
  });

  const handleAddToTeam = (billNumber) => {
    if (!teamId) {
      toast({
        title: "Team not ready",
        description:
          "The team feature requires the database tables to be set up. Please run the SQL migration in Supabase.",
        variant: "destructive",
        duration: 4000,
      });
      return;
    }
    const isCurrentlyInTeam = teamBillNumbers.includes(billNumber);
    teamBillMutation.mutate({
      action: isCurrentlyInTeam ? "remove" : "add",
      billNumber,
    });
    toast({
      title: isCurrentlyInTeam ? "Removed from team" : "Added to team",
      description: `${billNumber} ${isCurrentlyInTeam ? "removed from" : "added to"} your team's bills.`,
      duration: 3000,
    });
  };

  const trackMutation = useMutation({
    mutationFn: (newIds) => api.auth.updateMe({ tracked_bill_ids: newIds }),
    onMutate: async (newIds) => {
      await queryClient.cancelQueries({ queryKey: ["profile"] });
      const previous = queryClient.getQueryData(["profile"]);
      queryClient.setQueryData(["profile"], (old) =>
        old ? { ...old, tracked_bill_ids: newIds } : old,
      );
      return { previous };
    },
    onError: (_err, _newIds, context) => {
      queryClient.setQueryData(["profile"], context.previous);
    },
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

    if (filters.session_year) {
      filtered = filtered.filter(
        (bill) => bill.session_year === filters.session_year,
      );
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

  // Infinite scroll + save scroll position
  useEffect(() => {
    const handleScroll = () => {
      sessionStorage.setItem("dashboard-scroll-y", String(window.scrollY));
      if (
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 500
      ) {
        if (displayCount < filteredBills.length) {
          setDisplayCount((prev) => prev + 10);
        }
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [displayCount, filteredBills.length]);

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
    const isCurrentlyTracked = trackedBillIds.includes(billNumber);
    const newTrackedIds = isCurrentlyTracked
      ? trackedBillIds.filter((id) => id !== billNumber)
      : [...trackedBillIds, billNumber];
    trackMutation.mutate(newTrackedIds);
    if (!isCurrentlyTracked) {
      monitorBillOnTwitter(billNumber);
    }
  };

  const monitorBillOnTwitter = async (billNumber) => {
    try {
      // Search for recent tweets mentioning the bill
      await api.integrations.Core.InvokeLLM({
        prompt: `Search Twitter/X for recent posts from @GeorgiaHouseofReps and @Georgia_Senate that mention "${billNumber}". 
        Look for any updates, votes, committee actions, or status changes related to this bill.
        Return the most relevant information about recent activity.`,
        add_context_from_internet: true,
        response_json_schema: {
          type: "object",
          properties: {
            has_updates: { type: "boolean" },
            updates: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  content: { type: "string" },
                  date: { type: "string" },
                  source: { type: "string" },
                },
              },
            },
          },
        },
      }).then(async (response) => {
        if (response.has_updates && response.updates?.length > 0) {
          // Create notification for user
          await api.entities.Notification.create({
            user_id: authUser?.id,
            notification_type: "bill_mention",
            title: `${billNumber} mentioned on Twitter`,
            message: response.updates[0].content,
            related_bill_id: billNumber,
            priority: "high",
          });
        }
      });
    } catch (error) {
      console.error("Error monitoring bill on Twitter:", error);
    }
  };

  const handleBillUpdate = useCallback(
    (updatedBill) => {
      if (!updatedBill?.id) return;
      queryClient.setQueryData(["bills"], (old) =>
        old ? old.map((b) => (b.id === updatedBill.id ? updatedBill : b)) : old,
      );
      setSelectedBill((prev) => {
        if (!prev || prev.id !== updatedBill.id) return prev;
        return { ...prev, ...updatedBill };
      });
    },
    [queryClient],
  );

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
              Live bills from legis.ga.gov - 2025-2026 session
            </p>
          </div>
          <BillSyncButton
            autoSync={!isLoading && rawBills.length === 0}
            onSyncComplete={() =>
              queryClient.invalidateQueries({ queryKey: ["bills"] })
            }
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
                        isInTeam={teamBillNumbers.includes(bill.bill_number)}
                        onAddToTeam={() => handleAddToTeam(bill.bill_number)}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
              {displayCount < filteredBills.length && (
                <div className="text-center py-8">
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
        isInTeam={
          selectedBill
            ? teamBillNumbers.includes(selectedBill.bill_number)
            : false
        }
        onAddToTeam={
          selectedBill
            ? () => handleAddToTeam(selectedBill.bill_number)
            : undefined
        }
      />
    </div>
  );
}
