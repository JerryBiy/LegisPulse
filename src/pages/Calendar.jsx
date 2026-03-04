import {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
  useLayoutEffect,
} from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/apiClient";
import { fetchGAEvents } from "@/services/openstates";
import { useToast } from "@/components/ui/use-toast";
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
  Plus,
  Clock,
  MapPin,
  Trash2,
  CalendarDays,
  Landmark,
  ExternalLink,
  FileText,
  Users,
  Eye,
  EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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

// ═══════════════════════════════════════════════════════════════
// Main Calendar Page
// ═══════════════════════════════════════════════════════════════
export default function CalendarPage() {
  const queryClient = useQueryClient();
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
  // For month view: the label shown in the header, updated by scroll
  const [scrollMonthLabel, setScrollMonthLabel] = useState(
    format(new Date(), "MMMM yyyy"),
  );
  const pageScrollRef = useRef(null);
  const stickyHeaderRef = useRef(null);
  // Track how many months MonthView is currently showing
  const [monthRange, setMonthRange] = useState({ before: 3, after: 3 });

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

  // Legislative events: fixed ±12-month window (doesn't expand with scroll)
  const legQueryRange = useMemo(() => {
    const ms = startOfMonth(addMonths(new Date(), -12));
    const me = endOfMonth(addMonths(new Date(), 12));
    return { start: ms.toISOString(), end: me.toISOString() };
  }, []);

  // ── Fetch user events ──────────────────────────────────────
  const { data: userEvents = [], isLoading: isLoadingUser } = useQuery({
    queryKey: ["calendarEvents", queryRange.start, queryRange.end],
    queryFn: () => api.calendarEvents.list(queryRange.start, queryRange.end),
    placeholderData: (prev) => prev, // keep previous data while refetching
  });

  // ── Fetch GA legislative events from Open States ────────────
  const { data: legEvents = [], isLoading: isLoadingLeg } = useQuery({
    queryKey: ["legEvents", legQueryRange.start, legQueryRange.end],
    queryFn: () => fetchGAEvents(legQueryRange.start, legQueryRange.end),
    staleTime: 30 * 60 * 1000, // 30 min — legislative events rarely change
    gcTime: 60 * 60 * 1000, // keep in cache 1 hour
    retry: 2,
    retryDelay: (attempt) => Math.min(3000 * 2 ** attempt, 15000),
    placeholderData: (prev) => prev, // keep previous data while refetching
  });

  const isLoading = isLoadingUser || isLoadingLeg;

  // ── Merge events ────────────────────────────────────────────
  const events = useMemo(() => {
    const merged = [...userEvents];
    if (showLegislative) {
      const filtered =
        chamberFilter === "all"
          ? legEvents
          : legEvents.filter((ev) => {
              const t = (ev.title ?? "").toLowerCase();
              return chamberFilter === "senate"
                ? t.startsWith("senate")
                : t.startsWith("house");
            });
      merged.push(...filtered);
    }
    // Sort by start_time
    return merged.sort(
      (a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
    );
  }, [userEvents, legEvents, showLegislative, chamberFilter]);

  const handleRangeExpand = useCallback((before, after) => {
    setMonthRange((prev) => {
      if (prev.before === before && prev.after === after) return prev;
      return { before, after };
    });
  }, []);

  // ── Mutations ───────────────────────────────────────────────
  /** @type {import("@tanstack/react-query").UseMutationResult} */
  const createMut = useMutation({
    mutationFn: (/** @type {any} */ ev) => api.calendarEvents.create(ev),
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
      api.calendarEvents.update(id, patch),
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
    mutationFn: (/** @type {string} */ id) => api.calendarEvents.delete(id),
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
    if (ev._source === "openstates") {
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
            <div className="grid grid-cols-7 border-b border-slate-200/50 bg-white/60 backdrop-blur-xl backdrop-saturate-150">
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

        {/* ── View body ─────────────────────────────────────────── */}
        <div
          className={
            view === "month" ? "min-h-0" : "flex-1 overflow-auto min-h-0"
          }
        >
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-8 h-8 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin" />
            </div>
          ) : view === "month" ? (
            <MonthView
              currentDate={currentDate}
              events={events}
              onVisibleMonthChange={setScrollMonthLabel}
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
// Month View – continuous vertical scroll (Apple Calendar style)
// Each month fills the viewport; scroll-snap gives page-like feel.
// Scroll only updates the header label – no month-array re-render.
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
  const INITIAL_BEFORE = 3;
  const INITIAL_AFTER = 3;
  const LOAD_MORE = 12; // add 12 months each time we hit an edge
  const EDGE_PX = 800; // trigger when within 800px of edge
  const MAX_MONTHS = 120; // cap at ±10 years to prevent memory bloat

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
        container.scrollTo({
          top: Math.max(0, scrollTop),
          behavior: dateChanged ? "smooth" : "instant",
        });
        hasScrolledToCenter.current = true;
      }
      prevCurrentDate.current = currentDate;
    }
  }, [currentDate]); // only scroll when the user actively navigates (Today/arrows)

  // Update header label as user scrolls – lightweight, no cascading re-render
  // Also detect when user is near edges to load more months
  const visibleMonthRef = useRef(format(currentDate, "MMMM yyyy"));
  const pendingScrollFix = useRef(null); // stores previous scrollHeight when prepending

  // Restore scroll position after prepending months (runs synchronously before paint)
  useLayoutEffect(() => {
    if (pendingScrollFix.current !== null) {
      const container = scrollRef.current;
      if (container) {
        const prevHeight = pendingScrollFix.current;
        container.scrollTop += container.scrollHeight - prevHeight;
      }
      pendingScrollFix.current = null;
    }
  }, [beforeCount]);

  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const containerTop = container.getBoundingClientRect().top;
    const containerMid = containerTop + container.clientHeight * 0.35;

    let closestMonth = null;
    let closestDist = Infinity;
    for (const [key, el] of Object.entries(monthRefs.current)) {
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const dist = Math.abs(rect.top + rect.height / 2 - containerMid);
      if (dist < closestDist) {
        closestDist = dist;
        closestMonth = key;
      }
    }

    if (closestMonth) {
      const [year, month] = closestMonth.split("-").map(Number);
      const label = format(new Date(year, month - 1, 1), "MMMM yyyy");
      if (label !== visibleMonthRef.current) {
        visibleMonthRef.current = label;
        onVisibleMonthChange(label);
      }
    }

    // --- Infinite scroll: expand when near edges ---
    const { scrollTop, scrollHeight, clientHeight } = container;
    // Near bottom? Load more future months (capped)
    if (scrollHeight - scrollTop - clientHeight < EDGE_PX) {
      setAfterCount((c) => Math.min(c + LOAD_MORE, MAX_MONTHS));
    }
    // Near top? Load more past months (capped, only if not already pending)
    if (scrollTop < EDGE_PX && pendingScrollFix.current === null) {
      pendingScrollFix.current = scrollHeight;
      setBeforeCount((c) => Math.min(c + LOAD_MORE, MAX_MONTHS));
    }
  }, [onVisibleMonthChange]);

  // Attach scroll listener to the shared scroll container
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [handleScroll, scrollRef]);

  // Notify parent when range expands so it can widen its data query
  useEffect(() => {
    if (onRangeExpand) {
      onRangeExpand(beforeCount, afterCount);
    }
  }, [beforeCount, afterCount, onRangeExpand]);

  return (
    <div>
      {months.map((monthDate) => {
        const mKey = format(monthDate, "yyyy-MM");
        const mStart = startOfMonth(monthDate);
        const mEnd = endOfMonth(monthDate);
        const calStart = startOfWeek(mStart, { weekStartsOn: 0 });
        const calEnd = endOfWeek(mEnd, { weekStartsOn: 0 });
        const days = eachDayOfInterval({ start: calStart, end: calEnd });

        return (
          <div key={mKey} ref={(el) => (monthRefs.current[mKey] = el)}>
            {/* Month label */}
            <div className="bg-white/95 backdrop-blur-sm border-b border-slate-100 px-3 py-1.5 shrink-0">
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
                      className="border-b border-r border-slate-100 min-h-[80px]"
                    />
                  );
                }

                const dayEvents = eventsByDay[key] ?? [];
                const today = isToday(day);
                return (
                  <div
                    key={key}
                    className="border-b border-r border-slate-100 p-1 min-h-[80px] cursor-pointer transition-colors hover:bg-slate-50"
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
                        const isLeg = ev._source === "openstates";
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
                            {ev._source === "openstates" && (
                              <Landmark className="w-3 h-3 shrink-0" />
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
              const isLeg = ev._source === "openstates";
              return (
                <button
                  key={ev.id}
                  className={`text-xs px-2 py-1 rounded border ${cc.light} hover:brightness-95 flex items-center gap-1`}
                  onClick={() => onEditEvent(ev)}
                >
                  {isLeg && <Landmark className="w-3 h-3 shrink-0" />}
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
                            {ev._source === "openstates" && (
                              <Landmark className="w-3.5 h-3.5 shrink-0" />
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
function LegislativeEventModal({ event, onClose }) {
  if (!event) return null;

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
                <span className="text-xs text-slate-500">
                  Georgia General Assembly
                </span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
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

          {/* Associated Bills */}
          {event.bills?.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> Associated Bills (
                {event.bills.length})
              </h4>
              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {event.bills.map((bill, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
                  >
                    <div className="w-6 h-6 rounded bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
                      <FileText className="w-3.5 h-3.5 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800">
                        {bill.identifier}
                      </p>
                      {bill.note && (
                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                          {bill.note}
                        </p>
                      )}
                    </div>
                    {bill.id && (
                      <a
                        href={`https://v3.openstates.org/bills/${encodeURIComponent(bill.id)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 shrink-0"
                        title="View on Open States"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
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
