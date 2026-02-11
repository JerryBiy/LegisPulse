import React, { useState, useEffect } from "react";
import { api as base44 } from "@/api/apiClient";
import { Bell, Star } from "lucide-react";
import BillCard from "../components/bills/BillCard";
import BillDetailsModal from "../components/bills/BillDetailsModal";

export default function TrackedBills() {
  const [trackedBills, setTrackedBills] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedBill, setSelectedBill] = useState(null);
  const [trackedBillIds, setTrackedBillIds] = useState([]);

  useEffect(() => {
    loadTrackedBills();
  }, []);

  const loadTrackedBills = async () => {
    setIsLoading(true);
    try {
      const userData = await base44.auth.me();
      const billIds = userData?.tracked_bill_ids || [];
      setTrackedBillIds(billIds);

      if (billIds.length > 0) {
        const bills = await base44.entities.Bill.list();
        const filtered = bills.filter((bill) => billIds.includes(bill.id));
        setTrackedBills(filtered);
      }
    } catch (error) {
      console.error("Error loading tracked bills:", error);
    }
    setIsLoading(false);
  };

  const handleToggleTracking = async (billId) => {
    const newTrackedIds = trackedBillIds.filter((id) => id !== billId);
    setTrackedBillIds(newTrackedIds);
    setTrackedBills((prev) => prev.filter((bill) => bill.id !== billId));
    await base44.auth.updateMe({ tracked_bill_ids: newTrackedIds });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="p-3 bg-blue-100 rounded-lg">
            <Bell className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Tracked Bills</h1>
            <p className="text-slate-600 mt-1">
              Bills you're actively monitoring
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-600 text-sm font-medium">
                Currently Tracking
              </p>
              <p className="text-3xl font-bold text-slate-900 mt-1">
                {trackedBills.length}
              </p>
            </div>
            <div className="p-3 bg-yellow-100 rounded-lg">
              <Star className="w-6 h-6 text-yellow-600" />
            </div>
          </div>
        </div>

        {/* Bills Grid */}
        <div className="space-y-4">
          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-slate-600">Loading tracked bills...</p>
            </div>
          ) : trackedBills.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
              {trackedBills.map((bill) => (
                <BillCard
                  key={bill.id}
                  bill={bill}
                  onViewDetails={setSelectedBill}
                  onToggleTracking={handleToggleTracking}
                  isTracked={true}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <Star className="w-12 h-12 text-slate-400 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-slate-900 mb-2">
                No bills tracked yet
              </h3>
              <p className="text-slate-600 mb-4">
                Start tracking bills from the main dashboard to see them here.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Bill Details Modal */}
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
