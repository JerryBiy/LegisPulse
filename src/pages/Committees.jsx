import { useState, useMemo, useCallback, useEffect } from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  CHAMBER,
  fetchCommittees,
  fetchCommitteeBills,
  fetchCommitteeDetails,
  resolveLegisGaSessionMapping,
} from "@/services/legisGa";
import { api } from "@/api/apiClient";
import { useLegislativeSession } from "@/lib/LegislativeSessionContext";
import {
  Building2,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  FileText,
  ExternalLink,
  Users,
  Search,
  Loader2,
  Star,
  Phone,
  MapPin,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import BillDetailsModal from "@/components/bills/BillDetailsModal";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

function cleanCommitteeName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:georgia\s+)?(?:house|senate)\s+/i, "")
    .replace(/^committee\s+on\s+/i, "")
    .replace(/\s+committee$/i, "")
    .trim();
}

function normalizeCommitteeName(value) {
  return cleanCommitteeName(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bcommittees?\b/g, " ")
    .replace(/\bon\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function chamberCodeFromValue(value) {
  const numeric = Number(value);
  if ([CHAMBER.HOUSE, CHAMBER.SENATE, CHAMBER.JOINT].includes(numeric)) {
    return numeric;
  }

  const text = String(value || "").trim().toLowerCase();
  if (text === "h" || text.includes("house") || text.includes("lower")) {
    return CHAMBER.HOUSE;
  }
  if (text === "s" || text.includes("senate") || text.includes("upper")) {
    return CHAMBER.SENATE;
  }
  if (text === "j" || text.includes("joint")) return CHAMBER.JOINT;
  return null;
}

function billChamberCode(bill) {
  return chamberCodeFromValue(bill?.chamber);
}

function normalizeBillId(id) {
  return String(id ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function historyActionText(action) {
  if (typeof action === "string") return action;
  return String(
    action?.action ||
      action?.description ||
      action?.event ||
      action?.status ||
      "",
  );
}

function historyActionChamberCode(action, fallback = null) {
  if (action && typeof action === "object") {
    const structured =
      chamberCodeFromValue(action.chamber_id) ||
      chamberCodeFromValue(action.chamber) ||
      chamberCodeFromValue(action.body_id) ||
      chamberCodeFromValue(action.body);
    if (structured) return structured;
  }
  return chamberCodeFromValue(historyActionText(action)) || fallback;
}

function historyCommitteeNames(action) {
  if (!action) return [];
  const names = new Map();
  const add = (value) => {
    if (typeof value !== "string") return;
    const displayName = cleanCommitteeName(value);
    const key = normalizeCommitteeName(displayName);
    if (key && !names.has(key)) names.set(key, displayName);
  };

  if (typeof action === "object") {
    add(action.committee_name);
    add(action.committee?.name);
    add(action.committee?.committee_name);
    add(typeof action.committee === "string" ? action.committee : null);
    add(action.pending_committee?.name);
    add(action.referral?.committee_name);
    add(action.referral?.committee?.name);
  }

  const text = historyActionText(action);
  const patterns = [
    /\b(?:referred|assigned|committed)\s+to\s+(?:the\s+)?(?:(?:house|senate)\s+)?(?:committee\s+on\s+)?(.+?)(?=\s+committee\b|[.;]|$)/i,
    /\bcommittee\s+on\s+(.+?)(?=[.;]|$)/i,
    /\b(?:house|senate)\s+(.+?)\s+committee\b/i,
    /\b(?:from|by)\s+(?:the\s+)?(.+?)\s+committee\b/i,
    /\bcommittee\s*[:\-]\s*(.+?)(?=[.;]|$)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) add(match[1]);
  }

  return [...names.values()];
}

function currentCommitteeChamberCode(bill) {
  return (
    chamberCodeFromValue(bill?.current_committee) ||
    historyActionChamberCode(bill?.history?.[0], billChamberCode(bill)) ||
    billChamberCode(bill)
  );
}

// ═══════════════════════════════════════════════════════════════
// Committees Page
// ═══════════════════════════════════════════════════════════════

export default function CommitteesPage() {
  const queryClient = useQueryClient();
  const { state, selectedSession, selectedSessionId, isReady } =
    useLegislativeSession();
  const {
    data: providerSessionMapping,
    error: providerSessionError,
    isLoading: loadingProviderSession,
  } = useQuery({
    queryKey: ["legisGaSessionMapping", state, selectedSessionId],
    queryFn: () => resolveLegisGaSessionMapping(selectedSession),
    enabled: isReady && Boolean(selectedSession),
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
  const providerSessionId = providerSessionMapping?.gaSessionId ?? null;
  const hasProviderSession = Boolean(providerSessionId);
  // Navigation state:  chamber → committee → bills
  const [selectedChamber, setSelectedChamber] = useState(null); // "upper" | "lower"
  const [selectedCommittee, setSelectedCommittee] = useState(null); // { id, name, chamber }
  const [billTab, setBillTab] = useState("current"); // "current" | "all"
  const [searchQuery, setSearchQuery] = useState("");
  const [trackingFilter, setTrackingFilter] = useState("all"); // all | my | team | allTeams
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [selectedBill, setSelectedBill] = useState(null);

  // Map UI chamber ("upper"/"lower") → legis.ga.gov ChamberType enum
  const chamberCode =
    selectedChamber === "upper"
      ? CHAMBER.SENATE
      : selectedChamber === "lower"
        ? CHAMBER.HOUSE
        : null;

  // ── Fetch committees for the selected chamber ──
  const {
    data: liveCommittees = [],
    isLoading: loadingLiveCommittees,
  } = useQuery({
    queryKey: [
      "gaCommittees",
      state,
      selectedSessionId,
      providerSessionId,
      chamberCode,
    ],
    queryFn: () => fetchCommittees(chamberCode, providerSessionId),
    enabled: isReady && hasProviderSession && !!chamberCode,
    staleTime: 5 * 60 * 1000,
  });

  // ── Fetch committee details (members, address) ──
  const { data: committeeDetails, isLoading: loadingDetails } = useQuery({
    queryKey: [
      "committeeDetails",
      state,
      selectedSessionId,
      providerSessionId,
      selectedCommittee?.id,
    ],
    queryFn: () =>
      fetchCommitteeDetails(selectedCommittee.id, providerSessionId),
    enabled:
      isReady &&
      hasProviderSession &&
      selectedCommittee?.source === "legis-ga" &&
      !!selectedCommittee?.id,
    staleTime: 5 * 60 * 1000,
  });

  // ── Fetch bills for the selected committee ──
  const { data: sessionBills = [], isLoading: loadingBills } = useQuery({
    queryKey: ["bills", state, selectedSessionId],
    queryFn: () => api.entities.Bill.list(selectedSessionId, undefined, state),
    enabled: isReady,
  });

  const {
    data: officialCommitteeBills = [],
    isLoading: loadingOfficialCommitteeBills,
    error: officialCommitteeBillsError,
  } = useQuery({
    queryKey: [
      "committeeBills",
      state,
      selectedSessionId,
      providerSessionId,
      selectedCommittee?.id,
    ],
    queryFn: () =>
      fetchCommitteeBills(selectedCommittee.id, providerSessionId),
    enabled:
      isReady &&
      hasProviderSession &&
      selectedCommittee?.source === "legis-ga" &&
      Boolean(selectedCommittee?.id),
    staleTime: 5 * 60 * 1000,
  });

  const derivedCommittees = useMemo(() => {
    if (!chamberCode) return [];
    const names = new Map();
    const addName = (value) => {
      const displayName = cleanCommitteeName(value);
      const key = normalizeCommitteeName(displayName);
      if (key && !names.has(key)) names.set(key, displayName);
    };

    for (const bill of sessionBills) {
      const fallbackChamber = billChamberCode(bill);
      if (
        bill.current_committee &&
        currentCommitteeChamberCode(bill) === chamberCode
      ) {
        addName(bill.current_committee);
      }

      for (const action of bill.history || []) {
        if (
          historyActionChamberCode(action, fallbackChamber) !== chamberCode
        ) {
          continue;
        }
        for (const name of historyCommitteeNames(action)) addName(name);
      }
    }

    return [...names.entries()]
      .sort(([, a], [, b]) => a.localeCompare(b))
      .map(([key, name]) => ({
        id: "session-" + chamberCode + "-" + key.replace(/\s+/g, "-"),
        committeeKey: key,
        name,
        chamber: chamberCode,
        source: "session-bills",
      }));
  }, [chamberCode, sessionBills]);

  const committees = useMemo(() => {
    if (!hasProviderSession) return derivedCommittees;
    const byName = new Map();
    for (const committee of liveCommittees) {
      const key = normalizeCommitteeName(committee.name);
      if (!key) continue;
      byName.set(key, {
        ...committee,
        committeeKey: key,
        source: "legis-ga",
      });
    }
    for (const committee of derivedCommittees) {
      const key =
        committee.committeeKey || normalizeCommitteeName(committee.name);
      if (key && !byName.has(key)) {
        byName.set(key, committee);
      }
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [derivedCommittees, hasProviderSession, liveCommittees]);

  const loadingCommittees =
    loadingBills ||
    loadingProviderSession ||
    (hasProviderSession && loadingLiveCommittees);

  const derivedCommitteeBills = useMemo(() => {
    if (!selectedCommittee?.name) return [];
    const target =
      selectedCommittee.committeeKey ||
      normalizeCommitteeName(selectedCommittee.name);
    const targetChamber =
      chamberCodeFromValue(selectedCommittee.chamber) || chamberCode;
    if (!target || !targetChamber) return [];

    return sessionBills.flatMap((bill) => {
      const fallbackChamber = billChamberCode(bill);
      const currentMatches =
        currentCommitteeChamberCode(bill) === targetChamber &&
        normalizeCommitteeName(bill.current_committee) === target;
      const committeeActions = (bill.history || []).filter(
        (action) =>
          historyActionChamberCode(action, fallbackChamber) === targetChamber &&
          historyCommitteeNames(action).some(
            (name) => normalizeCommitteeName(name) === target,
          ),
      );

      if (!currentMatches && committeeActions.length === 0) return [];

      return [{
        id: bill.id,
        sourceBill: bill,
        identifier: bill.bill_number,
        title: bill.title || "Untitled bill",
        abstract: bill.description || bill.summary || "",
        chamber:
          bill.chamber === "senate" || bill.chamber === "upper"
            ? "Senate"
            : "House",
        isCurrentlyAssigned: currentMatches,
        latest_action: bill.last_action,
        latest_action_date: bill.last_action_date,
        openstates_url: bill.url || bill.state_link,
        sponsors: (bill.sponsors || []).map((sponsor) =>
          typeof sponsor === "string" ? { name: sponsor } : sponsor,
        ),
        committeeActions: committeeActions.map((action) =>
          typeof action === "string"
            ? { description: action }
            : {
                ...action,
                description: action.description || action.action || "",
              },
        ),
      }];
    });
  }, [chamberCode, selectedCommittee, sessionBills]);

  const committeeBills = useMemo(() => {
    if (selectedCommittee?.source !== "legis-ga") {
      return derivedCommitteeBills;
    }

    const localByNumber = new Map(
      sessionBills.map((bill) => [
        String(bill.bill_number || "").replace(/\s+/g, "").toUpperCase(),
        bill,
      ]),
    );
    const merged = new Map();

    for (const officialBill of officialCommitteeBills) {
      const key = String(officialBill.identifier || "")
        .replace(/\s+/g, "")
        .toUpperCase();
      const local = localByNumber.get(key) ?? null;
      merged.set(key, {
        ...officialBill,
        id: local?.id || officialBill.id,
        sourceBill: local,
        title: officialBill.title || local?.title || "Untitled bill",
        abstract:
          local?.description ||
          local?.summary ||
          officialBill.abstract ||
          "",
        latest_action: local?.last_action || officialBill.latest_action,
        latest_action_date:
          local?.last_action_date || officialBill.latest_action_date,
        openstates_url:
          officialBill.openstates_url || local?.url || local?.state_link,
        sponsors:
          officialBill.sponsors?.length > 0
            ? officialBill.sponsors
            : (local?.sponsors || []).map((sponsor) =>
                typeof sponsor === "string" ? { name: sponsor } : sponsor,
              ),
        committeeActions:
          derivedCommitteeBills.find(
            (bill) =>
              String(bill.identifier || "")
                .replace(/\s+/g, "")
                .toUpperCase() === key,
          )?.committeeActions ?? [],
      });
    }

    for (const localBill of derivedCommitteeBills) {
      const key = String(localBill.identifier || "")
        .replace(/\s+/g, "")
        .toUpperCase();
      if (!merged.has(key)) merged.set(key, localBill);
    }

    return [...merged.values()];
  }, [
    derivedCommitteeBills,
    officialCommitteeBills,
    selectedCommittee?.source,
    sessionBills,
  ]);

  // ── Bill-tracking queries (My Bills / Team Bills) ──
  const { data: personalTrackedBills = [] } = useQuery({
    queryKey: ["trackedBills", state, selectedSessionId],
    queryFn: () => api.entities.TrackedBill.getNumbers(selectedSessionId, state),
    enabled: isReady,
  });

  const { data: allTeamData } = useQuery({
    queryKey: ["allTeams"],
    queryFn: () =>
      api.entities.Team.getAll().catch(() => ({
        teams: [],
        __pendingInvites: [],
      })),
  });
  const allTeams = allTeamData?.teams ?? [];

  useEffect(() => {
    if (allTeams.length > 0 && !selectedTeamId) {
      setSelectedTeamId(allTeams[0].id);
    }
  }, [allTeams, selectedTeamId]);

  const { data: selectedTeamBillNumbers = [] } = useQuery({
    queryKey: ["teamBills", selectedTeamId, state, selectedSessionId],
    queryFn: () =>
      api.entities.Team.getBillNumbers(
        selectedTeamId,
        selectedSessionId,
        state,
      ),
    enabled: isReady && !!selectedTeamId,
    staleTime: 0,
  });

  const allTeamBillQueries = useQueries({
    queries: allTeams.map((t) => ({
      queryKey: ["teamBills", t.id, state, selectedSessionId],
      queryFn: () =>
        api.entities.Team.getBillNumbers(t.id, selectedSessionId, state),
      enabled: isReady,
      staleTime: 0,
    })),
  });
  const allTeamsBillNumbers = useMemo(() => {
    const combined = [];
    allTeamBillQueries.forEach((q) => {
      if (q.data) combined.push(...q.data);
    });
    return combined;
  }, [allTeamBillQueries]);

  const teamBillMap = useMemo(
    () =>
      Object.fromEntries(
        allTeams.map((team, index) => [
          team.id,
          allTeamBillQueries[index]?.data ?? [],
        ]),
      ),
    [allTeamBillQueries, allTeams],
  );

  const { data: lcTrackingMap = {} } = useQuery({
    queryKey: ["lcTracking", state, selectedSessionId],
    queryFn: () => api.LcTracking.getAll(selectedSessionId, state),
    enabled: isReady,
  });

  const { data: globalLcMap = {} } = useQuery({
    queryKey: ["lcGlobalMap", state, selectedSessionId],
    queryFn: () => api.LcTracking.getGlobalLcMap(selectedSessionId, state),
    enabled: isReady,
    staleTime: 10 * 60 * 1000,
  });

  const lcFor = useCallback(
    (billNumber) =>
      lcTrackingMap[billNumber] ||
      (globalLcMap[billNumber]
        ? { current_lc: globalLcMap[billNumber] }
        : null),
    [globalLcMap, lcTrackingMap],
  );

  const trackMutation = useMutation({
    mutationFn: async (
      /** @type {{bill: any, isTracked: boolean}} */ { bill, isTracked },
    ) => {
      if (isTracked) {
        return api.entities.TrackedBill.remove(
          selectedSessionId,
          bill.bill_number,
          state,
        );
      }
      return api.entities.TrackedBill.add(selectedSessionId, bill, state);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["trackedBills", state, selectedSessionId],
      }),
  });

  const teamBillMutation = useMutation({
    mutationFn: async (
      /** @type {{teamId: string, bill: any, isInTeam: boolean}} */ {
        teamId,
        bill,
        isInTeam,
      },
    ) => {
      if (isInTeam) {
        return api.entities.Team.removeBill(
          teamId,
          bill.bill_number,
          selectedSessionId,
          state,
        );
      }
      return api.entities.Team.addBill(
        teamId,
        bill,
        selectedSessionId,
        state,
      );
    },
    onSuccess: (
      _data,
      /** @type {{teamId: string, bill: any, isInTeam: boolean}} */ variables,
    ) => {
      queryClient.invalidateQueries({
        queryKey: [
          "teamBills",
          variables.teamId,
          state,
          selectedSessionId,
        ],
      });
      queryClient.invalidateQueries({ queryKey: ["allTeamBills"] });
      queryClient.invalidateQueries({ queryKey: ["allTeamBillNumbers"] });
    },
  });

  const handleToggleTracking = useCallback(
    (_billId, billNumber) => {
      const bill = sessionBills.find(
        (candidate) =>
          normalizeBillId(candidate.bill_number) === normalizeBillId(billNumber),
      );
      if (!bill) return;
      trackMutation.mutate({
        bill,
        isTracked: personalTrackedBills.includes(bill.bill_number),
      });
    },
    [normalizeBillId, personalTrackedBills, sessionBills, trackMutation],
  );

  const handleToggleTeamBill = useCallback(
    (teamId, billNumber) => {
      const bill = sessionBills.find(
        (candidate) =>
          normalizeBillId(candidate.bill_number) === normalizeBillId(billNumber),
      );
      if (!bill) return;
      teamBillMutation.mutate({
        teamId,
        bill,
        isInTeam: (teamBillMap[teamId] ?? []).includes(bill.bill_number),
      });
    },
    [normalizeBillId, sessionBills, teamBillMap, teamBillMutation],
  );

  const handleBillUpdate = useCallback(
    (updatedBill) => {
      if (!updatedBill?.id) return;
      queryClient.setQueryData(["bills", state, selectedSessionId], (old) =>
        Array.isArray(old)
          ? old.map((bill) =>
              bill.id === updatedBill.id ? updatedBill : bill,
            )
          : old,
      );
      setSelectedBill((current) =>
        current?.id === updatedBill.id ? updatedBill : current,
      );
    },
    [queryClient, selectedSessionId, state],
  );

  // Build a Set of normalised tracked bill IDs for the active filter
  const trackedBillSet = useMemo(() => {
    if (trackingFilter === "my") {
      return new Set(personalTrackedBills.map(normalizeBillId));
    }
    if (trackingFilter === "team") {
      return new Set(selectedTeamBillNumbers.map(normalizeBillId));
    }
    if (trackingFilter === "allTeams") {
      return new Set(allTeamsBillNumbers.map(normalizeBillId));
    }
    return new Set(
      [...personalTrackedBills, ...allTeamsBillNumbers].map(normalizeBillId),
    );
  }, [
    trackingFilter,
    personalTrackedBills,
    selectedTeamBillNumbers,
    allTeamsBillNumbers,
    normalizeBillId,
  ]);

  // "Currently Assigned" is the intersection of bills the user or one of
  // their teams saved and bills the official site says are assigned now.
  const { currentBills, allBills } = useMemo(() => {
    const current = committeeBills.filter(
      (bill) =>
        bill.isCurrentlyAssigned &&
        trackedBillSet.has(normalizeBillId(bill.identifier)),
    );
    return { currentBills: current, allBills: committeeBills };
  }, [committeeBills, normalizeBillId, trackedBillSet]);

  const displayedBills = useMemo(() => {
    return billTab === "current" ? currentBills : allBills;
  }, [allBills, billTab, currentBills]);

  // Filter bills by search
  const filteredBills = useMemo(() => {
    if (!searchQuery.trim()) return displayedBills;
    const q = searchQuery.toLowerCase();
    return displayedBills.filter(
      (b) =>
        b.identifier.toLowerCase().includes(q) ||
        b.title.toLowerCase().includes(q) ||
        b.abstract.toLowerCase().includes(q),
    );
  }, [displayedBills, searchQuery]);

  const loadingCommitteeBills =
    loadingBills ||
    (selectedCommittee?.source === "legis-ga" &&
      loadingOfficialCommitteeBills);

  useEffect(() => {
    setSelectedCommittee(null);
    setBillTab("current");
    setSearchQuery("");
    setSelectedBill(null);
  }, [selectedSessionId]);

  // ── Chamber selection screen ──
  if (!selectedChamber) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="max-w-3xl mx-auto px-4 py-12">
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-100 mb-4">
              <Building2 className="w-8 h-8 text-indigo-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">
              Georgia Legislative Committees
            </h1>
            <p className="text-slate-500 mt-2">
              Select a chamber to browse committees and their legislation
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* House */}
            <button
              onClick={() => setSelectedChamber("lower")}
              className="group relative overflow-hidden rounded-2xl border-2 border-emerald-200 bg-white p-8 text-left transition-all hover:border-emerald-400 hover:shadow-lg hover:shadow-emerald-100"
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-bl-[80px] -mr-4 -mt-4 transition-all group-hover:bg-emerald-100" />
              <div className="relative">
                <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center mb-4 group-hover:bg-emerald-200 transition-colors">
                  <Building2 className="w-6 h-6 text-emerald-700" />
                </div>
                <h2 className="text-xl font-bold text-slate-900 mb-1">House</h2>
                <p className="text-sm text-slate-500">
                  House of Representatives committees
                </p>
                <div className="flex items-center gap-1 text-emerald-600 text-sm font-medium mt-4">
                  Browse committees <ChevronRight className="w-4 h-4" />
                </div>
              </div>
            </button>

            {/* Senate */}
            <button
              onClick={() => setSelectedChamber("upper")}
              className="group relative overflow-hidden rounded-2xl border-2 border-blue-200 bg-white p-8 text-left transition-all hover:border-blue-400 hover:shadow-lg hover:shadow-blue-100"
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 rounded-bl-[80px] -mr-4 -mt-4 transition-all group-hover:bg-blue-100" />
              <div className="relative">
                <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center mb-4 group-hover:bg-blue-200 transition-colors">
                  <Building2 className="w-6 h-6 text-blue-700" />
                </div>
                <h2 className="text-xl font-bold text-slate-900 mb-1">
                  Senate
                </h2>
                <p className="text-sm text-slate-500">Senate committees</p>
                <div className="flex items-center gap-1 text-blue-600 text-sm font-medium mt-4">
                  Browse committees <ChevronRight className="w-4 h-4" />
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const chamberLabel = selectedChamber === "upper" ? "Senate" : "House";
  const chamberColor = selectedChamber === "upper" ? "blue" : "emerald";

  // ── Committee list screen ──
  if (!selectedCommittee) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="max-w-3xl mx-auto px-4 py-8">
          {/* Back button */}
          <button
            onClick={() => setSelectedChamber(null)}
            className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 mb-6 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to chambers
          </button>

          <div className="flex items-center gap-3 mb-6">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                chamberColor === "blue" ? "bg-blue-100" : "bg-emerald-100"
              }`}
            >
              <Building2
                className={`w-5 h-5 ${
                  chamberColor === "blue" ? "text-blue-700" : "text-emerald-700"
                }`}
              />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">
                {chamberLabel} Committees
              </h1>
              <p className="text-sm text-slate-500">
                {committees.length} committee
                {committees.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>

          {providerSessionError && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              The complete official committee directory is unavailable because
              this session could not be matched safely to the Georgia Legislature.
              {" "}{providerSessionError.message}
            </div>
          )}

          {loadingCommittees ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
              <span className="ml-2 text-sm text-slate-500">
                Loading committees…
              </span>
            </div>
          ) : committees.length === 0 ? (
            <div className="text-center py-20 text-slate-400">
              No committees found
            </div>
          ) : (
            <div className="space-y-2">
              {committees.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setSelectedCommittee(c);
                    setBillTab("current");
                    setSearchQuery("");
                    setTrackingFilter("all");
                  }}
                  className="w-full flex items-center justify-between p-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 transition-all text-left group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        chamberColor === "blue"
                          ? "bg-blue-50 text-blue-600"
                          : "bg-emerald-50 text-emerald-600"
                      }`}
                    >
                      <Users className="w-4 h-4" />
                    </div>
                    <span className="font-medium text-slate-800 truncate">
                      {c.name}
                    </span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Committee detail screen (bills) ──
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-sm text-slate-500 mb-6">
          <button
            onClick={() => {
              setSelectedChamber(null);
              setSelectedCommittee(null);
            }}
            className="hover:text-slate-800 transition-colors"
          >
            Committees
          </button>
          <ChevronRight className="w-3 h-3" />
          <button
            onClick={() => setSelectedCommittee(null)}
            className="hover:text-slate-800 transition-colors"
          >
            {chamberLabel}
          </button>
          <ChevronRight className="w-3 h-3" />
          <span className="text-slate-800 font-medium truncate">
            {selectedCommittee.name}
          </span>
        </div>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                chamberColor === "blue" ? "bg-blue-100" : "bg-emerald-100"
              }`}
            >
              <Users
                className={`w-5 h-5 ${
                  chamberColor === "blue" ? "text-blue-700" : "text-emerald-700"
                }`}
              />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-slate-900 truncate">
                {selectedCommittee.name}
              </h1>
              <p className="text-sm text-slate-500">{chamberLabel} Committee</p>
            </div>
            {selectedCommittee.source === "legis-ga" && (
              <a
                href={`https://www.legis.ga.gov/committees/${chamberLabel.toLowerCase()}/${selectedCommittee.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1 shrink-0"
                title="View on legis.ga.gov"
              >
                legis.ga.gov <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>

        {/* Committee info card (address, phone, members) */}
        <CommitteeInfoCard
          details={committeeDetails}
          loading={loadingDetails}
          chamberColor={chamberColor}
          sessionOnly={selectedCommittee.source !== "legis-ga"}
        />

        {officialCommitteeBillsError && (
          <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            The official bill list could not be loaded. Locally synced committee
            history is shown as a fallback. {officialCommitteeBillsError.message}
          </div>
        )}

        {/* Tabs: Current vs All */}
        <div className="flex items-center gap-4 mb-4 border-b border-slate-200">
          <button
            onClick={() => setBillTab("current")}
            className={`pb-2.5 px-1 text-sm font-medium border-b-2 transition-colors ${
              billTab === "current"
                ? `border-${chamberColor}-600 text-${chamberColor}-700`
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
            style={
              billTab === "current"
                ? {
                    borderColor:
                      chamberColor === "blue" ? "#2563eb" : "#059669",
                    color: chamberColor === "blue" ? "#1d4ed8" : "#047857",
                  }
                : undefined
            }
          >
            Currently Assigned
            {!loadingCommitteeBills && (
              <Badge variant="secondary" className="ml-1.5 text-[10px]">
                {currentBills.length}
              </Badge>
            )}
          </button>
          <button
            onClick={() => setBillTab("all")}
            className={`pb-2.5 px-1 text-sm font-medium border-b-2 transition-colors ${
              billTab === "all"
                ? `border-${chamberColor}-600 text-${chamberColor}-700`
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
            style={
              billTab === "all"
                ? {
                    borderColor:
                      chamberColor === "blue" ? "#2563eb" : "#059669",
                    color: chamberColor === "blue" ? "#1d4ed8" : "#047857",
                  }
                : undefined
            }
          >
            All Bills
            {!loadingCommitteeBills && (
              <Badge variant="secondary" className="ml-1.5 text-[10px]">
                {allBills.length}
              </Badge>
            )}
          </button>
        </div>

        {/* Tracking filter (only for Currently Assigned tab) */}
        {billTab === "current" && (
          <div className="flex items-center gap-1 mb-4 rounded-lg border border-slate-200 bg-slate-50 p-0.5 w-fit overflow-hidden">
            <button
              onClick={() => setTrackingFilter("all")}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                trackingFilter === "all"
                  ? "bg-slate-800 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-100"
              }`}
            >
              All Saved
            </button>
            <button
              onClick={() => setTrackingFilter("my")}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                trackingFilter === "my"
                  ? "bg-yellow-500 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Star className="w-3 h-3 inline mr-0.5 -mt-0.5" />
              My Bills
            </button>
            <div className="flex">
              <button
                onClick={() => setTrackingFilter("allTeams")}
                className={`px-2.5 py-1 text-xs font-medium rounded-l transition-colors border-r ${
                  trackingFilter === "team" || trackingFilter === "allTeams"
                    ? "bg-indigo-600 text-white border-indigo-400"
                    : "bg-white text-slate-600 hover:bg-slate-100 border-slate-200"
                }`}
              >
                <Users className="w-3 h-3 inline mr-0.5 -mt-0.5" />
                {trackingFilter === "allTeams"
                  ? "All Teams"
                  : trackingFilter === "team" && selectedTeamId
                    ? (allTeams.find((t) => t.id === selectedTeamId)?.name ??
                      "Team Bills")
                    : "Team Bills"}
              </button>
              {allTeams.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className={`px-1.5 py-1 text-xs font-medium rounded-r transition-colors ${
                        trackingFilter === "team" ||
                        trackingFilter === "allTeams"
                          ? "bg-indigo-600 text-white hover:bg-indigo-700"
                          : "bg-white text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      <ChevronDown className="w-3 h-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="text-xs">
                    {allTeams.length > 1 && (
                      <DropdownMenuItem
                        className={`text-xs cursor-pointer ${
                          trackingFilter === "allTeams" ? "font-semibold" : ""
                        }`}
                        onClick={() => setTrackingFilter("allTeams")}
                      >
                        All Teams
                      </DropdownMenuItem>
                    )}
                    {allTeams.map((t) => (
                      <DropdownMenuItem
                        key={t.id}
                        className={`text-xs cursor-pointer ${
                          trackingFilter === "team" && selectedTeamId === t.id
                            ? "font-semibold"
                            : ""
                        }`}
                        onClick={() => {
                          setSelectedTeamId(t.id);
                          setTrackingFilter("team");
                        }}
                      >
                        {t.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        )}

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Search bills…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>

        {/* Bills list */}
        {loadingCommitteeBills ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
            <span className="ml-2 text-sm text-slate-500">Loading bills…</span>
          </div>
        ) : filteredBills.length === 0 ? (
          <div className="text-center py-20">
            <FileText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">
              {searchQuery
                ? "No bills match your search"
                : billTab === "current"
                  ? "No bills are currently assigned to this committee"
                  : "No bills found for this committee"}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredBills.map((bill) => (
              <BillRow
                key={bill.id}
                bill={bill}
                onViewDetails={
                  bill.sourceBill ? () => setSelectedBill(bill.sourceBill) : null
                }
              />
            ))}
          </div>
        )}
      </div>
      <BillDetailsModal
        bill={selectedBill}
        isOpen={Boolean(selectedBill)}
        onClose={() => setSelectedBill(null)}
        isTracked={
          selectedBill
            ? personalTrackedBills.includes(selectedBill.bill_number)
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

// ─── Bill Row Component ──────────────────────────────────────
function BillRow({ bill, onViewDetails }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card
      className="overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-bold text-sm text-slate-900">
                {bill.identifier}
              </span>
              <Badge
                variant="outline"
                className={`text-[10px] ${
                  bill.chamber === "Senate"
                    ? "bg-blue-50 text-blue-700 border-blue-200"
                    : "bg-emerald-50 text-emerald-700 border-emerald-200"
                }`}
              >
                {bill.chamber}
              </Badge>
              {bill.isCurrentlyAssigned && (
                <Badge
                  variant="outline"
                  className="text-[10px] bg-amber-50 text-amber-700 border-amber-200"
                >
                  Currently Assigned
                </Badge>
              )}
            </div>
            <p className="text-sm text-slate-700 line-clamp-2">{bill.title}</p>
            {bill.latest_action && (
              <p className="text-xs text-slate-400 mt-1.5">
                Latest: {bill.latest_action}
                {bill.latest_action_date && ` · ${bill.latest_action_date}`}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onViewDetails && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={(event) => {
                  event.stopPropagation();
                  onViewDetails();
                }}
              >
                View Details
              </Button>
            )}
            {bill.openstates_url && (
              <a
                href={bill.openstates_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:text-blue-700"
                title="View on legis.ga.gov"
                onClick={(event) => event.stopPropagation()}
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
          </div>
        </div>

        {/* Expanded details */}
        {expanded && (
          <div className="mt-4 pt-3 border-t border-slate-100 space-y-3">
            {bill.abstract && (
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase mb-1">
                  Summary
                </h4>
                <p className="text-sm text-slate-600">{bill.abstract}</p>
              </div>
            )}

            {bill.sponsors.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase mb-1">
                  Sponsors
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {bill.sponsors.map((s, i) => (
                    <Badge
                      key={i}
                      variant="outline"
                      className="text-xs bg-slate-50"
                    >
                      {s.name}
                      {s.party && (
                        <span className="text-slate-400 ml-1">({s.party})</span>
                      )}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {bill.committeeActions.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase mb-1">
                  Committee Actions
                </h4>
                <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                  {bill.committeeActions.map((a, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className="text-slate-400 shrink-0 w-20">
                        {a.date}
                      </span>
                      <span className="text-slate-600">{a.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── Committee Info Card (address, phone, members) ───────────
function CommitteeInfoCard({ details, loading, chamberColor, sessionOnly }) {
  const [showAllMembers, setShowAllMembers] = useState(false);

  if (loading) {
    return (
      <Card className="p-4 mb-6 flex items-center justify-center">
        <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
        <span className="ml-2 text-xs text-slate-500">
          Loading committee info…
        </span>
      </Card>
    );
  }
  if (sessionOnly) {
    return (
      <Card className="p-4 mb-6 text-xs text-slate-500">
        Committee bills are scoped to the selected LegiScan session. Historical
        roster and contact details are not inferred from the current Georgia
        legislature directory.
      </Card>
    );
  }
  if (!details) return null;

  const { address, members = [] } = details;
  // Sort by roleSort so Chairman/Vice/Secretary come first
  const sortedMembers = [...members].sort(
    (a, b) => (a.roleSort ?? 99) - (b.roleSort ?? 99),
  );
  const previewCount = 6;
  const displayed = showAllMembers
    ? sortedMembers
    : sortedMembers.slice(0, previewCount);
  const hasMore = sortedMembers.length > previewCount;

  const roleColor = (role) => {
    const r = (role || "").toLowerCase();
    if (r.includes("chair") && !r.includes("vice"))
      return "bg-amber-100 text-amber-800 border-amber-200";
    if (r.includes("vice"))
      return "bg-orange-50 text-orange-700 border-orange-200";
    if (r.includes("secretary"))
      return "bg-purple-50 text-purple-700 border-purple-200";
    if (r.includes("ex officio"))
      return "bg-slate-100 text-slate-600 border-slate-200";
    return chamberColor === "blue"
      ? "bg-blue-50 text-blue-700 border-blue-200"
      : "bg-emerald-50 text-emerald-700 border-emerald-200";
  };

  const cleanZip = (address?.zip ?? "").trim();
  const cleanState = (address?.state ?? "").trim();
  const cleanPhone = (address?.phone ?? "").replace(/\D/g, "");
  const phoneDisplay =
    cleanPhone.length === 10
      ? `(${cleanPhone.slice(0, 3)}) ${cleanPhone.slice(3, 6)}-${cleanPhone.slice(6)}`
      : (address?.phone ?? "");

  return (
    <Card className="p-4 mb-6">
      {address && (address.address1 || address.phone) && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-xs text-slate-600 mb-4 pb-4 border-b border-slate-100">
          {address.address1 && (
            <span className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-slate-400" />
              {address.address1}
              {address.address2 ? `, ${address.address2}` : ""}
              {address.city ? `, ${address.city}` : ""}
              {cleanState ? `, ${cleanState}` : ""}
              {cleanZip ? ` ${cleanZip}` : ""}
            </span>
          )}
          {cleanPhone && (
            <a
              href={`tel:+1${cleanPhone}`}
              className="flex items-center gap-1.5 hover:text-slate-900"
            >
              <Phone className="w-3.5 h-3.5 text-slate-400" />
              {phoneDisplay}
            </a>
          )}
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          Members ({sortedMembers.length})
        </h3>
      </div>

      {sortedMembers.length === 0 ? (
        <p className="text-xs text-slate-400">No members listed.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {displayed.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between gap-2 p-2 rounded-md bg-slate-50 border border-slate-100"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate">
                    {m.name}
                  </div>
                  {m.district && (
                    <div className="text-[11px] text-slate-500">
                      District {m.district}
                    </div>
                  )}
                </div>
                <Badge
                  variant="outline"
                  className={`text-[10px] shrink-0 ${roleColor(m.role)}`}
                >
                  {m.role}
                </Badge>
              </div>
            ))}
          </div>
          {hasMore && (
            <button
              onClick={() => setShowAllMembers((v) => !v)}
              className="mt-3 text-xs font-medium text-slate-500 hover:text-slate-800 flex items-center gap-1"
            >
              {showAllMembers
                ? "Show fewer"
                : `Show all ${sortedMembers.length} members`}
              <ChevronDown
                className={`w-3 h-3 transition-transform ${showAllMembers ? "rotate-180" : ""}`}
              />
            </button>
          )}
        </>
      )}
    </Card>
  );
}
