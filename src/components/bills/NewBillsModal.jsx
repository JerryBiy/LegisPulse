import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, FileText, Building2 } from "lucide-react";
import { format } from "date-fns";

export default function NewBillsModal({ isOpen, onClose, bills, onViewBill }) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-emerald-600" />
            New Bills from Yesterday ({bills.length})
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {bills.length > 0 ? (
            bills.map((bill) => (
              <div
                key={bill.id}
                className="p-4 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <div
                        className={`p-1.5 rounded ${
                          bill.chamber === "house"
                            ? "bg-blue-100 text-blue-600"
                            : "bg-purple-100 text-purple-600"
                        }`}
                      >
                        <Building2 className="w-4 h-4" />
                      </div>
                      <h3 className="font-bold">{bill.bill_number}</h3>
                      <Badge variant="outline" className="text-xs">
                        {bill.bill_type.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <h4 className="font-medium text-slate-900 mb-2 line-clamp-2">
                      {bill.title}
                    </h4>
                    <p className="text-sm text-slate-600 mb-2">
                      Sponsor: {bill.sponsor}
                    </p>
                    <p className="text-xs text-slate-500">
                      Added{" "}
                      {format(
                        new Date(bill.created_date),
                        "MMM d, yyyy 'at' h:mm a",
                      )}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onViewBill(bill);
                      onClose();
                    }}
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    View
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-8">
              <Calendar className="w-12 h-12 text-slate-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">
                No new bills
              </h3>
              <p className="text-slate-600">No bills were added yesterday.</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
