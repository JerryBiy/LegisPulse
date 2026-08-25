import React, {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
} from "react";
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
  Folder,
  FolderOpen,
  ChevronRight,
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
import TrackedBillDetail from "../components/bills/TrackedBillDetail";
import { useResizableHeight, ResizeHandle } from "@/hooks/use-resizable-height";
import { fetchBillSponsors } from "@/services/legiscan";
import { useLegislativeSession } from "@/lib/LegislativeSessionContext";

// ── Helpers ──────────────────────────────────────────────────────────────────

const hasSponsorInfo = (bill) => {
  if (!bill) return false;
  if (Array.isArray(bill.sponsors) && bill.sponsors.length > 0) return true;
  const s = String(bill.sponsor || "").trim();
  return s.length > 0 && s.toLowerCase() !== "unknown";
};

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

// ── Folder taxonomy ──────────────────────────────────────────────────────────
// Four primary folders keyed by bill-number prefix, plus a catch-all "Other"
// bucket so nothing (e.g. HC/SC) silently disappears.
const CATEGORIES = [
  { key: "HB", label: "House Bills", chamber: "house" },
  { key: "HR", label: "House Resolutions", chamber: "house" },
  { key: "SB", label: "Senate Bills", chamber: "senate" },
  { key: "SR", label: "Senate Resolutions", chamber: "senate" },
  { key: "OTHER", label: "Other", chamber: null },
];
const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));
const PRIMARY_KEYS = new Set(["HB", "HR", "SB", "SR"]);

const categoryForPrefix = (prefix) =>
  PRIMARY_KEYS.has(prefix) ? prefix : "OTHER";

// 0–100, 101–200, 201–300, … (bucket of 100, first bucket inclusive of 0).
const rangeIndexForNum = (num) => (num < 1 ? 0 : Math.floor((num - 1) / 100));
const rangeBounds = (idx) => ({
  lo: idx === 0 ? 0 : idx * 100 + 1,
  hi: (idx + 1) * 100,
});
const rangeLabel = (idx) => {
  const { lo, hi } = rangeBounds(idx);
  return `${lo}–${hi}`;
};

const chamberFolderClass = (chamber) =>
  chamber === "house"
    ? "text-blue-600 bg-blue-100"
    : chamber === "senate"
      ? "text-purple-600 bg-purple-100"
      : "text-slate-600 bg-slate-100";

// ─────────────────────────────────────────────────────────────────────────────

export default function TrackedBills() {
  const queryClient = useQueryClient();
  const { state, selectedSessionId, isReady } = useLegislativeSession();

  // ── Folder navigation state ────────────────────────────────────────────────
  const [activeCategory, setActiveCategory] = useState(null); // "HB" | … | null
  const [activeRange, setActiveRange] = useState(null); // range index | null
  const [detailBillNumber, setDetailBillNumber] = useState(null);

  const goRoot = () => {
    setActiveCategory(null);
    setActiveRange(null);
    setDetailBillNumber(null);
  };
  const openCategory = (key) => {
    setActiveCategory(key);
    setActiveRange(null);
    setDetailBillNumber(null);
  };
  const openRange = (idx) => {
    setActiveRange(idx);
    setDetailBillNumber(null);
  };

  const [layout, setLayoutState] = useState(
    () => localStorage.getItem("tracked-bills-layout") || "icon",
  );
  const setLayout = (v) => {
    setLayoutState(v);
    localStorage.setItem("tracked-bills-layout", v);
  };
  const [listSort, setListSort] = useState({ key: null, dir: "asc" });

  const toggleSort = (key) => {
    setListSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  };
  const SortIcon = ({ column }) => {
    if (listSort.key !== column)
      return <ArrowUpDown className="w-3 h-3 opacity-40" />;
    return listSort.dir === "asc" ? (
      <ArrowUp className="w-3 h-3" />
    ) : (
      <ArrowDown className="w-3 h-3" />
    );
  };

  // ── Data queries ───────────────────────────────────────────────────────────
  const { data: trackedBillIds = [] } = useQuery({
    queryKey: ["trackedBills", state, selectedSessionId],
    queryFn: () => api.entities.TrackedBill.getNumbers(selectedSessionId, state),
    enabled: isReady,
  });

  const { data: allBills = [], isLoading } = useQuery({
    queryKey: ["bills", state, selectedSessionId],
    queryFn: () => api.entities.Bill.list(selectedSessionId, undefined, state),
    enabled: isReady,
  });

  const { data: allTeamBillNumbers = [] } = useQuery({
    queryKey: ["allTeamBillNumbers", state, selectedSessionId],
    queryFn: () =>
      api.entities.Team.getAllTeamBillNumbers(selectedSessionId, state),
    enabled: isReady,
    staleTime: 0,
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });

  // Fetch shared bill data from teammates via RPC
  const { data: sharedBillData = [] } = useQuery({
    queryKey: [
      "sharedTeamBillData",
      state,
      selectedSessionId,
      allTeamBillNumbers,
    ],
    queryFn: () =>
      api.entities.Team.getSharedTeamBillData(
        allTeamBillNumbers,
        selectedSessionId,
        state,
      ),
    enabled: isReady && allTeamBillNumbers.length > 0,
    staleTime: 0,
  });

  const { data: personalMeta = {} } = useQuery({
    queryKey: ["personalBillMeta", state, selectedSessionId],
    queryFn: () => api.entities.UserBillMeta.getAll(selectedSessionId, state),
    enabled: isReady,
  });

  // ── LC Tracking data ───────────────────────────────────────────────────────
  const { data: lcTrackingMap = {} } = useQuery({
    queryKey: ["lcTracking", state, selectedSessionId],
    queryFn: () => api.LcTracking.getAll(selectedSessionId, state),
    enabled: isReady,
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

  const effectiveTrackedBillNumbers = useMemo(
    () => [
      ...new Set([...(trackedBillIds ?? []), ...(allTeamBillNumbers ?? [])]),
    ],
    [trackedBillIds, allTeamBillNumbers],
  );

  // Merge local user's bills with shared teammate bill data.
  const mergedBills = useMemo(() => {
    const byNumber = new Map();
    for (const b of sharedBillData) byNumber.set(b.bill_number, b);
    for (const b of allBills) byNumber.set(b.bill_number, b);
    return [...byNumber.values()];
  }, [allBills, sharedBillData]);

  const trackedBills = useMemo(
    () =>
      mergedBills.filter((bill) =>
        effectiveTrackedBillNumbers.includes(bill.bill_number),
      ),
    [mergedBills, effectiveTrackedBillNumbers],
  );

  // ── Background sponsor enrichment ──────────────────────────────────────────
  // Bills cached in the DB can be missing sponsor data (shows "Unknown" until
  // the detail modal is opened). Resolve sponsors for visible tracked bills in
  // the background. Results are kept in a local map keyed by bill_number so the
  // overlay works even for team-shared bills (whose rows belong to a teammate
  // and therefore can't be written back through our own RLS-scoped update).
  const [resolvedSponsors, setResolvedSponsors] = useState({});
  const sponsorFetchAttempted = useRef(new Set());
  useEffect(() => {
    setActiveCategory(null);
    setActiveRange(null);
    setDetailBillNumber(null);
    setResolvedSponsors({});
    sponsorFetchAttempted.current = new Set();
  }, [selectedSessionId]);

  useEffect(() => {
    const needing = trackedBills.filter(
      (b) =>
        b?.bill_number &&
        b?.legiscan_id &&
        !hasSponsorInfo(b) &&
        !resolvedSponsors[b.bill_number] &&
        !sponsorFetchAttempted.current.has(b.bill_number),
    );
    if (needing.length === 0) return;

    let cancelled = false;
    const CONCURRENCY = 4;

    (async () => {
      for (let i = 0; i < needing.length; i += CONCURRENCY) {
        if (cancelled) return;
        const chunk = needing.slice(i, i + CONCURRENCY);
        await Promise.allSettled(
          chunk.map(async (bill) => {
            sponsorFetchAttempted.current.add(bill.bill_number);
            try {
              const { sponsors, primarySponsor, coSponsors, party } =
                await fetchBillSponsors(bill.legiscan_id);
              if (cancelled || !primarySponsor) return;

              // Update the local overlay so the card fills in immediately,
              // regardless of which table the bill row came from.
              setResolvedSponsors((prev) => ({
                ...prev,
                [bill.bill_number]: {
                  sponsor: primarySponsor,
                  sponsors,
                  co_sponsors: coSponsors,
                  sponsor_party: party || bill.sponsor_party || null,
                },
              }));

              // Best-effort: persist onto our own bill row if we own one.
              if (bill.id) {
                const patch = {
                  sponsor: primarySponsor,
                  sponsors,
                  co_sponsors: coSponsors,
                };
                if (party && !bill.sponsor_party) patch.sponsor_party = party;
                api.entities.Bill
                  .update(bill.id, patch, selectedSessionId, state)
                  .catch(() => {
                    /* row may belong to a teammate; overlay still applies */
                  });
              }
            } catch {
              /* non-critical: leave as Unknown, will retry next mount */
            }
          }),
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [trackedBills, resolvedSponsors]);

  // Overlay resolved sponsors onto the tracked bills for display.
  const enrichedBills = useMemo(
    () =>
      trackedBills.map((b) => {
        const r = resolvedSponsors[b.bill_number];
        if (r && !hasSponsorInfo(b)) {
          return {
            ...b,
            sponsor: r.sponsor,
            sponsors: r.sponsors,
            co_sponsors: r.co_sponsors,
            sponsor_party: b.sponsor_party || r.sponsor_party,
          };
        }
        return b;
      }),
    [trackedBills, resolvedSponsors],
  );

  // Mark unseen LC changes as seen for personal tracked bills when the page loads
  useEffect(() => {
    if (!effectiveTrackedBillNumbers.length) return;
    const unseenPersonal = effectiveTrackedBillNumbers.filter((bn) => {
      const t = lcTrackingMap[bn];
      return (
        t && t.previous_lc && t.previous_lc !== t.current_lc && !t.change_seen
      );
    });
    if (unseenPersonal.length > 0) {
      api.LcTracking.markBillsSeen(
        unseenPersonal,
        selectedSessionId,
        state,
      )
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ["lcTracking"] });
        })
        .catch(() => {
          /* non-critical */
        });
    }
  }, [effectiveTrackedBillNumbers, lcTrackingMap, queryClient, selectedSessionId, state]);

  // ── Toggle tracking ────────────────────────────────────────────────────────
  const trackMutation = useMutation({
    mutationFn: (billNumber) =>
      api.entities.TrackedBill.remove(selectedSessionId, billNumber, state),
    onMutate: async (billNumber) => {
      const key = ["trackedBills", state, selectedSessionId];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      queryClient.setQueryData(key, (old = []) =>
        old.filter((number) => number !== billNumber),
      );
      return { previous, key };
    },
    onError: (_err, _billNumber, context) => {
      if (context) queryClient.setQueryData(context.key, context.previous);
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: ["trackedBills", state, selectedSessionId],
      }),
  });

  const handleToggleTracking = (_billId, billNumber) =>
    trackMutation.mutate(billNumber);

  // ── Personal metadata mutation ─────────────────────────────────────────────
  const metaMutation = useMutation({
    mutationFn: ({ billNumber, fields }) =>
      api.entities.UserBillMeta.update(
        selectedSessionId,
        billNumber,
        fields,
        state,
      ),
    onMutate: async ({ billNumber, fields }) => {
      const key = ["personalBillMeta", state, selectedSessionId];
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData(key);
      queryClient.setQueryData(key, (old) => ({
        ...old,
        [billNumber]: { ...(old?.[billNumber] || {}), ...fields },
      }));
      return { prev, key };
    },
    onError: (_e, _v, ctx) => {
      if (ctx) queryClient.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ["personalBillMeta", state, selectedSessionId],
      });
    },
  });

  const handleMetaChange = useCallback(
    (billNumber, fields) => {
      metaMutation.mutate({ billNumber, fields });
    },
    [metaMutation],
  );

  // ── Sort helpers ───────────────────────────────────────────────────────────
  // Helper: is LC change active (unseen or viewed < 1 day ago)
  function isActiveLcChange(lcTracking) {
    if (!lcTracking) return false;
    if (
      lcTracking.previous_lc &&
      lcTracking.previous_lc !== lcTracking.current_lc
    ) {
      // Unseen = always active
      if (!lcTracking.change_seen) return true;
      // Seen but within 1 day = still show the mark
      if (lcTracking.change_seen_at) {
        const seenAt = new Date(lcTracking.change_seen_at).getTime();
        return Date.now() - seenAt < 24 * 60 * 60 * 1000;
      }
      // Fallback: if change_seen_at missing, use lc_changed_at within 1 day
      if (lcTracking.lc_changed_at) {
        const changedAt = new Date(lcTracking.lc_changed_at).getTime();
        return Date.now() - changedAt < 24 * 60 * 60 * 1000;
      }
      return false;
    }
    return false;
  }

  // Sort bills: LC-changed bills (active) first, then normal sort
  const sortedBills = useMemo(() => {
    const withLcChange = enrichedBills.filter((b) =>
      isActiveLcChange(lcTrackingMap[b.bill_number]),
    );
    const withoutLcChange = enrichedBills.filter(
      (b) => !isActiveLcChange(lcTrackingMap[b.bill_number]),
    );
    // Apply normal sort to each group
    const sortFn = (a, b) => {
      if (!listSort.key || layout !== "list") return 0;
      const dir = listSort.dir === "asc" ? 1 : -1;
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
    };
    return [...withLcChange.sort(sortFn), ...withoutLcChange.sort(sortFn)];
  }, [enrichedBills, listSort, layout, personalMeta, lcTrackingMap]);

  // ── Folder grouping ────────────────────────────────────────────────────────
  // category key -> { ranges: Map<idx, bill[]>, count }
  const grouped = useMemo(() => {
    const out = {};
    for (const bill of sortedBills) {
      const { prefix, num } = extractBillNum(bill.bill_number);
      const catKey = categoryForPrefix(prefix);
      const idx = rangeIndexForNum(num);
      out[catKey] ??= { ranges: new Map(), count: 0 };
      if (!out[catKey].ranges.has(idx)) out[catKey].ranges.set(idx, []);
      out[catKey].ranges.get(idx).push(bill);
      out[catKey].count += 1;
    }
    return out;
  }, [sortedBills]);

  const detailBill = useMemo(
    () =>
      detailBillNumber
        ? sortedBills.find((b) => b.bill_number === detailBillNumber) || null
        : null,
    [sortedBills, detailBillNumber],
  );

  // Bills within the currently-open category + range.
  const rangeBills = useMemo(() => {
    if (!activeCategory || activeRange == null) return [];
    return grouped[activeCategory]?.ranges.get(activeRange) ?? [];
  }, [grouped, activeCategory, activeRange]);

  // Breadcrumb context for the detail view (derive from the bill itself).
  const detailContext = useMemo(() => {
    if (!detailBill) return null;
    const { prefix, num } = extractBillNum(detailBill.bill_number);
    return {
      catKey: categoryForPrefix(prefix),
      rangeIdx: rangeIndexForNum(num),
    };
  }, [detailBill]);

  // ── Render helpers ─────────────────────────────────────────────────────────
  const Breadcrumb = () => {
    const crumbs = [{ label: "All Folders", onClick: goRoot }];

    const catKey = detailBill ? detailContext?.catKey : activeCategory;
    const rangeIdx = detailBill ? detailContext?.rangeIdx : activeRange;
    const cat = catKey ? CATEGORY_MAP[catKey] : null;

    if (cat) {
      crumbs.push({
        label: cat.label,
        onClick: () => openCategory(cat.key),
      });
    }
    if (cat && rangeIdx != null) {
      crumbs.push({
        label: `${cat.key === "OTHER" ? "" : cat.key + " "}${rangeLabel(rangeIdx)}`,
        onClick: () => openRange(rangeIdx),
      });
    }
    if (detailBill) {
      crumbs.push({ label: detailBill.bill_number, onClick: null });
    }

    return (
      <nav className="flex items-center gap-1.5 text-sm flex-wrap">
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <React.Fragment key={i}>
              {i > 0 && <ChevronRight className="w-4 h-4 text-slate-300" />}
              {isLast || !c.onClick ? (
                <span className="font-semibold text-slate-900">{c.label}</span>
              ) : (
                <button
                  onClick={c.onClick}
                  className="text-slate-500 hover:text-blue-700 transition-colors"
                >
                  {c.label}
                </button>
              )}
            </React.Fragment>
          );
        })}
      </nav>
    );
  };

  const FolderTile = ({ icon: Icon, iconWrapClass, title, subtitle, onClick }) => (
    <button
      onClick={onClick}
      className="flex items-center gap-4 p-5 bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-300 transition-all text-left group"
    >
      <div className={`p-3 rounded-lg ${iconWrapClass}`}>
        <Icon className="w-6 h-6" />
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-slate-900 truncate">{title}</p>
        <p className="text-sm text-slate-500">{subtitle}</p>
      </div>
      <ChevronRight className="w-5 h-5 text-slate-300 ml-auto group-hover:text-blue-400 transition-colors" />
    </button>
  );

  // Category folders (root level)
  const renderCategoryFolders = () => {
    const visible = CATEGORIES.filter((c) => (grouped[c.key]?.count ?? 0) > 0);
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {visible.map((c) => {
          const count = grouped[c.key]?.count ?? 0;
          return (
            <FolderTile
              key={c.key}
              icon={Folder}
              iconWrapClass={chamberFolderClass(c.chamber)}
              title={c.label}
              subtitle={`${count} ${count === 1 ? "bill" : "bills"}`}
              onClick={() => openCategory(c.key)}
            />
          );
        })}
      </div>
    );
  };

  // Range sub-folders (within a category)
  const renderRangeFolders = () => {
    const cat = CATEGORY_MAP[activeCategory];
    const ranges = grouped[activeCategory]?.ranges;
    const sortedIdx = ranges
      ? [...ranges.keys()].sort((a, b) => a - b)
      : [];
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sortedIdx.map((idx) => {
          const count = ranges.get(idx).length;
          const prefix = cat.key === "OTHER" ? "" : `${cat.key} `;
          return (
            <FolderTile
              key={idx}
              icon={FolderOpen}
              iconWrapClass={chamberFolderClass(cat.chamber)}
              title={`${prefix}${rangeLabel(idx)}`}
              subtitle={`${count} ${count === 1 ? "bill" : "bills"}`}
              onClick={() => openRange(idx)}
            />
          );
        })}
      </div>
    );
  };

  // Bill list within a range (card or list layout)
  const renderRangeBills = () => (
    <div className="space-y-4">
      {/* Layout toggle */}
      <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 w-fit">
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

      {layout === "icon" ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {rangeBills.map((bill) => {
            const meta = personalMeta[bill.bill_number] || {};
            return (
              <BillCard
                key={bill.id}
                bill={bill}
                onViewDetails={(b) => setDetailBillNumber(b.bill_number)}
                onToggleTracking={handleToggleTracking}
                isTracked={true}
                teamMeta={{
                  flag: meta.flag ?? null,
                  bill_summary_notes: meta.bill_summary_notes ?? "",
                  assigneeName: null,
                }}
                lcTracking={lcTrackingMap[bill.bill_number] || null}
              />
            );
          })}
        </div>
      ) : (
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
                    {rangeBills.map((bill) => {
                      const meta = personalMeta[bill.bill_number] || {};
                      return (
                        <TableRow key={bill.id} className="align-top">
                          {/* Bill Number */}
                          <TableCell className="font-mono font-semibold text-blue-700 whitespace-nowrap">
                            <button
                              className="hover:underline text-left"
                              onClick={() =>
                                setDetailBillNumber(bill.bill_number)
                              }
                            >
                              {bill.bill_number}
                            </button>
                          </TableCell>

                          {/* Title */}
                          <TableCell className="text-sm text-slate-700 max-w-[280px]">
                            <span className="line-clamp-2">{bill.title}</span>
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
                              <span className="text-xs text-slate-400">—</span>
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
                              <span className="text-xs text-slate-400">—</span>
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
                                  <span className="text-slate-400">None</span>
                                </SelectItem>
                                <SelectItem value="low">
                                  <span className="flex items-center gap-1 text-green-700">
                                    <Shield className="w-3 h-3" /> Low Risk
                                  </span>
                                </SelectItem>
                                <SelectItem value="high">
                                  <span className="flex items-center gap-1 text-red-700">
                                    <AlertTriangle className="w-3 h-3" /> High
                                    Risk
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
                              <span className="text-xs text-slate-400">—</span>
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
                                  [
                                    "personalBillMeta",
                                    state,
                                    selectedSessionId,
                                  ],
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
      )}
    </div>
  );

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
              Organized into folders by chamber and bill number
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

        {/* Breadcrumb — only once there are bills and we're not loading */}
        {!isLoading && trackedBills.length > 0 && (
          <div className="bg-white px-4 py-3 rounded-lg border border-slate-200">
            <Breadcrumb />
          </div>
        )}

        {/* Content */}
        {isLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
            <p className="mt-4 text-slate-600">Loading tracked bills...</p>
          </div>
        ) : trackedBills.length === 0 ? (
          <div className="text-center py-12">
            <Star className="w-12 h-12 text-slate-400 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-slate-900 mb-2">
              No bills tracked yet
            </h3>
            <p className="text-slate-600 mb-4">
              Start tracking bills from the main dashboard to see them here.
            </p>
          </div>
        ) : detailBill ? (
          <TrackedBillDetail
            bill={detailBill}
            analysis={personalMeta[detailBill.bill_number]?.analysis || {}}
            onSave={(analysis) =>
              handleMetaChange(detailBill.bill_number, { analysis })
            }
            onBack={() =>
              activeRange != null
                ? setDetailBillNumber(null)
                : detailContext
                  ? (openCategory(detailContext.catKey),
                    openRange(detailContext.rangeIdx))
                  : goRoot()
            }
            lcTracking={lcTrackingMap[detailBill.bill_number] || null}
          />
        ) : detailBillNumber ? (
          // A bill was opened but is no longer in the tracked set.
          <div className="text-center py-12">
            <p className="text-slate-600 mb-4">This bill is no longer tracked.</p>
            <button
              onClick={() => setDetailBillNumber(null)}
              className="text-blue-600 hover:underline"
            >
              Back to folders
            </button>
          </div>
        ) : activeCategory && activeRange != null ? (
          renderRangeBills()
        ) : activeCategory ? (
          renderRangeFolders()
        ) : (
          renderCategoryFolders()
        )}
      </div>
    </div>
  );
}
