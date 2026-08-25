import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { flushSync } from "react-dom";
import {
  useQuery,
  useQueries,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/api/apiClient";
import {
  deriveSpecialSessionWindows,
  fetchAllCommittees,
  fetchGAMeetings,
  filterMeetingsForSession,
  matchMeetingToCommittee,
  resolveLegisGaSessionMapping,
} from "@/services/legisGa";
import {
  fetchCachedMeetings,
  upsertMeetings,
} from "@/services/gaMeetingsCache";
import { billKey, parseAgendaBills, prettyBill } from "@/services/meetingIntel";
import { useToast } from "@/components/ui/use-toast";
import { useLegislativeSession } from "@/lib/LegislativeSessionContext";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  addDays,
  subDays,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
  isToday,
  setHours,
  setMinutes,
  parseISO,
  differenceInMinutes,
  startOfDay,
  endOfDay,
} from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Plus,
  Clock,
  MapPin,
  Trash2,
  CalendarDays,
  Landmark,
  ExternalLink,
  FileText,
  Users,
  Star,
  Eye,
  EyeOff,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";

// ── Color palette ────────────────────────────────────────────
const EVENT_COLORS = [
  {
    value: "blue",
    label: "Blue",
    bg: "bg-blue-500",
    light: "bg-blue-100 text-blue-800 border-blue-300",
  },
  {
    value: "red",
    label: "Red",
    bg: "bg-red-500",
    light: "bg-red-100 text-red-800 border-red-300",
  },
  {
    value: "green",
    label: "Green",
    bg: "bg-green-500",
    light: "bg-green-100 text-green-800 border-green-300",
  },
  {
    value: "purple",
    label: "Purple",
    bg: "bg-purple-500",
    light: "bg-purple-100 text-purple-800 border-purple-300",
  },
  {
    value: "orange",
    label: "Orange",
    bg: "bg-orange-500",
    light: "bg-orange-100 text-orange-800 border-orange-300",
  },
  {
    value: "pink",
    label: "Pink",
    bg: "bg-pink-500",
    light: "bg-pink-100 text-pink-800 border-pink-300",
  },
  {
    value: "teal",
    label: "Teal",
    bg: "bg-teal-500",
    light: "bg-teal-100 text-teal-800 border-teal-300",
  },
  {
    value: "yellow",
    label: "Yellow",
    bg: "bg-yellow-500",
    light: "bg-yellow-100 text-yellow-800 border-yellow-300",
  },
  {
    value: "gold",
    label: "Legislative",
    bg: "bg-amber-600",
    light: "bg-amber-50 text-amber-900 border-amber-400",
  },
  {
    value: "leg-senate",
    label: "Senate",
    bg: "bg-blue-700",
    light: "bg-blue-50 text-blue-900 border-blue-400",
  },
  {
    value: "leg-house",
    label: "House",
    bg: "bg-emerald-600",
    light: "bg-emerald-50 text-emerald-900 border-emerald-400",
  },
];

const getColorClasses = (color) =>
  EVENT_COLORS.find((c) => c.value === color) ?? EVENT_COLORS[0];

const HOURS = Array.from({ length: 24 }, (_, i) => i);

// ── Helper: default new event ────────────────────────────────
const makeDefaultEvent = (date) => {
  const now = date || new Date();
  const start = setMinutes(setHours(now, now.getHours() + 1), 0);
  const end = setMinutes(setHours(now, now.getHours() + 2), 0);
  return {
    title: "",
    description: "",
    start_time: format(start, "yyyy-MM-dd'T'HH:mm"),
    end_time: format(end, "yyyy-MM-dd'T'HH:mm"),
    all_day: false,
    color: "blue",
    location: "",
  };
};

const meetingAgendaQueryKey = (providerSessionId, event) => [
  "meetingAgendaBills",
  providerSessionId,
  event?.committeeId ?? null,
  event?.id ?? null,
  event?.start_time ?? null,
  event?.agendaUrl ?? null,
];

const replaceEventsInRange = (previous, incoming, rangeStart, rangeEnd) => {
  const start = format(new Date(rangeStart), "yyyy-MM-dd");
  const end = format(new Date(rangeEnd), "yyyy-MM-dd");
  const byId = new Map();

  for (const event of previous ?? []) {
    const date = String(event.start_time || "").slice(0, 10);
    if (!date || date < start || date > end) {
      byId.set(event.id, event);
    }
  }
  for (const event of incoming ?? []) byId.set(event.id, event);

  return [...byId.values()].sort(
    (left, right) =>
      new Date(left.start_time).getTime() -
      new Date(right.start_time).getTime(),
  );
};

// ═══════════════════════════════════════════════════════════════
// Main Calendar Page
// ═══════════════════════════════════════════════════════════════
export default function CalendarPage() {
  const queryClient = useQueryClient();
  const {
    state,
    selectedSession,
    selectedSessionId,
    isReady,
  } = useLegislativeSession();
  const {
    data: providerSessionMapping,
    error: providerSessionError,
    isLoading: isLoadingProviderSession,
  } = useQuery({
    queryKey: ["legisGaSessionMapping", state, selectedSessionId],
    queryFn: () => resolveLegisGaSessionMapping(selectedSession),
    enabled: isReady && Boolean(selectedSession),
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
  const providerSessionId = providerSessionMapping?.gaSessionId ?? null;
  const hasProviderSession = Boolean(providerSessionId);
  const { toast } = useToast();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState("month"); // month | week | day
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [formData, setFormData] = useState(makeDefaultEvent());
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [showLegislative, setShowLegislative] = useState(true);
  const [chamberFilter, setChamberFilter] = useState("all"); // all | senate | house
  const [legEventDetail, setLegEventDetail] = useState(null);
  const [billFilter, setBillFilter] = useState("all"); // all | my | team | allTeams
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  // For month view: the label shown in the header, updated by scroll
  const [scrollMonthLabel, setScrollMonthLabel] = useState(
    format(new Date(), "MMMM yyyy"),
  );
  const [focusedMonthDate, setFocusedMonthDate] = useState(
    startOfMonth(new Date()),
  );
  const pageScrollRef = useRef(null);
  const stickyHeaderRef = useRef(null);
  const focusMonthDebounceRef = useRef(null);
  // Track how many months MonthView is currently showing
  const [monthRange, setMonthRange] = useState({ before: 12, after: 12 });

  useEffect(() => {
    if (!selectedSession) return;
    const now = new Date();
    const startYear = Number(selectedSession.year_start);
    const endYear = Number(selectedSession.year_end) || startYear;
    const nextDate =
      startYear && (now.getFullYear() < startYear || now.getFullYear() > endYear)
        ? new Date(startYear, 0, 1)
        : now;
    setCurrentDate(nextDate);
    setFocusedMonthDate(startOfMonth(nextDate));
    setScrollMonthLabel(format(nextDate, "MMMM yyyy"));
    setMonthRange({ before: 12, after: 12 });
    setModalOpen(false);
    setEditingEvent(null);
    setLegEventDetail(null);
    setDeleteConfirmId(null);
  }, [selectedSessionId]);

  useEffect(() => {
    if (view === "month") setFocusedMonthDate(startOfMonth(currentDate));
  }, [currentDate, view]);

  useEffect(
    () => () => {
      if (focusMonthDebounceRef.current) {
        clearTimeout(focusMonthDebounceRef.current);
      }
    },
    [],
  );

  // ── Date range for queries ──────────────────────────────────
  const queryRange = useMemo(() => {
    if (view === "month") {
      // Quantize range to 6-month boundaries to avoid constant query-key changes
      // during infinite scroll expansion
      const quantize = (n) => Math.ceil(n / 6) * 6;
      const before = quantize(monthRange.before);
      const after = quantize(monthRange.after);
      const ms = startOfWeek(startOfMonth(addMonths(currentDate, -before)), {
        weekStartsOn: 0,
      });
      const me = endOfWeek(endOfMonth(addMonths(currentDate, after)), {
        weekStartsOn: 0,
      });
      return { start: ms.toISOString(), end: me.toISOString() };
    }
    if (view === "week") {
      const ws = startOfWeek(currentDate, { weekStartsOn: 0 });
      const we = endOfWeek(currentDate, { weekStartsOn: 0 });
      return { start: ws.toISOString(), end: we.toISOString() };
    }
    return {
      start: startOfDay(currentDate).toISOString(),
      end: endOfDay(currentDate).toISOString(),
    };
  }, [currentDate, view, monthRange]);

  const focusedRange = useMemo(() => {
    if (view === "month") {
      return {
        start: startOfMonth(subMonths(focusedMonthDate, 1)).toISOString(),
        end: endOfMonth(addMonths(focusedMonthDate, 1)).toISOString(),
      };
    }
    return queryRange;
  }, [focusedMonthDate, queryRange, view]);

  // The official meetings response has no session id. A called session does,
  // however, restart the floor calendar at LD1. Discover those official floor
  // boundaries before assigning meetings to a regular or special session.
  const boundaryRange = useMemo(() => {
    const startYear =
      Number(selectedSession?.year_start) || new Date().getFullYear();
    const endYear = Number(selectedSession?.year_end) || startYear;
    return {
      start: new Date(startYear, 4, 1),
      end: new Date(endYear, 11, 31),
    };
  }, [selectedSession]);

  const {
    data: boundaryMeetings,
    error: boundaryError,
    isLoading: isLoadingBoundaries,
  } = useQuery({
    queryKey: [
      "gaMeetingSessionBoundaries",
      boundaryRange.start.toISOString(),
      boundaryRange.end.toISOString(),
    ],
    queryFn: () =>
      fetchGAMeetings(boundaryRange.start, boundaryRange.end, null, null),
    enabled: isReady && hasProviderSession,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 7 * 24 * 60 * 60 * 1000,
    retry: 1,
  });

  const specialSessionWindows = useMemo(
    () => deriveSpecialSessionWindows(boundaryMeetings ?? []),
    [boundaryMeetings],
  );
  const sessionBoundariesReady = Array.isArray(boundaryMeetings);
  const selectedSpecialWindow = providerSessionMapping?.isSpecialSession
    ? specialSessionWindows[
        (providerSessionMapping.specialSessionNumber || 1) - 1
      ] ?? null
    : null;

  useEffect(() => {
    if (!providerSessionMapping?.isSpecialSession || !selectedSpecialWindow) {
      return;
    }
    const sessionDate = new Date(`${selectedSpecialWindow.startDate}T12:00:00`);
    setCurrentDate(sessionDate);
    setFocusedMonthDate(startOfMonth(sessionDate));
    setScrollMonthLabel(format(sessionDate, "MMMM yyyy"));
  }, [
    providerSessionMapping?.gaSessionId,
    providerSessionMapping?.isSpecialSession,
    selectedSpecialWindow?.startDate,
  ]);

  // ── Fetch user events ──────────────────────────────────────
  const { data: userEvents = [], isLoading: isLoadingUser } = useQuery({
    queryKey: [
      "calendarEvents",
      state,
      selectedSessionId,
      queryRange.start,
      queryRange.end,
    ],
    queryFn: () =>
      api.calendarEvents.list(
        selectedSessionId,
        queryRange.start,
        queryRange.end,
        state,
      ),
    enabled: isReady,
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey?.[1] === state &&
      Number(previousQuery?.queryKey?.[2]) === Number(selectedSessionId)
        ? previousData
        : undefined,
  });

  // ── Fetch GA legislative events from Supabase cache ───────────
  // The focused live request below populates this cache after each visit.
  const { data: legEvents = [], isLoading: isLoadingLeg } = useQuery({
    queryKey: [
      "legEventsCached",
      state,
      selectedSessionId,
      providerSessionId,
      queryRange.start,
      queryRange.end,
    ],
    queryFn: () =>
      fetchCachedMeetings(
        queryRange.start,
        queryRange.end,
        selectedSessionId,
        state,
        providerSessionId,
      ),
    enabled: isReady && hasProviderSession && sessionBoundariesReady,
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey?.[1] === state &&
      Number(previousQuery?.queryKey?.[2]) === Number(selectedSessionId) &&
      Number(previousQuery?.queryKey?.[3]) === Number(providerSessionId)
        ? previousData
        : undefined,
  });

  const meetingSheetQueryKey = useMemo(
    () => ["gaMeetingsSheet", state, selectedSessionId, providerSessionId],
    [providerSessionId, selectedSessionId, state],
  );
  const { data: liveMeetingSheet = [] } = useQuery({
    queryKey: meetingSheetQueryKey,
    queryFn: async () => [],
    enabled: isReady && hasProviderSession,
    initialData: [],
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000,
  });

  // ── Focused live refresh ───────────────────────────────────────
  // Fetch the focused range directly so a full-session cache warm-up never
  // delays visible meetings.
  const {
    data: focusedLegEvents = [],
    error: focusedMeetingsError,
    isLoading: isLoadingFocusedMeetings,
  } = useQuery({
    queryKey: [
      "gaMeetingsFocused",
      state,
      selectedSessionId,
      providerSessionId,
      focusedRange.start,
      focusedRange.end,
    ],
    queryFn: async () => {
      const meetings = await fetchGAMeetings(
        focusedRange.start,
        focusedRange.end,
        null,
        providerSessionMapping,
      );
      const scoped = filterMeetingsForSession(
        meetings,
        providerSessionMapping,
        specialSessionWindows,
      );
      queryClient.setQueryData(meetingSheetQueryKey, (previous) =>
        replaceEventsInRange(
          previous,
          scoped,
          focusedRange.start,
          focusedRange.end,
        ),
      );
      void upsertMeetings(scoped, selectedSessionId, state).catch((error) => {
        console.warn("Meeting cache update failed:", error?.message);
      });
      return scoped;
    },
    enabled:
      isReady &&
      hasProviderSession &&
      sessionBoundariesReady &&
      (!providerSessionMapping?.isSpecialSession || !!selectedSpecialWindow),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const scopedCachedEvents = useMemo(
    () =>
      filterMeetingsForSession(
        legEvents,
        providerSessionMapping,
        specialSessionWindows,
      ),
    [legEvents, providerSessionMapping, specialSessionWindows],
  );

  const sessionLegEvents = useMemo(() => {
    const byId = new Map(scopedCachedEvents.map((event) => [event.id, event]));
    liveMeetingSheet.forEach((event) => byId.set(event.id, event));
    return [...byId.values()];
  }, [liveMeetingSheet, scopedCachedEvents]);

  const isLoading =
    isLoadingUser ||
    isLoadingLeg ||
    isLoadingProviderSession ||
    isLoadingBoundaries ||
    isLoadingFocusedMeetings;
  // Only show the full-screen spinner on the very first load (no data yet).
  // Subsequent background refetches keep the calendar mounted so the view
  // doesn't snap back to the current month.
  const isInitialLoad =
    isLoading && userEvents.length === 0 && sessionLegEvents.length === 0;

  // ── Committee lookup for legislative events (for bill associations) ──
  const { data: allCommittees = [] } = useQuery({
    queryKey: ["gaAllCommittees", state, selectedSessionId, providerSessionId],
    queryFn: () => fetchAllCommittees(providerSessionId),
    enabled: isReady && hasProviderSession,
    staleTime: 60 * 60 * 1000, // 1h
    gcTime: 24 * 60 * 60 * 1000,
  });

  // Attach committeeId to each legislative event by parsing its subject
  const legEventsWithCommittees = useMemo(() => {
    if (!sessionLegEvents.length) return sessionLegEvents;
    if (!allCommittees.length)
      return sessionLegEvents.map((ev) => ({ ...ev, committeeId: null }));
    return sessionLegEvents.map((ev) => {
      const c = matchMeetingToCommittee(ev, allCommittees);
      return c
        ? { ...ev, committeeId: c.id, committeeName: c.name }
        : { ...ev, committeeId: null };
    });
  }, [sessionLegEvents, allCommittees]);

  // Session-local bill data is used only to resolve agenda bill numbers.
  const { data: sessionBills = [] } = useQuery({
    queryKey: ["bills", state, selectedSessionId],
    queryFn: () => api.entities.Bill.list(selectedSessionId, undefined, state),
    enabled: isReady,
  });

  // Agenda queries are lazy unless a tracked-bill filter is active.
  const focusedAgendaEvents = useMemo(
    () => {
      const focusedIds = new Set(focusedLegEvents.map((event) => event.id));
      const visibleMonthKey = format(focusedMonthDate, "yyyy-MM");
      return legEventsWithCommittees.filter(
        (event) =>
          focusedIds.has(event.id) &&
          event.agendaUrl &&
          (view !== "month" ||
            String(event.start_time).slice(0, 7) === visibleMonthKey),
      );
    },
    [focusedLegEvents, focusedMonthDate, legEventsWithCommittees, view],
  );
  const focusedAgendaQueries = useQueries({
    queries: focusedAgendaEvents.map((event) => ({
      queryKey: meetingAgendaQueryKey(providerSessionId, event),
      queryFn: () => parseAgendaBills(event.agendaUrl),
      enabled: billFilter !== "all",
      staleTime: 24 * 60 * 60 * 1000,
      retry: 1,
    })),
  });
  const agendaBillsByEventId = useMemo(() => {
    const map = new Map();
    focusedAgendaEvents.forEach((event, index) => {
      const numbers = focusedAgendaQueries[index]?.data;
      if (Array.isArray(numbers)) map.set(event.id, numbers);
    });
    return map;
  }, [focusedAgendaEvents, focusedAgendaQueries]);

  useEffect(() => {
    if (agendaBillsByEventId.size === 0) return;
    queryClient.setQueryData(meetingSheetQueryKey, (previous = []) => {
      let changed = false;
      const next = previous.map((event) => {
        const numbers = agendaBillsByEventId.get(event.id);
        if (!numbers) return event;
        const existing = event.agenda_bill_numbers ?? [];
        if (
          existing.length === numbers.length &&
          existing.every((number, index) => number === numbers[index])
        ) {
          return event;
        }
        changed = true;
        return { ...event, agenda_bill_numbers: numbers };
      });
      return changed ? next : previous;
    });
  }, [agendaBillsByEventId, meetingSheetQueryKey, queryClient]);

  const sessionBillsByNumber = useMemo(
    () =>
      new Map(
        sessionBills.map((bill) => [billKey(bill.bill_number), bill]),
      ),
    [sessionBills],
  );

  const legEventsWithAgendaBills = useMemo(
    () =>
      legEventsWithCommittees.map((event) => {
        const numbers =
          agendaBillsByEventId.get(event.id) ??
          event.agenda_bill_numbers ??
          [];
        const bills = numbers.map((number) => {
          const bill = sessionBillsByNumber.get(billKey(number));
          return bill
            ? {
                id: bill.id,
                identifier: bill.bill_number,
                title: bill.title,
                status: bill.last_action,
                statusDate: bill.last_action_date,
                openstates_url: bill.url || bill.state_link,
              }
            : {
                id: billKey(number),
                identifier: prettyBill(number),
                title: "Not found in the selected session's bill cache",
              };
        });
        return { ...event, agenda_bill_numbers: numbers, bills };
      }),
    [agendaBillsByEventId, legEventsWithCommittees, sessionBillsByNumber],
  );

  // ── Bill-tracking queries for My Bills / Team Bills filters ──
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

  // Auto-select first team when teams load
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

  // Fetch bill numbers for ALL teams (for the "All Teams" filter)
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

  // Normalise bill identifiers for matching ("HB 123" → "HB123")
  const normalizeBillId = useCallback(
    (id) =>
      String(id ?? "")
        .replace(/\s+/g, "")
        .toUpperCase(),
    [],
  );

  // Build a Set of normalised bill numbers for the active filter
  const activeBillSet = useMemo(() => {
    if (billFilter === "my") {
      return new Set(personalTrackedBills.map(normalizeBillId));
    }
    if (billFilter === "team") {
      return new Set(selectedTeamBillNumbers.map(normalizeBillId));
    }
    if (billFilter === "allTeams") {
      return new Set(allTeamsBillNumbers.map(normalizeBillId));
    }
    return null; // "all" — no filtering
  }, [
    billFilter,
    personalTrackedBills,
    selectedTeamBillNumbers,
    allTeamsBillNumbers,
    normalizeBillId,
  ]);

  // ── Merge all events for display ───────────────────────────
  const events = useMemo(() => {
    const merged = [...userEvents];
    if (showLegislative) {
      let filtered =
        chamberFilter === "all"
          ? legEventsWithAgendaBills
          : legEventsWithAgendaBills.filter((ev) => {
              // Prefer the explicit chamber field from legis.ga.gov
              // (1 = House, 2 = Senate). Fall back to the title prefix.
              if (ev.chamber === 1) return chamberFilter === "house";
              if (ev.chamber === 2) return chamberFilter === "senate";
              const t = (ev.title ?? "").toLowerCase();
              return chamberFilter === "senate"
                ? t.includes("(senate)") || t.startsWith("senate")
                : t.includes("(house)") || t.startsWith("house");
            });
      // Apply bill-tracking filter (My Bills / Team Bills)
      if (activeBillSet) {
        filtered = filtered.filter((ev) => {
          const evBills = ev.bills ?? [];
          if (evBills.length === 0) return false;
          return evBills.some((b) =>
            activeBillSet.has(normalizeBillId(b.identifier)),
          );
        });
      }
      merged.push(...filtered);
    }
    return merged.sort(
      (a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
    );
  }, [
    userEvents,
    legEventsWithAgendaBills,
    showLegislative,
    chamberFilter,
    activeBillSet,
    normalizeBillId,
  ]);

  const handleRangeExpand = useCallback((before, after) => {
    setMonthRange((prev) => {
      if (prev.before === before && prev.after === after) return prev;
      return { before, after };
    });
  }, []);

  const handleVisibleMonthChange = useCallback((label, date) => {
    setScrollMonthLabel(label);
    if (focusMonthDebounceRef.current) {
      clearTimeout(focusMonthDebounceRef.current);
    }
    focusMonthDebounceRef.current = setTimeout(() => {
      setFocusedMonthDate(startOfMonth(date));
      focusMonthDebounceRef.current = null;
    }, 120);
  }, []);

  // ── Mutations ───────────────────────────────────────────────
  /** @type {import("@tanstack/react-query").UseMutationResult} */
  const createMut = useMutation({
    mutationFn: (/** @type {any} */ ev) =>
      api.calendarEvents.create(ev, selectedSessionId, state),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendarEvents"] });
      toast({ title: "Event created" });
      closeModal();
    },
    onError: (err) =>
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      }),
  });

  /** @type {import("@tanstack/react-query").UseMutationResult} */
  const updateMut = useMutation({
    mutationFn: (/** @type {{id: string, patch: any}} */ { id, patch }) =>
      api.calendarEvents.update(id, patch, selectedSessionId, state),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendarEvents"] });
      toast({ title: "Event updated" });
      closeModal();
    },
    onError: (err) =>
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      }),
  });

  /** @type {import("@tanstack/react-query").UseMutationResult} */
  const deleteMut = useMutation({
    mutationFn: (/** @type {string} */ id) =>
      api.calendarEvents.delete(id, selectedSessionId, state),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendarEvents"] });
      toast({ title: "Event deleted" });
      setDeleteConfirmId(null);
      closeModal();
    },
    onError: (err) =>
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      }),
  });

  // ── Modal helpers ───────────────────────────────────────────
  const closeModal = useCallback(() => {
    setModalOpen(false);
    setEditingEvent(null);
    setFormData(makeDefaultEvent());
  }, []);

  const openNewEvent = useCallback((date) => {
    setEditingEvent(null);
    setFormData(makeDefaultEvent(date));
    setModalOpen(true);
  }, []);

  const openEditEvent = useCallback((ev) => {
    // Legislative events are read-only — show detail modal instead
    if (ev._source === "legis-ga" || ev._source === "openstates") {
      setLegEventDetail(ev);
      return;
    }
    setEditingEvent(ev);
    setFormData({
      title: ev.title,
      description: ev.description ?? "",
      start_time: format(parseISO(ev.start_time), "yyyy-MM-dd'T'HH:mm"),
      end_time: format(parseISO(ev.end_time), "yyyy-MM-dd'T'HH:mm"),
      all_day: ev.all_day ?? false,
      color: ev.color ?? "blue",
      location: ev.location ?? "",
    });
    setModalOpen(true);
  }, []);

  const handleSave = useCallback(() => {
    if (!formData.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    const payload = {
      title: formData.title.trim(),
      description: formData.description.trim() || null,
      start_time: new Date(formData.start_time).toISOString(),
      end_time: new Date(formData.end_time).toISOString(),
      all_day: formData.all_day,
      color: formData.color,
      location: formData.location.trim() || null,
    };
    if (editingEvent) {
      updateMut.mutate({ id: editingEvent.id, patch: payload });
    } else {
      createMut.mutate(payload);
    }
  }, [formData, editingEvent, createMut, updateMut, toast]);

  // ── Navigation ──────────────────────────────────────────────
  const goNext = useCallback(() => {
    if (view === "month") {
      setCurrentDate((d) => {
        const next = addMonths(d, 1);
        setScrollMonthLabel(format(next, "MMMM yyyy"));
        return next;
      });
    } else if (view === "week") setCurrentDate((d) => addWeeks(d, 1));
    else setCurrentDate((d) => addDays(d, 1));
  }, [view]);
  const goPrev = useCallback(() => {
    if (view === "month") {
      setCurrentDate((d) => {
        const prev = subMonths(d, 1);
        setScrollMonthLabel(format(prev, "MMMM yyyy"));
        return prev;
      });
    } else if (view === "week") setCurrentDate((d) => subWeeks(d, 1));
    else setCurrentDate((d) => subDays(d, 1));
  }, [view]);
  const goToday = () => {
    const today = new Date();
    setCurrentDate(today);
    if (view === "month") setScrollMonthLabel(format(today, "MMMM yyyy"));
  };

  // ── Title text ──────────────────────────────────────────────
  const headerTitle = useMemo(() => {
    if (view === "month") return scrollMonthLabel;
    if (view === "week") {
      const ws = startOfWeek(currentDate, { weekStartsOn: 0 });
      const we = endOfWeek(currentDate, { weekStartsOn: 0 });
      return `${format(ws, "MMM d")} – ${format(we, "MMM d, yyyy")}`;
    }
    return format(currentDate, "EEEE, MMMM d, yyyy");
  }, [currentDate, view, scrollMonthLabel]);

  // ═══════════════════════════════════════════════════════════════
  return (
    <div className="h-full relative">
      <div
        ref={pageScrollRef}
        className={`h-full flex flex-col ${view === "month" ? "overflow-y-auto" : "bg-white"}`}
        style={view === "month" ? { overflowAnchor: "none" } : undefined}
      >
        {/* ── Header ────────────────────────────────────────────── */}
        <div
          ref={stickyHeaderRef}
          className={view === "month" ? "sticky top-0 z-30" : ""}
        >
          <div
            className={`border-b border-slate-200/50 px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-3 ${view === "month" ? "bg-white/60 backdrop-blur-xl backdrop-saturate-150 shadow-[0_1px_3px_rgba(0,0,0,0.08)]" : "bg-white"}`}
          >
            <div className="flex items-center gap-2">
              <CalendarDays className="w-6 h-6 text-blue-600" />
              <h1 className="text-xl font-bold text-slate-900">Calendar</h1>
              <Button
                size="sm"
                variant={showLegislative ? "default" : "outline"}
                onClick={() => setShowLegislative((v) => !v)}
                className={
                  showLegislative
                    ? "bg-amber-600 hover:bg-amber-700 ml-1"
                    : "ml-1"
                }
                title={
                  showLegislative
                    ? "Hide GA legislature events"
                    : "Show GA legislature events"
                }
              >
                <Landmark className="w-4 h-4 mr-1" />
                {showLegislative ? (
                  <Eye className="w-3.5 h-3.5" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5" />
                )}
              </Button>
            </div>

            <div className="flex items-center gap-2 sm:ml-auto">
              {view !== "month" && (
                <>
                  <Button variant="outline" size="sm" onClick={goPrev}>
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                </>
              )}
              <Button variant="outline" size="sm" onClick={goToday}>
                Today
              </Button>
              {view !== "month" && (
                <>
                  <Button variant="outline" size="sm" onClick={goNext}>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </>
              )}
              <span className="text-sm font-semibold text-slate-700 min-w-[160px] text-center hidden sm:inline">
                {headerTitle}
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center border rounded-md overflow-hidden">
                {["month", "week", "day"].map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={`w-16 py-1.5 text-xs font-medium capitalize transition-colors text-center ${
                      view === v
                        ? "bg-slate-900 text-white"
                        : "bg-white text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
              {showLegislative && (
                <div className="flex items-center border rounded-md overflow-hidden">
                  {["all", "senate", "house"].map((ch) => (
                    <button
                      key={ch}
                      onClick={() => setChamberFilter(ch)}
                      className={`px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                        chamberFilter === ch
                          ? ch === "senate"
                            ? "bg-blue-600 text-white"
                            : ch === "house"
                              ? "bg-green-600 text-white"
                              : "bg-amber-600 text-white"
                          : "bg-white text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      {ch}
                    </button>
                  ))}
                </div>
              )}
              {showLegislative && (
                <div className="flex items-center gap-1.5">
                  <div className="flex items-center border rounded-md overflow-hidden">
                    {/* All Meetings */}
                    <button
                      onClick={() => setBillFilter("all")}
                      className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                        billFilter === "all"
                          ? "bg-slate-800 text-white"
                          : "bg-white text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      All Meetings
                    </button>
                    {/* My Bills */}
                    <button
                      onClick={() => setBillFilter("my")}
                      className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                        billFilter === "my"
                          ? "bg-yellow-500 text-white"
                          : "bg-white text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      <Star className="w-3 h-3 inline mr-0.5 -mt-0.5" />
                      My Bills
                    </button>
                    {/* Team Bills – split button: left half activates filter, right half opens team picker */}
                    <div className="flex">
                      <button
                        onClick={() => setBillFilter("allTeams")}
                        className={`px-2.5 py-1 text-xs font-medium transition-colors border-r ${
                          billFilter === "team" || billFilter === "allTeams"
                            ? "bg-indigo-600 text-white border-indigo-400"
                            : "bg-white text-slate-600 hover:bg-slate-100 border-slate-200"
                        }`}
                      >
                        <Users className="w-3 h-3 inline mr-0.5 -mt-0.5" />
                        {billFilter === "allTeams"
                          ? "All Teams"
                          : billFilter === "team" && selectedTeamId
                            ? (allTeams.find((t) => t.id === selectedTeamId)
                                ?.name ?? "Team Bills")
                            : "Team Bills"}
                      </button>
                      {allTeams.length > 0 && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              className={`px-1.5 py-1 text-xs font-medium transition-colors ${
                                billFilter === "team" ||
                                billFilter === "allTeams"
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
                                  billFilter === "allTeams"
                                    ? "font-semibold"
                                    : ""
                                }`}
                                onClick={() => {
                                  setBillFilter("allTeams");
                                }}
                              >
                                All Teams
                              </DropdownMenuItem>
                            )}
                            {allTeams.map((t) => (
                              <DropdownMenuItem
                                key={t.id}
                                className={`text-xs cursor-pointer ${
                                  billFilter === "team" &&
                                  selectedTeamId === t.id
                                    ? "font-semibold"
                                    : ""
                                }`}
                                onClick={() => {
                                  setSelectedTeamId(t.id);
                                  setBillFilter("team");
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
                </div>
              )}
              <Button
                size="sm"
                onClick={() => openNewEvent(new Date())}
                className="ml-1"
              >
                <Plus className="w-4 h-4 mr-1" /> Event
              </Button>
            </div>
          </div>

          {/* Day-of-week row – part of the sticky header block in month view */}
          {view === "month" && (
            <div className="grid grid-cols-7 border-b border-slate-200/60 bg-white/55 backdrop-blur-2xl backdrop-saturate-200">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div
                  key={d}
                  className="py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide"
                >
                  {d}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Mobile title */}
        <div className="sm:hidden px-4 py-2 text-center text-sm font-semibold text-slate-700 border-b border-slate-100">
          {headerTitle}
        </div>

        {showLegislative && providerSessionError && (
          <div className="mx-4 mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:mx-6">
            Committee meetings are unavailable for this session because the
            official Georgia Legislature session could not be matched safely. {providerSessionError.message}
          </div>
        )}

        {showLegislative && (boundaryError || focusedMeetingsError) && (
          <div className="mx-4 mt-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-950 sm:mx-6">
            Committee meetings could not be loaded from the official Georgia
            Legislature calendar. {boundaryError?.message || focusedMeetingsError?.message}
          </div>
        )}

        {showLegislative &&
          sessionBoundariesReady &&
          providerSessionMapping?.isSpecialSession &&
          !selectedSpecialWindow && (
            <div className="mx-4 mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:mx-6">
              No verified LD1 floor-calendar boundary was found for this
              special session, so meetings are hidden to prevent regular-session
              events from being mixed in.
            </div>
          )}

        {/* ── View body ─────────────────────────────────────────── */}
        <div
          className={
            view === "month"
              ? "min-h-0 relative"
              : "flex-1 overflow-auto min-h-0 relative"
          }
        >
          {isInitialLoad && view !== "month" ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-8 h-8 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin" />
            </div>
          ) : view === "month" ? (
            <>
              <MonthView
                key={`${state}:${selectedSessionId}`}
                currentDate={currentDate}
                events={events}
                onVisibleMonthChange={handleVisibleMonthChange}
                scrollContainerRef={pageScrollRef}
                stickyHeaderRef={stickyHeaderRef}
                onDayClick={(d) => {
                  setCurrentDate(d);
                  setView("day");
                }}
                onNewEvent={openNewEvent}
                onEditEvent={openEditEvent}
                onRangeExpand={handleRangeExpand}
              />
            </>
          ) : view === "week" ? (
            <WeekView
              currentDate={currentDate}
              events={events}
              onNewEvent={openNewEvent}
              onEditEvent={openEditEvent}
            />
          ) : (
            <DayView
              currentDate={currentDate}
              events={events}
              onNewEvent={openNewEvent}
              onEditEvent={openEditEvent}
            />
          )}
        </div>

        {/* ── Event Modal ───────────────────────────────────────── */}
        <Dialog
          open={modalOpen}
          onOpenChange={(o) => (!o ? closeModal() : null)}
        >
          <DialogContent className="sm:max-w-[480px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingEvent ? "Edit Event" : "New Event"}
              </DialogTitle>
              <DialogDescription>
                {editingEvent
                  ? "Update event details below."
                  : "Fill in the details to create a new event."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {/* Title */}
              <div className="space-y-2">
                <Label htmlFor="ev-title">Title</Label>
                <Input
                  id="ev-title"
                  placeholder="Event title"
                  value={formData.title}
                  onChange={(e) =>
                    setFormData((f) => ({ ...f, title: e.target.value }))
                  }
                  autoFocus
                />
              </div>

              {/* All-day toggle */}
              <div className="flex items-center gap-3">
                <Switch
                  checked={formData.all_day}
                  onCheckedChange={(v) =>
                    setFormData((f) => ({ ...f, all_day: v }))
                  }
                />
                <Label className="mb-0">All-day event</Label>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Start</Label>
                  <Input
                    type={formData.all_day ? "date" : "datetime-local"}
                    value={
                      formData.all_day
                        ? formData.start_time.slice(0, 10)
                        : formData.start_time
                    }
                    onChange={(e) =>
                      setFormData((f) => ({
                        ...f,
                        start_time: formData.all_day
                          ? e.target.value + "T00:00"
                          : e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>End</Label>
                  <Input
                    type={formData.all_day ? "date" : "datetime-local"}
                    value={
                      formData.all_day
                        ? formData.end_time.slice(0, 10)
                        : formData.end_time
                    }
                    onChange={(e) =>
                      setFormData((f) => ({
                        ...f,
                        end_time: formData.all_day
                          ? e.target.value + "T23:59"
                          : e.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              {/* Location */}
              <div className="space-y-2">
                <Label>Location</Label>
                <Input
                  placeholder="Add location"
                  value={formData.location}
                  onChange={(e) =>
                    setFormData((f) => ({ ...f, location: e.target.value }))
                  }
                />
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  placeholder="Add description"
                  rows={3}
                  value={formData.description}
                  onChange={(e) =>
                    setFormData((f) => ({ ...f, description: e.target.value }))
                  }
                />
              </div>

              {/* Color */}
              <div className="space-y-2">
                <Label>Color</Label>
                <div className="flex gap-2 flex-wrap">
                  {EVENT_COLORS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      className={`w-7 h-7 rounded-full ${c.bg} transition-all ${
                        formData.color === c.value
                          ? "ring-2 ring-offset-2 ring-slate-900 scale-110"
                          : "opacity-60 hover:opacity-100"
                      }`}
                      onClick={() =>
                        setFormData((f) => ({ ...f, color: c.value }))
                      }
                      title={c.label}
                    />
                  ))}
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2">
              {editingEvent && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setDeleteConfirmId(editingEvent.id)}
                  disabled={deleteMut.isPending}
                >
                  <Trash2 className="w-4 h-4 mr-1" /> Delete
                </Button>
              )}
              <div className="flex-1" />
              <Button variant="outline" size="sm" onClick={closeModal}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={createMut.isPending || updateMut.isPending}
              >
                {editingEvent ? "Save Changes" : "Create Event"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Delete Confirmation ───────────────────────────────── */}
        <Dialog
          open={!!deleteConfirmId}
          onOpenChange={(o) => !o && setDeleteConfirmId(null)}
        >
          <DialogContent className="sm:max-w-[360px]">
            <DialogHeader>
              <DialogTitle>Delete Event</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this event? This cannot be
                undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeleteConfirmId(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => deleteMut.mutate(deleteConfirmId)}
                disabled={deleteMut.isPending}
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Legislative Event Detail (read-only) ────────────── */}
        <LegislativeEventModal
          event={legEventDetail}
          providerSessionId={providerSessionId}
          sessionBills={sessionBills}
          onClose={() => setLegEventDetail(null)}
        />
      </div>

      {/* Bottom frosted blur overlay – positioned over the scroll container */}
      {view === "month" && (
        <div
          className="absolute bottom-0 left-0 right-0 z-20 pointer-events-none"
          style={{
            height: "70px",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            WebkitMaskImage:
              "linear-gradient(to bottom, transparent 0%, black 100%)",
            maskImage: "linear-gradient(to bottom, transparent 0%, black 100%)",
          }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Overlap-layout helper: assigns column index + total columns to
// concurrent events so they render side-by-side like Google Calendar.
// ═══════════════════════════════════════════════════════════════
function layoutOverlappingEvents(events) {
  if (!events.length) return [];

  // Sort by start time, then by duration descending
  const sorted = [...events]
    .map((ev) => {
      const start = parseISO(ev.start_time).getTime();
      const end = parseISO(ev.end_time).getTime();
      return { ev, start, end: Math.max(end, start + 1) };
    })
    .sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));

  // Assign columns using a greedy left-to-right approach
  const columns = []; // each column stores the end-time of its last event
  const placed = sorted.map(({ ev, start, end }) => {
    let col = columns.findIndex((colEnd) => colEnd <= start);
    if (col === -1) {
      col = columns.length;
      columns.push(end);
    } else {
      columns[col] = end;
    }
    return { ev, col };
  });

  const totalCols = columns.length;
  return placed.map(({ ev, col }) => ({ ev, col, totalCols }));
}

// ═══════════════════════════════════════════════════════════════
// Month View — continuous vertical scroll with fixed row geometry.
// Scrolling updates the header/fetch target without replacing the sheet.
// ═══════════════════════════════════════════════════════════════
function MonthView({
  currentDate,
  events,
  onVisibleMonthChange,
  scrollContainerRef,
  stickyHeaderRef,
  onDayClick,
  onNewEvent,
  onEditEvent,
  onRangeExpand,
}) {
  const INITIAL_BEFORE = 12;
  const INITIAL_AFTER = 12;
  const LOAD_MORE = 18; // add 18 months each time we hit an edge
  const EDGE_PX = 2400; // start expanding well before the user reaches the edge
  const MAX_MONTHS = 240; // cap at ±20 years to prevent memory bloat

  const [beforeCount, setBeforeCount] = useState(INITIAL_BEFORE);
  const [afterCount, setAfterCount] = useState(INITIAL_AFTER);

  // months array depends on currentDate + range extents
  const months = useMemo(() => {
    const arr = [];
    for (let i = -beforeCount; i <= afterCount; i++) {
      arr.push(addMonths(currentDate, i));
    }
    return arr;
  }, [currentDate, beforeCount, afterCount]);

  // Index events by day key for O(1) lookup
  const eventsByDay = useMemo(() => {
    const map = {};
    events.forEach((ev) => {
      const key = format(parseISO(ev.start_time), "yyyy-MM-dd");
      if (!map[key]) map[key] = [];
      map[key].push(ev);
    });
    return map;
  }, [events]);

  const scrollRef = scrollContainerRef;
  const monthRefs = useRef({});
  const hasScrolledToCenter = useRef(false);
  const prevCurrentDate = useRef(currentDate);
  // Guard so we ignore the programmatic scroll caused by Today/arrow nav.
  const suppressEdgeUntilRef = useRef(0);

  // Scroll the *current* month into view on mount and when currentDate changes
  useEffect(() => {
    const curMonthKey = format(currentDate, "yyyy-MM");
    const dateChanged = prevCurrentDate.current !== currentDate;
    const needsScroll = !hasScrolledToCenter.current || dateChanged;

    if (needsScroll) {
      const el = monthRefs.current[curMonthKey];
      const container = scrollRef.current;
      if (el && container) {
        // Account for the sticky header height so the month isn't hidden behind it
        const headerHeight = stickyHeaderRef?.current?.offsetHeight || 0;
        const containerRect = container.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const scrollTop =
          container.scrollTop + (elRect.top - containerRect.top) - headerHeight;
        // Suppress edge-loading for ~700ms while smooth-scroll animates,
        // otherwise the animation can trip the top/bottom edge thresholds
        // and snap the user back.
        suppressEdgeUntilRef.current = performance.now() + 700;
        container.scrollTo({
          top: Math.max(0, scrollTop),
          behavior: dateChanged ? "smooth" : "instant",
        });
        hasScrolledToCenter.current = true;
      }
      prevCurrentDate.current = currentDate;
    }
  }, [currentDate]); // only scroll when the user actively navigates (Today/arrows)

  // ── Stable visible-month tracking ───────────────────────────────
  // A binary search over month offsets runs at most once per animation frame.
  const visibleMonthKeyRef = useRef(format(currentDate, "yyyy-MM"));
  const visibleMonthFrameRef = useRef(null);

  const updateVisibleMonth = useCallback(() => {
    const container = scrollRef.current;
    if (!container || months.length === 0) return;
    const headerHeight = stickyHeaderRef?.current?.offsetHeight || 0;
    const activationY =
      container.getBoundingClientRect().top + headerHeight + 2;

    let low = 0;
    let high = months.length - 1;
    let activeIndex = 0;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const key = format(months[middle], "yyyy-MM");
      const element = monthRefs.current[key];
      if (!element || element.getBoundingClientRect().top > activationY) {
        high = middle - 1;
      } else {
        activeIndex = middle;
        low = middle + 1;
      }
    }

    const activeDate = months[activeIndex];
    const activeKey = format(activeDate, "yyyy-MM");
    if (activeKey === visibleMonthKeyRef.current) return;
    visibleMonthKeyRef.current = activeKey;
    onVisibleMonthChange(format(activeDate, "MMMM yyyy"), activeDate);
  }, [months, onVisibleMonthChange, scrollRef, stickyHeaderRef]);

  const scheduleVisibleMonthUpdate = useCallback(() => {
    if (visibleMonthFrameRef.current != null) return;
    visibleMonthFrameRef.current = requestAnimationFrame(() => {
      visibleMonthFrameRef.current = null;
      updateVisibleMonth();
    });
  }, [updateVisibleMonth]);

  useEffect(() => {
    scheduleVisibleMonthUpdate();
    return () => {
      if (visibleMonthFrameRef.current != null) {
        cancelAnimationFrame(visibleMonthFrameRef.current);
        visibleMonthFrameRef.current = null;
      }
    };
  }, [months, scheduleVisibleMonthUpdate]);

  // ── Edge-triggered range expansion ─────────────────────────────
  // Uses `flushSync` so the scrollTop correction (after prepending months)
  // happens in the *same* task as the React commit. This eliminates the
  // momentum-scroll "jump back" that occurs when the correction is deferred
  // to a post-paint useLayoutEffect.
  const expandingRef = useRef(false);

  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    scheduleVisibleMonthUpdate();
    if (expandingRef.current) return;
    if (performance.now() < suppressEdgeUntilRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = container;

    // ── Append below ─────────────────────────────────────────────
    if (
      scrollHeight - scrollTop - clientHeight < EDGE_PX &&
      afterCount < MAX_MONTHS
    ) {
      expandingRef.current = true;
      setAfterCount((c) => Math.min(c + LOAD_MORE, MAX_MONTHS));
      // Append doesn't shift visible content; release guard next frame.
      requestAnimationFrame(() => {
        expandingRef.current = false;
      });
      return;
    }

    // ── Prepend above (must preserve visual position) ────────────
    if (scrollTop < EDGE_PX && beforeCount < MAX_MONTHS) {
      expandingRef.current = true;
      const prevHeight = scrollHeight;
      const prevScrollTop = scrollTop;
      // flushSync commits the new months synchronously so we can read
      // the new scrollHeight and correct scrollTop *before* the browser
      // paints the next frame — no flicker, no momentum jump.
      flushSync(() => {
        setBeforeCount((c) => Math.min(c + LOAD_MORE, MAX_MONTHS));
      });
      const newHeight = container.scrollHeight;
      container.scrollTop = prevScrollTop + (newHeight - prevHeight);
      // Release on next frame so we don't immediately re-trigger.
      requestAnimationFrame(() => {
        expandingRef.current = false;
      });
    }
  }, [
    afterCount,
    beforeCount,
    scheduleVisibleMonthUpdate,
    scrollRef,
  ]);

  // Attach scroll listener to the shared scroll container (passive for perf)
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [handleScroll, scrollRef]);

  // Notify parent when range expands so it can widen its data query
  useEffect(() => {
    if (onRangeExpand) {
      onRangeExpand(beforeCount, afterCount);
    }
  }, [beforeCount, afterCount, onRangeExpand]);

  return (
    <div style={{ overflowAnchor: "none" }}>
      {months.map((monthDate) => {
        const mKey = format(monthDate, "yyyy-MM");
        const mStart = startOfMonth(monthDate);
        const mEnd = endOfMonth(monthDate);
        const calStart = startOfWeek(mStart, { weekStartsOn: 0 });
        const calEnd = endOfWeek(mEnd, { weekStartsOn: 0 });
        const days = eachDayOfInterval({ start: calStart, end: calEnd });

        return (
          <div
            key={mKey}
            ref={(el) => (monthRefs.current[mKey] = el)}
            data-month-key={mKey}
            className="calendar-month-block"
          >
            {/* Month label */}
            <div className="h-9 bg-white/95 backdrop-blur-sm border-b border-slate-100 px-3 shrink-0 flex items-center">
              <span className="text-sm font-bold text-slate-700">
                {format(monthDate, "MMMM yyyy")}
              </span>
            </div>

            {/* Day grid */}
            <div className="grid grid-cols-7">
              {days.map((day) => {
                const key = format(day, "yyyy-MM-dd");
                const inMonth = isSameMonth(day, monthDate);

                // Hide filler days from adjacent months
                if (!inMonth) {
                  return (
                    <div
                      key={key}
                      className="h-[88px] sm:h-[96px] border-b border-r border-slate-100 overflow-hidden"
                    />
                  );
                }

                const dayEvents = eventsByDay[key] ?? [];
                const today = isToday(day);
                return (
                  <div
                    key={key}
                    className="h-[88px] sm:h-[96px] border-b border-r border-slate-100 p-1 overflow-hidden cursor-pointer transition-colors hover:bg-slate-50"
                    onClick={() => onDayClick(day)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      onNewEvent(day);
                    }}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span
                        className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full ${
                          today ? "bg-blue-600 text-white" : "text-slate-700"
                        }`}
                      >
                        {format(day, "d")}
                      </span>
                      {dayEvents.length > 0 && (
                        <span className="text-[10px] text-slate-400">
                          {dayEvents.length}
                        </span>
                      )}
                    </div>
                    <div className="space-y-0.5 overflow-hidden">
                      {dayEvents.slice(0, 3).map((ev) => {
                        const cc = getColorClasses(ev.color);
                        const isLeg =
                          ev._source === "legis-ga" ||
                          ev._source === "openstates";
                        return (
                          <button
                            key={ev.id}
                            className={`w-full text-left text-[11px] leading-tight px-1.5 py-0.5 rounded truncate border ${cc.light} hover:brightness-95 transition-all flex items-center gap-0.5`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onEditEvent(ev);
                            }}
                          >
                            {isLeg && <Landmark className="w-3 h-3 shrink-0" />}
                            {!ev.all_day && !isLeg && (
                              <span className="font-medium mr-1">
                                {format(parseISO(ev.start_time), "h:mm")}
                              </span>
                            )}
                            {ev.is_special_session && (
                              <span className="shrink-0 rounded bg-violet-200 px-1 text-[9px] font-semibold text-violet-900">
                                Special Session
                              </span>
                            )}
                            <span className="truncate">{ev.title}</span>
                          </button>
                        );
                      })}
                      {dayEvents.length > 3 && (
                        <span className="text-[10px] text-slate-500 pl-1">
                          +{dayEvents.length - 3} more
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Week View
// ═══════════════════════════════════════════════════════════════
function WeekView({ currentDate, events, onNewEvent, onEditEvent }) {
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
  const weekDays = eachDayOfInterval({
    start: weekStart,
    end: endOfWeek(currentDate, { weekStartsOn: 0 }),
  });

  return (
    <div className="h-full flex flex-col">
      {/* Day headers */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-slate-200 sticky top-0 bg-white z-10">
        <div className="border-r border-slate-100" />
        {weekDays.map((d) => (
          <div
            key={d.toISOString()}
            className="py-2 text-center border-r border-slate-100"
          >
            <div className="text-[10px] font-semibold text-slate-500 uppercase">
              {format(d, "EEE")}
            </div>
            <div
              className={`text-sm font-bold mt-0.5 w-7 h-7 mx-auto flex items-center justify-center rounded-full ${
                isToday(d) ? "bg-blue-600 text-white" : "text-slate-700"
              }`}
            >
              {format(d, "d")}
            </div>
          </div>
        ))}
      </div>
      {/* Hour grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-[60px_repeat(7,1fr)] relative">
          {HOURS.map((hour) => (
            <div key={hour} className="contents">
              <div className="h-14 border-b border-r border-slate-100 pr-2 pt-0.5 text-right">
                <span className="text-[10px] text-slate-400">
                  {format(setHours(new Date(), hour), "h a")}
                </span>
              </div>
              {weekDays.map((day) => {
                const dayKey = format(day, "yyyy-MM-dd");
                const hourEvents = events.filter((ev) => {
                  const evStart = parseISO(ev.start_time);
                  return isSameDay(evStart, day) && evStart.getHours() === hour;
                });
                // Get layout for ALL timed events on this day so columns
                // are consistent across hours.
                const dayTimedEvents = events.filter(
                  (ev) =>
                    !ev.all_day && isSameDay(parseISO(ev.start_time), day),
                );
                const layout = layoutOverlappingEvents(dayTimedEvents);
                const hourLayout = layout.filter(({ ev }) =>
                  hourEvents.some((h) => h.id === ev.id),
                );
                return (
                  <div
                    key={`${dayKey}-${hour}`}
                    className="h-14 border-b border-r border-slate-100 relative cursor-pointer hover:bg-blue-50/30 transition-colors"
                    onClick={() => onNewEvent(setHours(day, hour))}
                  >
                    {hourLayout.map(({ ev, col, totalCols }) => {
                      const cc = getColorClasses(ev.color);
                      const mins = differenceInMinutes(
                        parseISO(ev.end_time),
                        parseISO(ev.start_time),
                      );
                      const heightPx = Math.max(20, (mins / 60) * 56);
                      const topOffset =
                        parseISO(ev.start_time).getMinutes() * (56 / 60);
                      const widthPct = 100 / totalCols;
                      const leftPct = col * widthPct;
                      return (
                        <button
                          key={ev.id}
                          className={`absolute rounded px-1 text-[11px] leading-tight overflow-hidden border ${cc.light} hover:brightness-95 hover:shadow-sm z-10`}
                          style={{
                            top: `${topOffset}px`,
                            height: `${heightPx}px`,
                            left: `calc(${leftPct}% + 1px)`,
                            width: `calc(${widthPct}% - 2px)`,
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditEvent(ev);
                          }}
                        >
                          <span className="font-semibold truncate block flex items-center gap-0.5">
                            {(ev._source === "legis-ga" ||
                              ev._source === "openstates") && (
                              <Landmark className="w-3 h-3 shrink-0" />
                            )}
                            {ev.is_special_session && (
                              <span className="rounded bg-violet-200 px-1 text-[9px] text-violet-900">
                                Special Session
                              </span>
                            )}
                            {ev.title}
                          </span>
                          {mins >= 60 && totalCols <= 2 && (
                            <span className="text-[10px] opacity-70">
                              {format(parseISO(ev.start_time), "h:mm")}–
                              {format(parseISO(ev.end_time), "h:mm a")}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Day View
// ═══════════════════════════════════════════════════════════════
function DayView({ currentDate, events, onNewEvent, onEditEvent }) {
  const dayEvents = useMemo(
    () =>
      events.filter((ev) => isSameDay(parseISO(ev.start_time), currentDate)),
    [events, currentDate],
  );
  const allDayEvents = dayEvents.filter((ev) => ev.all_day);
  const timedEvents = dayEvents.filter((ev) => !ev.all_day);

  // Compute overlap layout once for all timed events in the day
  const dayLayout = useMemo(
    () => layoutOverlappingEvents(timedEvents),
    [timedEvents],
  );

  return (
    <div className="h-full flex flex-col">
      {/* All-day section */}
      {allDayEvents.length > 0 && (
        <div className="border-b border-slate-200 px-4 py-2">
          <span className="text-[10px] font-semibold text-slate-500 uppercase mr-2">
            All Day
          </span>
          <div className="flex flex-wrap gap-1 mt-1">
            {allDayEvents.map((ev) => {
              const cc = getColorClasses(ev.color);
              const isLeg =
                ev._source === "legis-ga" || ev._source === "openstates";
              return (
                <button
                  key={ev.id}
                  className={`text-xs px-2 py-1 rounded border ${cc.light} hover:brightness-95 flex items-center gap-1`}
                  onClick={() => onEditEvent(ev)}
                >
                  {isLeg && <Landmark className="w-3 h-3 shrink-0" />}
                  {ev.is_special_session && (
                    <span className="rounded bg-violet-200 px-1 text-[9px] font-semibold text-violet-900">
                      Special Session
                    </span>
                  )}
                  {ev.title}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {/* Hour grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-[60px_1fr]">
          {HOURS.map((hour) => {
            const hourEvents = timedEvents.filter(
              (ev) => parseISO(ev.start_time).getHours() === hour,
            );
            return (
              <div key={hour} className="contents">
                <div className="h-16 border-b border-r border-slate-100 pr-2 pt-0.5 text-right">
                  <span className="text-xs text-slate-400">
                    {format(setHours(new Date(), hour), "h a")}
                  </span>
                </div>
                <div
                  className="h-16 border-b border-slate-100 relative cursor-pointer hover:bg-blue-50/30 transition-colors"
                  onClick={() => onNewEvent(setHours(currentDate, hour))}
                >
                  {dayLayout
                    .filter(({ ev }) => hourEvents.some((h) => h.id === ev.id))
                    .map(({ ev, col, totalCols }) => {
                      const cc = getColorClasses(ev.color);
                      const mins = differenceInMinutes(
                        parseISO(ev.end_time),
                        parseISO(ev.start_time),
                      );
                      const heightPx = Math.max(24, (mins / 60) * 64);
                      const topOffset =
                        parseISO(ev.start_time).getMinutes() * (64 / 60);
                      const widthPct = 100 / totalCols;
                      const leftPct = col * widthPct;
                      return (
                        <button
                          key={ev.id}
                          className={`absolute rounded-lg px-2 py-1 text-xs overflow-hidden border ${cc.light} hover:brightness-95 hover:shadow-sm z-10 text-left`}
                          style={{
                            top: `${topOffset}px`,
                            height: `${heightPx}px`,
                            left: `calc(${leftPct}% + 4px)`,
                            width: `calc(${widthPct}% - 8px)`,
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditEvent(ev);
                          }}
                        >
                          <div className="font-semibold truncate flex items-center gap-1">
                            {(ev._source === "legis-ga" ||
                              ev._source === "openstates") && (
                              <Landmark className="w-3.5 h-3.5 shrink-0" />
                            )}
                            {ev.is_special_session && (
                              <span className="rounded bg-violet-200 px-1 text-[9px] text-violet-900">
                                Special Session
                              </span>
                            )}
                            {ev.title}
                          </div>
                          {totalCols <= 3 && (
                            <div className="flex items-center gap-2 text-[10px] opacity-70 mt-0.5">
                              <span className="flex items-center gap-0.5">
                                <Clock className="w-3 h-3" />
                                {format(
                                  parseISO(ev.start_time),
                                  "h:mm a",
                                )} – {format(parseISO(ev.end_time), "h:mm a")}
                              </span>
                              {ev.location && totalCols <= 2 && (
                                <span className="flex items-center gap-0.5 truncate">
                                  <MapPin className="w-3 h-3 shrink-0" />
                                  <span className="truncate">
                                    {ev.location}
                                  </span>
                                </span>
                              )}
                            </div>
                          )}
                          {mins >= 90 && ev.description && totalCols <= 2 && (
                            <p className="text-[10px] opacity-60 mt-1 line-clamp-2">
                              {ev.description}
                            </p>
                          )}
                        </button>
                      );
                    })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Legislative Event Detail Modal (read-only)
// ═══════════════════════════════════════════════════════════════
function LegislativeEventModal({
  event,
  providerSessionId,
  sessionBills,
  onClose,
}) {
  const agendaBillsQuery = useQuery({
    queryKey: meetingAgendaQueryKey(providerSessionId, event),
    queryFn: () => parseAgendaBills(event.agendaUrl),
    enabled: Boolean(event?.agendaUrl),
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });

  if (!event) return null;

  const agendaBillNumbers =
    agendaBillsQuery.data ?? event.agenda_bill_numbers ?? [];
  const billsByNumber = new Map(
    (sessionBills ?? []).map((bill) => [billKey(bill.bill_number), bill]),
  );
  const billsOnAgenda = agendaBillNumbers.map((number) => {
    const bill = billsByNumber.get(billKey(number));
    return bill
      ? {
          id: bill.id,
          identifier: bill.bill_number,
          title: bill.title,
          status: bill.last_action,
          statusDate: bill.last_action_date,
          openstates_url: bill.url || bill.state_link,
        }
      : {
          id: billKey(number),
          identifier: prettyBill(number),
          title: "Not found in the selected session's bill cache",
        };
  });

  const startFormatted = (() => {
    try {
      return event.all_day
        ? format(parseISO(event.start_time), "MMMM d, yyyy")
        : format(parseISO(event.start_time), "MMMM d, yyyy 'at' h:mm a");
    } catch {
      return event.start_time;
    }
  })();

  const endFormatted = (() => {
    try {
      return event.all_day
        ? format(parseISO(event.end_time), "MMMM d, yyyy")
        : format(parseISO(event.end_time), "h:mm a");
    } catch {
      return event.end_time;
    }
  })();

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[540px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                event.color === "leg-senate"
                  ? "bg-blue-100"
                  : event.color === "leg-house"
                    ? "bg-emerald-100"
                    : "bg-amber-100"
              }`}
            >
              <Landmark
                className={`w-5 h-5 ${
                  event.color === "leg-senate"
                    ? "text-blue-700"
                    : event.color === "leg-house"
                      ? "text-emerald-700"
                      : "text-amber-700"
                }`}
              />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-base">{event.title}</DialogTitle>
              <DialogDescription className="flex items-center gap-2 mt-0.5">
                <Badge
                  variant="outline"
                  className={`text-[10px] uppercase ${
                    event.color === "leg-senate"
                      ? "bg-blue-50 text-blue-800 border-blue-300"
                      : event.color === "leg-house"
                        ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                        : "bg-amber-50 text-amber-800 border-amber-300"
                  }`}
                >
                  {event.classification || "Legislative Event"}
                </Badge>
                {event.is_special_session && (
                  <Badge className="border-violet-300 bg-violet-100 text-[10px] uppercase text-violet-800 hover:bg-violet-100">
                    Special Session
                  </Badge>
                )}
                <span className="text-xs text-slate-500">
                  Georgia General Assembly
                </span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Video / Agenda / Schedule links */}
          {(event.videoUrl || event.agendaUrl || event.scheduleUrl) && (
            <div className="flex items-center gap-2 flex-wrap">
              {event.videoUrl && (
                <a
                  href={event.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition-colors"
                >
                  <Video className="w-3.5 h-3.5" />
                  {event.videoUrl.includes("/search?")
                    ? "Find Video on YouTube"
                    : event.videoUrl.toLowerCase().includes("vimeo")
                      ? "Watch on Vimeo"
                      : event.videoUrl.includes("youtube")
                        ? "Watch on YouTube"
                        : event.videoUrl.includes("livestream.com")
                          ? "Watch on Livestream"
                          : "Watch Video"}
                </a>
              )}
              {event.agendaUrl && (
                <a
                  href={event.agendaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-colors"
                >
                  <FileText className="w-3.5 h-3.5" />
                  Agenda (PDF)
                </a>
              )}
              <a
                href={event.scheduleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                GA Legislature Schedule
              </a>
            </div>
          )}

          {/* Date & Time */}
          <div className="flex items-start gap-3 text-sm">
            <Clock className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-slate-800">{startFormatted}</p>
              {endFormatted && (
                <p className="text-slate-500">to {endFormatted}</p>
              )}
            </div>
          </div>

          {/* Location */}
          {event.location && (
            <div className="flex items-start gap-3 text-sm">
              <MapPin className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-slate-800">{event.location}</p>
                {event.location_url && (
                  <a
                    href={event.location_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline flex items-center gap-1 mt-0.5"
                  >
                    View location <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Description */}
          {event.description && (
            <div className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3">
              {event.description}
            </div>
          )}

          {/* Participants (committees, speakers) */}
          {event.participants?.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> Participants
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {event.participants.map((p, i) => (
                  <Badge
                    key={i}
                    variant="outline"
                    className="text-xs bg-slate-50"
                  >
                    {p.name}
                    {p.role && (
                      <span className="text-slate-400 ml-1">({p.role})</span>
                    )}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Bills from this meeting's exact agenda */}
          {event.classification === "Committee Meeting" && (
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" />
                Bills on Agenda ({billsOnAgenda.length})
              </h4>
              {agendaBillsQuery.isLoading ? (
                <p className="text-sm text-slate-500">
                  Reading the published meeting agenda...
                </p>
              ) : !event.agendaUrl ? (
                <p className="text-sm text-slate-500">
                  No agenda has been published for this meeting.
                </p>
              ) : billsOnAgenda.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No bill numbers were found on this meeting's agenda.
                </p>
              ) : (
                <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                  {billsOnAgenda.map((bill, i) => (
                  <div
                    key={bill.id ?? i}
                    className="flex items-start gap-2 p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
                  >
                    <div className="w-6 h-6 rounded bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
                      <FileText className="w-3.5 h-3.5 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800">
                        {bill.identifier}
                      </p>
                      {(bill.title || bill.note) && (
                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                          {bill.title || bill.note}
                        </p>
                      )}
                      {bill.status && (
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {bill.status}
                          {bill.statusDate ? ` · ${bill.statusDate}` : ""}
                        </p>
                      )}
                    </div>
                    {bill.openstates_url && (
                      <a
                        href={bill.openstates_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 shrink-0"
                        title="View on legis.ga.gov"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Links */}
          {event.links?.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Links
              </h4>
              <div className="space-y-1">
                {event.links.map((link, i) => (
                  <a
                    key={i}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    {link.note || link.url}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
