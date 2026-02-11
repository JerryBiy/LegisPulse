import { useState, useEffect, useCallback } from "react";
import { api as base44 } from "@/api/apiClient";
import { FileText, Globe } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import BillCard from "../components/bills/BillCard";
import BillFilters from "../components/bills/BillFilters";
import BillDetailsModal from "../components/bills/BillDetailsModal";
import BillSyncButton from "../components/bills/BillSyncButton";

export default function Dashboard() {
  const [bills, setBills] = useState([]);
  const [filteredBills, setFilteredBills] = useState([]);
  const [displayedBills, setDisplayedBills] = useState([]);
  const [displayCount, setDisplayCount] = useState(10);
  const [filters, setFilters] = useState({
    search: "",
    chamber: null,
    bill_type: null,
    status: null,
    session_year: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [selectedBill, setSelectedBill] = useState(null);
  const [user, setUser] = useState(null);
  const [trackedBillIds, setTrackedBillIds] = useState([]);

  useEffect(() => {
    loadData();
  }, []);

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

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [billsData, userData] = await Promise.all([
        base44.entities.Bill.list("-last_action_date"),
        base44.auth.me().catch(() => null),
      ]);
      // Fix any incorrect bill types
      const correctedBills = fixBillTypes(billsData);
      setBills(correctedBills);
      setUser(userData);
      setTrackedBillIds(userData?.tracked_bill_ids || []);
    } catch (error) {
      console.error("Error loading data:", error);
    }
    setIsLoading(false);
  };

  const applyFilters = useCallback(() => {
    let filtered = bills;

    if (filters.search) {
      const normalize = (value) =>
        String(value || "")
          .toLowerCase()
          .normalize("NFKD")
          .replace(/\p{Diacritic}/gu, "")
          .replace(/[^a-z0-9]+/g, " ")
          .trim();

      const searchTokens = normalize(filters.search)
        .split(/\s+/)
        .filter(Boolean);

      // Check if search looks like a bill number (e.g., HB, HR, SB, SR)
      const isBillNumberSearch = /^(hb|hr|sb|sr|hc|sc)/.test(
        filters.search.toLowerCase().trim(),
      );

      filtered = filtered.filter((bill) => {
        // If searching for bill number prefix, only search in bill_number
        if (isBillNumberSearch) {
          const billNumberNormalized = normalize(bill.bill_number);
          return searchTokens.every((token) =>
            billNumberNormalized.includes(token),
          );
        }

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

    setFilteredBills(filtered);
  }, [bills, filters]); // Depend on bills and filters, so this function is memoized

  useEffect(() => {
    applyFilters();
  }, [applyFilters]);

  useEffect(() => {
    setDisplayedBills(filteredBills.slice(0, displayCount));
  }, [filteredBills, displayCount]);

  useEffect(() => {
    const handleScroll = () => {
      if (
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 500
      ) {
        if (displayCount < filteredBills.length) {
          setDisplayCount((prev) => prev + 10);
        }
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [displayCount, filteredBills.length]);

  const getBillCounts = () => {
    return {
      total: filteredBills.length,
      house: filteredBills.filter((bill) => bill.chamber === "house").length,
      senate: filteredBills.filter((bill) => bill.chamber === "senate").length,
    };
  };

  const handleToggleTracking = async (billId, billNumber) => {
    if (!user) return;

    const isCurrentlyTracked = trackedBillIds.includes(billId);
    const newTrackedIds = isCurrentlyTracked
      ? trackedBillIds.filter((id) => id !== billId)
      : [...trackedBillIds, billId];

    setTrackedBillIds(newTrackedIds);
    await base44.auth.updateMe({ tracked_bill_ids: newTrackedIds });

    // Monitor tracked bill on Twitter
    if (!isCurrentlyTracked) {
      monitorBillOnTwitter(billNumber);
    }
  };

  const monitorBillOnTwitter = async (billNumber) => {
    try {
      // Search for recent tweets mentioning the bill
      await base44.integrations.Core.InvokeLLM({
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
          await base44.entities.Notification.create({
            user_id: user.id,
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
          <BillSyncButton onSyncComplete={loadData} />
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
                        isTracked={trackedBillIds.includes(bill.id)}
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
          selectedBill ? trackedBillIds.includes(selectedBill.id) : false
        }
        onToggleTracking={handleToggleTracking}
      />
    </div>
  );
}
