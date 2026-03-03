import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/apiClient";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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

  // ── Date range for queries ──────────────────────────────────
  const queryRange = useMemo(() => {
    if (view === "month") {
      const ms = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 0 });
      const me = endOfWeek(endOfMonth(currentDate), { weekStartsOn: 0 });
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
  }, [currentDate, view]);

  // ── Fetch events ────────────────────────────────────────────
  const { data: events = [], isLoading } = useQuery({
    queryKey: ["calendarEvents", queryRange.start, queryRange.end],
    queryFn: () => api.calendarEvents.list(queryRange.start, queryRange.end),
  });

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
  const goNext = () => {
    if (view === "month") setCurrentDate((d) => addMonths(d, 1));
    else if (view === "week") setCurrentDate((d) => addWeeks(d, 1));
    else setCurrentDate((d) => addDays(d, 1));
  };
  const goPrev = () => {
    if (view === "month") setCurrentDate((d) => subMonths(d, 1));
    else if (view === "week") setCurrentDate((d) => subWeeks(d, 1));
    else setCurrentDate((d) => subDays(d, 1));
  };
  const goToday = () => setCurrentDate(new Date());

  // ── Title text ──────────────────────────────────────────────
  const headerTitle = useMemo(() => {
    if (view === "month") return format(currentDate, "MMMM yyyy");
    if (view === "week") {
      const ws = startOfWeek(currentDate, { weekStartsOn: 0 });
      const we = endOfWeek(currentDate, { weekStartsOn: 0 });
      return `${format(ws, "MMM d")} – ${format(we, "MMM d, yyyy")}`;
    }
    return format(currentDate, "EEEE, MMMM d, yyyy");
  }, [currentDate, view]);

  // ═══════════════════════════════════════════════════════════════
  return (
    <div className="h-full flex flex-col bg-white">
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="border-b border-slate-200 px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-6 h-6 text-blue-600" />
          <h1 className="text-xl font-bold text-slate-900">Calendar</h1>
        </div>

        <div className="flex items-center gap-2 sm:ml-auto">
          <Button variant="outline" size="sm" onClick={goPrev}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={goToday}>
            Today
          </Button>
          <Button variant="outline" size="sm" onClick={goNext}>
            <ChevronRight className="w-4 h-4" />
          </Button>
          <span className="text-sm font-semibold text-slate-700 min-w-[160px] text-center hidden sm:inline">
            {headerTitle}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {["month", "week", "day"].map((v) => (
            <Button
              key={v}
              size="sm"
              variant={view === v ? "default" : "outline"}
              onClick={() => setView(v)}
              className="capitalize"
            >
              {v}
            </Button>
          ))}
          <Button
            size="sm"
            onClick={() => openNewEvent(new Date())}
            className="ml-2"
          >
            <Plus className="w-4 h-4 mr-1" /> Event
          </Button>
        </div>
      </div>

      {/* Mobile title */}
      <div className="sm:hidden px-4 py-2 text-center text-sm font-semibold text-slate-700 border-b border-slate-100">
        {headerTitle}
      </div>

      {/* ── View body ─────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin" />
          </div>
        ) : view === "month" ? (
          <MonthView
            currentDate={currentDate}
            events={events}
            onDayClick={(d) => {
              setCurrentDate(d);
              setView("day");
            }}
            onNewEvent={openNewEvent}
            onEditEvent={openEditEvent}
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
      <Dialog open={modalOpen} onOpenChange={(o) => (!o ? closeModal() : null)}>
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
              Are you sure you want to delete this event? This cannot be undone.
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
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Month View
// ═══════════════════════════════════════════════════════════════
function MonthView({
  currentDate,
  events,
  onDayClick,
  onNewEvent,
  onEditEvent,
}) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  const eventsByDay = useMemo(() => {
    const map = {};
    events.forEach((ev) => {
      const key = format(parseISO(ev.start_time), "yyyy-MM-dd");
      if (!map[key]) map[key] = [];
      map[key].push(ev);
    });
    return map;
  }, [events]);

  return (
    <div className="h-full flex flex-col">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-slate-200">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div
            key={d}
            className="py-2 text-center text-xs font-semibold text-slate-500 uppercase"
          >
            {d}
          </div>
        ))}
      </div>
      {/* Day grid */}
      <div className="flex-1 grid grid-cols-7 auto-rows-fr">
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const dayEvents = eventsByDay[key] ?? [];
          const inMonth = isSameMonth(day, currentDate);
          const today = isToday(day);
          return (
            <div
              key={key}
              className={`border-b border-r border-slate-100 p-1 min-h-[80px] cursor-pointer transition-colors hover:bg-slate-50 ${
                !inMonth ? "bg-slate-50/50" : ""
              }`}
              onClick={() => onDayClick(day)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onNewEvent(day);
              }}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span
                  className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full ${
                    today
                      ? "bg-blue-600 text-white"
                      : inMonth
                        ? "text-slate-700"
                        : "text-slate-400"
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
                  return (
                    <button
                      key={ev.id}
                      className={`w-full text-left text-[11px] leading-tight px-1.5 py-0.5 rounded truncate border ${cc.light} hover:opacity-80 transition-opacity`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditEvent(ev);
                      }}
                    >
                      {!ev.all_day && (
                        <span className="font-medium mr-1">
                          {format(parseISO(ev.start_time), "h:mm")}
                        </span>
                      )}
                      {ev.title}
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
                return (
                  <div
                    key={`${dayKey}-${hour}`}
                    className="h-14 border-b border-r border-slate-100 relative cursor-pointer hover:bg-blue-50/30 transition-colors"
                    onClick={() => onNewEvent(setHours(day, hour))}
                  >
                    {hourEvents.map((ev) => {
                      const cc = getColorClasses(ev.color);
                      const mins = differenceInMinutes(
                        parseISO(ev.end_time),
                        parseISO(ev.start_time),
                      );
                      const heightPx = Math.max(20, (mins / 60) * 56);
                      const topOffset =
                        parseISO(ev.start_time).getMinutes() * (56 / 60);
                      return (
                        <button
                          key={ev.id}
                          className={`absolute left-0.5 right-0.5 rounded px-1 text-[11px] leading-tight overflow-hidden border ${cc.light} hover:opacity-80 z-10`}
                          style={{
                            top: `${topOffset}px`,
                            height: `${heightPx}px`,
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditEvent(ev);
                          }}
                        >
                          <span className="font-semibold truncate block">
                            {ev.title}
                          </span>
                          {mins >= 60 && (
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
              return (
                <button
                  key={ev.id}
                  className={`text-xs px-2 py-1 rounded border ${cc.light} hover:opacity-80`}
                  onClick={() => onEditEvent(ev)}
                >
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
                  {hourEvents.map((ev) => {
                    const cc = getColorClasses(ev.color);
                    const mins = differenceInMinutes(
                      parseISO(ev.end_time),
                      parseISO(ev.start_time),
                    );
                    const heightPx = Math.max(24, (mins / 60) * 64);
                    const topOffset =
                      parseISO(ev.start_time).getMinutes() * (64 / 60);
                    return (
                      <button
                        key={ev.id}
                        className={`absolute left-1 right-1 rounded-lg px-2 py-1 text-xs overflow-hidden border ${cc.light} hover:opacity-80 z-10 text-left`}
                        style={{
                          top: `${topOffset}px`,
                          height: `${heightPx}px`,
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditEvent(ev);
                        }}
                      >
                        <div className="font-semibold truncate">{ev.title}</div>
                        <div className="flex items-center gap-2 text-[10px] opacity-70 mt-0.5">
                          <span className="flex items-center gap-0.5">
                            <Clock className="w-3 h-3" />
                            {format(parseISO(ev.start_time), "h:mm a")} –{" "}
                            {format(parseISO(ev.end_time), "h:mm a")}
                          </span>
                          {ev.location && (
                            <span className="flex items-center gap-0.5">
                              <MapPin className="w-3 h-3" />
                              {ev.location}
                            </span>
                          )}
                        </div>
                        {mins >= 90 && ev.description && (
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
