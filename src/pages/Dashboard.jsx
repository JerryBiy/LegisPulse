import React, { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { FileText, TrendingUp, Globe } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import BillCard from "../components/bills/BillCard";
import BillFilters from "../components/bills/BillFilters";
import NewBillsModal from "../components/bills/NewBillsModal";
import BillDetailsModal from "../components/bills/BillDetailsModal";
import BillSyncButton from "../components/bills/BillSyncButton";
import AutoSyncIndicator from "../components/bills/AutoSyncIndicator";

export default function Dashboard() {
  const [bills, setBills] = useState([]);
  const [filteredBills, setFilteredBills] = useState([]);
  const [filters, setFilters] = useState({ session_year: 2026 });
  const [isLoading, setIsLoading] = useState(true);
  const [showNewBillsModal, setShowNewBillsModal] = useState(false);
  const [selectedBill, setSelectedBill] = useState(null);
  const [user, setUser] = useState(null);
  const [trackedBillIds, setTrackedBillIds] = useState([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [billsData, userData] = await Promise.all([
        base44.entities.Bill.list("-created_date"),
        base44.auth.me().catch(() => null)
      ]);
      setBills(billsData);
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
      const search = filters.search.toLowerCase();
      filtered = filtered.filter(bill => 
        bill.bill_number.toLowerCase().includes(search) ||
        bill.title.toLowerCase().includes(search) ||
        bill.sponsor?.toLowerCase().includes(search)
      );
    }

    if (filters.chamber) {
      filtered = filtered.filter(bill => bill.chamber === filters.chamber);
    }

    if (filters.bill_type) {
      filtered = filtered.filter(bill => bill.bill_type === filters.bill_type);
    }

    if (filters.status) {
      filtered = filtered.filter(bill => bill.status === filters.status);
    }

    if (filters.session_year) {
      filtered = filtered.filter(bill => bill.session_year === filters.session_year);
    }

    setFilteredBills(filtered);
  }, [bills, filters]); // Depend on bills and filters, so this function is memoized

  useEffect(() => {
    applyFilters();
  }, [applyFilters]); // Now depend on the memoized applyFilters function

  const getBillCounts = () => {
    return {
      total: filteredBills.length,
      house: filteredBills.filter(bill => bill.chamber === 'house').length,
      senate: filteredBills.filter(bill => bill.chamber === 'senate').length
    };
  };

  const handleToggleTracking = async (billId) => {
    if (!user) return;

    const isCurrentlyTracked = trackedBillIds.includes(billId);
    const newTrackedIds = isCurrentlyTracked
      ? trackedBillIds.filter(id => id !== billId)
      : [...trackedBillIds, billId];

    setTrackedBillIds(newTrackedIds);
    await base44.auth.updateMe({ tracked_bill_ids: newTrackedIds });
  };

  const getNewBills = () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return bills.filter(bill => {
      const created = new Date(bill.created_date);
      return created >= yesterday;
    });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Legislative Dashboard</h1>
            <p className="text-slate-600 mt-1 flex items-center gap-2">
              <Globe className="w-4 h-4" />
              Live bills from legis.ga.gov - 2025-2026 session
            </p>
          </div>
          <BillSyncButton onSyncComplete={loadData} />
        </div>

        {/* Auto-sync Indicator */}
        <AutoSyncIndicator lastSyncTime="Today" />

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-600 text-sm font-medium">Total Bills</p>
                <p className="text-3xl font-bold text-slate-900 mt-1">{bills.length}</p>
              </div>
              <div className="p-3 bg-blue-100 rounded-lg">
                <FileText className="w-6 h-6 text-blue-600" />
              </div>
            </div>
            <div className="flex items-center gap-2 mt-4">
              <TrendingUp className="w-4 h-4 text-emerald-500" />
              <span className="text-sm text-emerald-600 font-medium">Session 2026</span>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-600 text-sm font-medium">House Bills</p>
                <p className="text-3xl font-bold text-slate-900 mt-1">
                  {bills.filter(b => b.chamber === 'house').length}
                </p>
              </div>
              <div className="p-3 bg-blue-100 rounded-lg">
                <FileText className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-600 text-sm font-medium">Senate Bills</p>
                <p className="text-3xl font-bold text-slate-900 mt-1">
                  {bills.filter(b => b.chamber === 'senate').length}
                </p>
              </div>
              <div className="p-3 bg-purple-100 rounded-lg">
                <FileText className="w-6 h-6 text-purple-600" />
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <BillFilters
          filters={filters}
          onFilterChange={setFilters}
          onShowNewBills={() => setShowNewBillsModal(true)}
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
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
              <AnimatePresence>
                {filteredBills.map((bill) => (
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
          ) : (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 text-slate-400 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-slate-900 mb-2">No bills found</h3>
              <p className="text-slate-600">
                {bills.length === 0 
                  ? "No bills have been added yet." 
                  : "Try adjusting your filters to see more results."
                }
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <NewBillsModal
        isOpen={showNewBillsModal}
        onClose={() => setShowNewBillsModal(false)}
        bills={getNewBills()}
        onViewBill={setSelectedBill}
      />

      <BillDetailsModal
        bill={selectedBill}
        isOpen={!!selectedBill}
        onClose={() => setSelectedBill(null)}
        isTracked={selectedBill ? trackedBillIds.includes(selectedBill.id) : false}
        onToggleTracking={handleToggleTracking}
      />
    </div>
  );
}