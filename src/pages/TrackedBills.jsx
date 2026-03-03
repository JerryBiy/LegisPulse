import React, { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/apiClient";
import {
  Bell,
  Star,
  LayoutGrid,
  List,
  ExternalLink,
  AlertTriangle,
  Shield,
  Sparkles,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import BillCard from "../components/bills/BillCard";
import BillDetailsModal from "../components/bills/BillDetailsModal";
import { useResizableHeight, ResizeHandle } from "@/hooks/use-resizable-height";

// ── Helpers ──────────────────────────────────────────────────────────────────

const PARTY_COLORS = {
  D: "bg-indigo-500 text-white",
  R: "bg-rose-500 text-white",
  I: "bg-slate-400 text-white",
  G: "bg-green-500 text-white",
  L: "bg-yellow-500 text-white",
};

const extractBillNum = (bn) => {
  const m = String(bn || "").match(/^([A-Za-z]+)\s*(\d+)/);
  return m
    ? { prefix: m[1].toUpperCase(), num: parseInt(m[2], 10) }
    : { prefix: "", num: 0 };
};

const FLAG_ORDER = { high: 0, low: 1 };
const PARTY_ORDER = { D: 0, R: 1, I: 2, G: 3, L: 4 };

// ─────────────────────────────────────────────────────────────────────────────

export default function TrackedBills() {
  const queryClient = useQueryClient();
  const [selectedBill, setSelectedBill] = useState(null);
  const [layout, setLayoutState] = useState(
    () => localStorage.getItem("tracked-bills-layout") || "icon",
  );
  const setLayout = (v) => {
    setLayoutState(v);
    localStorage.setItem("tracked-bills-layout", v);
  };
  const [listSort, setListSort] = useState({ key: null, dir: "asc" });

  // ── Data queries ───────────────────────────────────────────────────────────
  const { data: userData } = useQuery({
    queryKey: ["profile"],
    queryFn: () => api.auth.me().catch(() => null),
  });

  const { data: allBills = [], isLoading } = useQuery({
    queryKey: ["bills"],
    queryFn: () => api.entities.Bill.list(),
  });

  const { data: personalMeta = {} } = useQuery({
    queryKey: ["personalBillMeta"],
    queryFn: () => api.entities.UserBillMeta.getAll(),
  });

  const {
    height: listHeight,
    collapsed: listCollapsed,
    onMouseDown: onListResizeDown,
    toggle: toggleListCollapse,
  } = useResizableHeight({
    storageKey: "tracked-bills-list-height",
    defaultHeight: 480,
    minHeight: 150,
  });

  const trackedBillIds = userData?.tracked_bill_ids ?? [];
  const trackedBills = allBills.filter((bill) =>
    trackedBillIds.includes(bill.bill_number),
  );

  // ── Toggle tracking ────────────────────────────────────────────────────────
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

  const handleToggleTracking = (billId, billNumber) => {
    const newTrackedIds = trackedBillIds.filter((id) => id !== billNumber);
    trackMutation.mutate(newTrackedIds);
  };

  // ── Personal metadata mutation ─────────────────────────────────────────────
  const metaMutation = useMutation({
    mutationFn: ({ billNumber, fields }) =>
      api.entities.UserBillMeta.update(billNumber, fields),
    onMutate: async ({ billNumber, fields }) => {
      await queryClient.cancelQueries({ queryKey: ["personalBillMeta"] });
      const prev = queryClient.getQueryData(["personalBillMeta"]);
      queryClient.setQueryData(["personalBillMeta"], (old) => ({
        ...old,
        [billNumber]: { ...(old?.[billNumber] || {}), ...fields },
      }));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      queryClient.setQueryData(["personalBillMeta"], ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["personalBillMeta"] });
    },
  });

  const handleMetaChange = useCallback(
    (billNumber, fields) => {
      metaMutation.mutate({ billNumber, fields });
    },
    [metaMutation],
  );

  // ── Sort helpers ───────────────────────────────────────────────────────────
  const toggleSort = useCallback((key) => {
    setListSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  }, []);

  const SortIcon = ({ column }) => {
    if (listSort.key !== column)
      return <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />;
    return listSort.dir === "asc" ? (
      <ArrowUp className="w-3.5 h-3.5 text-blue-600" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-blue-600" />
    );
  };

  const sortedBills = useMemo(() => {
    if (!listSort.key || layout !== "list") return trackedBills;
    const dir = listSort.dir === "asc" ? 1 : -1;
    return [...trackedBills].sort((a, b) => {
      if (listSort.key === "bill") {
        const an = extractBillNum(a.bill_number);
        const bn = extractBillNum(b.bill_number);
        if (an.prefix !== bn.prefix) return an.prefix < bn.prefix ? -dir : dir;
        return (an.num - bn.num) * dir;
      }
      if (listSort.key === "party") {
        const ap = PARTY_ORDER[a.sponsor_party] ?? 99;
        const bp = PARTY_ORDER[b.sponsor_party] ?? 99;
        return (ap - bp) * dir;
      }
      if (listSort.key === "flag") {
        const am = personalMeta[a.bill_number]?.flag;
        const bm = personalMeta[b.bill_number]?.flag;
        const af = FLAG_ORDER[am] ?? 99;
        const bf = FLAG_ORDER[bm] ?? 99;
        return (af - bf) * dir;
      }
      return 0;
    });
  }, [trackedBills, listSort, layout, personalMeta]);

  // ── Render ─────────────────────────────────────────────────────────────────
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

        {/* Layout toggle */}
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 self-start">
          <button
            onClick={() => setLayout("icon")}
            className={`p-1.5 rounded-md transition-colors ${
              layout === "icon"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
            title="Card view"
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setLayout("list")}
            className={`p-1.5 rounded-md transition-colors ${
              layout === "list"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
            title="List view"
          >
            <List className="w-4 h-4" />
          </button>
        </div>

        {/* Bills */}
        <div className="space-y-4">
          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
              <p className="mt-4 text-slate-600">Loading tracked bills...</p>
            </div>
          ) : trackedBills.length > 0 ? (
            layout === "icon" ? (
              /* ── Card view ───────────────────────────────────────── */
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                {trackedBills.map((bill) => {
                  const meta = personalMeta[bill.bill_number] || {};
                  return (
                    <BillCard
                      key={bill.id}
                      bill={bill}
                      onViewDetails={setSelectedBill}
                      onToggleTracking={handleToggleTracking}
                      isTracked={true}
                      teamMeta={{
                        flag: meta.flag ?? null,
                        bill_summary_notes: meta.bill_summary_notes ?? "",
                        assigneeName: null,
                      }}
                    />
                  );
                })}
              </div>
            ) : (
              /* ── List / Spreadsheet view ─────────────────────────── */
              <div>
                {listCollapsed ? (
                  <Card
                    className="cursor-pointer hover:bg-slate-50 transition-colors"
                    onClick={toggleListCollapse}
                  >
                    <div className="text-center py-3 text-sm text-slate-400">
                      List collapsed — click or drag to expand
                    </div>
                  </Card>
                ) : (
                  <Card>
                    <div
                      className="overflow-x-auto overflow-y-auto"
                      style={{ maxHeight: `${listHeight}px` }}
                    >
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-slate-50">
                            <TableHead className="w-[100px] font-semibold">
                              <button
                                className="flex items-center gap-1 hover:text-blue-700 transition-colors"
                                onClick={() => toggleSort("bill")}
                              >
                                Bill # <SortIcon column="bill" />
                              </button>
                            </TableHead>
                            <TableHead className="min-w-[200px] font-semibold">
                              Title
                            </TableHead>
                            <TableHead className="min-w-[160px] font-semibold">
                              Primary Sponsor
                            </TableHead>
                            <TableHead className="w-[90px] font-semibold">
                              <button
                                className="flex items-center gap-1 hover:text-blue-700 transition-colors"
                                onClick={() => toggleSort("party")}
                              >
                                Party <SortIcon column="party" />
                              </button>
                            </TableHead>
                            <TableHead className="min-w-[140px] font-semibold">
                              Committee
                            </TableHead>
                            <TableHead className="w-[110px] font-semibold">
                              <button
                                className="flex items-center gap-1 hover:text-blue-700 transition-colors"
                                onClick={() => toggleSort("flag")}
                              >
                                Flag <SortIcon column="flag" />
                              </button>
                            </TableHead>
                            <TableHead className="w-[60px] font-semibold">
                              Link
                            </TableHead>
                            <TableHead className="min-w-[200px] font-semibold">
                              Bill Summary
                            </TableHead>
                            <TableHead className="min-w-[200px] font-semibold">
                              <span className="flex items-center gap-1">
                                <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                                AI Summary
                              </span>
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sortedBills.map((bill) => {
                            const meta = personalMeta[bill.bill_number] || {};
                            return (
                              <TableRow key={bill.id} className="align-top">
                                {/* Bill Number */}
                                <TableCell className="font-mono font-semibold text-blue-700 whitespace-nowrap">
                                  <button
                                    className="hover:underline text-left"
                                    onClick={() => setSelectedBill(bill)}
                                  >
                                    {bill.bill_number}
                                  </button>
                                </TableCell>

                                {/* Title */}
                                <TableCell className="text-sm text-slate-700 max-w-[280px]">
                                  <span className="line-clamp-2">
                                    {bill.title}
                                  </span>
                                </TableCell>

                                {/* Primary Sponsor */}
                                <TableCell className="text-sm text-slate-700 whitespace-nowrap">
                                  {bill.sponsor || "Unknown"}
                                </TableCell>

                                {/* Party */}
                                <TableCell>
                                  {bill.sponsor_party ? (
                                    <span
                                      className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-semibold ${
                                        PARTY_COLORS[bill.sponsor_party] ||
                                        "bg-slate-200 text-slate-700"
                                      }`}
                                    >
                                      {bill.sponsor_party === "D"
                                        ? "Democrat"
                                        : bill.sponsor_party === "R"
                                          ? "Republican"
                                          : bill.sponsor_party}
                                    </span>
                                  ) : (
                                    <span className="text-xs text-slate-400">
                                      —
                                    </span>
                                  )}
                                </TableCell>

                                {/* Committee */}
                                <TableCell className="text-sm text-slate-700">
                                  {bill.current_committee ? (
                                    <Badge
                                      variant="outline"
                                      className="text-xs font-normal"
                                    >
                                      {bill.current_committee}
                                    </Badge>
                                  ) : (
                                    <span className="text-xs text-slate-400">
                                      —
                                    </span>
                                  )}
                                </TableCell>

                                {/* Flag */}
                                <TableCell>
                                  <Select
                                    value={meta.flag || "_none"}
                                    onValueChange={(val) =>
                                      handleMetaChange(bill.bill_number, {
                                        flag: val === "_none" ? null : val,
                                      })
                                    }
                                  >
                                    <SelectTrigger className="h-8 text-xs w-[100px]">
                                      <SelectValue placeholder="—" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="_none">
                                        <span className="text-slate-400">
                                          None
                                        </span>
                                      </SelectItem>
                                      <SelectItem value="low">
                                        <span className="flex items-center gap-1 text-green-700">
                                          <Shield className="w-3 h-3" /> Low
                                          Risk
                                        </span>
                                      </SelectItem>
                                      <SelectItem value="high">
                                        <span className="flex items-center gap-1 text-red-700">
                                          <AlertTriangle className="w-3 h-3" />{" "}
                                          High Risk
                                        </span>
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                </TableCell>

                                {/* Link */}
                                <TableCell>
                                  {bill.url ? (
                                    <a
                                      href={bill.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-blue-600 hover:text-blue-800"
                                    >
                                      <ExternalLink className="w-4 h-4" />
                                    </a>
                                  ) : (
                                    <span className="text-xs text-slate-400">
                                      —
                                    </span>
                                  )}
                                </TableCell>

                                {/* Bill Summary (editable notes) */}
                                <TableCell>
                                  <Textarea
                                    placeholder="Add notes..."
                                    className="text-xs min-h-[60px] resize-y w-full"
                                    value={meta.bill_summary_notes || ""}
                                    onChange={(e) =>
                                      queryClient.setQueryData(
                                        ["personalBillMeta"],
                                        (old) => ({
                                          ...old,
                                          [bill.bill_number]: {
                                            ...(old?.[bill.bill_number] || {}),
                                            bill_summary_notes: e.target.value,
                                          },
                                        }),
                                      )
                                    }
                                    onBlur={(e) =>
                                      handleMetaChange(bill.bill_number, {
                                        bill_summary_notes: e.target.value,
                                      })
                                    }
                                  />
                                </TableCell>

                                {/* AI Summary (read-only) */}
                                <TableCell className="text-xs text-slate-600 max-w-[240px]">
                                  {bill.summary ? (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <p className="line-clamp-3 cursor-help">
                                            {bill.summary}
                                          </p>
                                        </TooltipTrigger>
                                        <TooltipContent
                                          side="left"
                                          className="max-w-sm text-xs whitespace-pre-line"
                                        >
                                          {bill.summary}
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  ) : (
                                    <span className="text-slate-400 italic">
                                      No AI summary
                                    </span>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </Card>
                )}
                <ResizeHandle onMouseDown={onListResizeDown} />
              </div>
            )
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
          selectedBill
            ? trackedBillIds.includes(selectedBill.bill_number)
            : false
        }
        onToggleTracking={handleToggleTracking}
        personalMeta={
          selectedBill
            ? personalMeta[selectedBill.bill_number] || {}
            : undefined
        }
        onPersonalMetaChange={
          selectedBill
            ? (fields) => handleMetaChange(selectedBill.bill_number, fields)
            : undefined
        }
      />
    </div>
  );
}
