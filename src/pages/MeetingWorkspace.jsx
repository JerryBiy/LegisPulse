import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CalendarDays,
  Check,
  Clock,
  ExternalLink,
  FilePlus2,
  FileText,
  GripVertical,
  Loader2,
  MapPin,
  NotebookPen,
  RefreshCcw,
  Search,
  Shield,
  Trash2,
  Users,
} from "lucide-react";
import { api } from "@/api/apiClient";
import { useLegislativeSession } from "@/lib/LegislativeSessionContext";
import { parseAgendaBills, prettyBill } from "@/services/meetingIntel";
import {
  meetingAgenda,
  meetingNotes,
  normalizeMeetingBillNumber,
} from "@/services/meetingWorkflow";
import BillDetailsModal from "@/components/bills/BillDetailsModal";
import {
  RichTextEditor,
  sanitizeRichTextHtml,
} from "@/components/ui/rich-text-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";

const teamList = (result) => result?.teams ?? [];

function NoteEditor({ bill, meeting, workspace, sessionId, state, teams }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const noteKey = [
    "meetingNote",
    state,
    sessionId,
    meeting.id,
    bill.bill_number,
  ];
  const { data: note, isLoading } = useQuery({
    queryKey: noteKey,
    queryFn: () =>
      meetingNotes.getMine(meeting.id, bill.bill_number, sessionId, state),
  });
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [teamId, setTeamId] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [dirty, setDirty] = useState(false);
  const lastSavedRef = useRef("");
  const lastAttemptRef = useRef("");

  useEffect(() => {
    if (isLoading || hydrated) return;
    setBody(note?.body_html ?? "");
    setVisibility(note?.visibility ?? "private");
    setTeamId(note?.team_id ?? teams[0]?.id ?? "");
    lastSavedRef.current = JSON.stringify({
      body: note?.body_html ?? "",
      visibility: note?.visibility ?? "private",
      teamId: note?.team_id ?? teams[0]?.id ?? "",
    });
    lastAttemptRef.current = lastSavedRef.current;
    setHydrated(true);
  }, [hydrated, isLoading, note, teams]);

  const saveMutation = useMutation({
    mutationFn: (/** @type {boolean} */ silent) => {
      lastAttemptRef.current = JSON.stringify({ body, visibility, teamId });
      return meetingNotes
        .save(
          {
            meeting_id: meeting.id,
            meeting_title: meeting.title,
            meeting_start: meeting.start_time,
            committee_id: workspace.committee_id,
            committee_name: workspace.committee_name,
            bill_number: bill.bill_number,
            bill_id: bill.bill_id,
            bill_title: bill.bill_title,
            body_html: sanitizeRichTextHtml(body),
            visibility,
            team_id: visibility === "team" ? teamId : null,
          },
          sessionId,
          state,
        )
        .then((saved) => ({ saved, silent: Boolean(silent) }));
    },
    onSuccess: ({ saved, silent }) => {
      queryClient.setQueryData(noteKey, saved);
      queryClient.invalidateQueries({ queryKey: ["teamMeetingNotes"] });
      lastSavedRef.current = JSON.stringify({ body, visibility, teamId });
      setDirty(false);
      if (!silent) toast({ title: "Note saved" });
    },
    onError: (error) =>
      toast({
        title: "Note could not be saved",
        description: error.message,
        variant: "destructive",
      }),
  });

  useEffect(() => {
    if (!hydrated || !dirty) return undefined;
    if (visibility === "team" && !teamId) return undefined;
    const snapshot = JSON.stringify({ body, visibility, teamId });
    if (
      snapshot === lastSavedRef.current ||
      snapshot === lastAttemptRef.current
    ) return undefined;
    const timer = window.setTimeout(
      () => saveMutation.mutate(true),
      900,
    );
    return () => window.clearTimeout(timer);
  }, [body, dirty, hydrated, saveMutation, teamId, visibility]);

  const markChanged = (callback) => (value) => {
    callback(value);
    setDirty(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading note…
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3 rounded-xl border border-blue-100 bg-blue-50/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="font-semibold text-slate-900">Human Notes</h4>
          <p className="text-xs text-slate-500">
            Your note is separate from AI analysis and saves automatically.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={visibility}
            onChange={(event) => {
              setVisibility(event.target.value);
              if (event.target.value === "team" && !teamId) {
                setTeamId(teams[0]?.id ?? "");
              }
              setDirty(true);
            }}
          >
            <option value="private">Private</option>
            <option value="team" disabled={!teams.length}>
              Share with Team
            </option>
          </select>
          {visibility === "team" && (
            <select
              className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={teamId}
              onChange={markChanged(setTeamId)}
            >
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          )}
          <Button
            size="sm"
            onClick={() => saveMutation.mutate(false)}
            disabled={saveMutation.isPending || (visibility === "team" && !teamId)}
          >
            {saveMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-2 h-4 w-4" />
            )}
            Save
          </Button>
        </div>
      </div>
      <RichTextEditor
        value={body}
        onChange={markChanged(setBody)}
        minHeight={180}
        placeholder={`Take notes on ${prettyBill(bill.bill_number)}…`}
        className="bg-white"
      />
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span className="flex items-center gap-1">
          {visibility === "private" ? (
            <Shield className="h-3.5 w-3.5" />
          ) : (
            <Users className="h-3.5 w-3.5" />
          )}
          {visibility === "private"
            ? "Only you can see this note"
            : `Shared with ${teams.find((team) => team.id === teamId)?.name ?? "team"}`}
        </span>
        <span>
          {saveMutation.isPending
            ? "Saving…"
            : dirty
              ? "Unsaved changes"
              : note?.updated_at
                ? `Saved ${format(parseISO(note.updated_at), "MMM d, h:mm a")}`
                : "Autosave ready"}
        </span>
      </div>
    </div>
  );
}

export default function MeetingWorkspace() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const {
    state: selectedState,
    sessions,
    selectedSessionId,
    setSelectedSessionId,
  } = useLegislativeSession();
  const sessionId = Number(searchParams.get("sessionId"));
  const state = searchParams.get("state") || selectedState;
  const meetingId = searchParams.get("meetingId") || "";
  const routedMeeting = location.state?.meeting;
  const [addBillOpen, setAddBillOpen] = useState(false);
  const [billSearch, setBillSearch] = useState("");
  const [openNoteBill, setOpenNoteBill] = useState(null);
  const [selectedBill, setSelectedBill] = useState(null);
  const [draggedId, setDraggedId] = useState(null);

  useEffect(() => {
    if (Number.isSafeInteger(sessionId) && sessionId > 0 && selectedSessionId !== sessionId) {
      setSelectedSessionId(sessionId);
    }
  }, [selectedSessionId, sessionId, setSelectedSessionId]);

  const { data: storedMeeting, isLoading: meetingLoading } = useQuery({
    queryKey: ["meetingWorkspaceMeeting", state, sessionId, meetingId],
    queryFn: () => meetingAgenda.getMeeting(meetingId, sessionId, state),
    enabled: Boolean(meetingId && sessionId),
    initialData: routedMeeting || undefined,
  });
  const meeting = storedMeeting ?? routedMeeting;

  const { data: bills = [], isLoading: billsLoading } = useQuery({
    queryKey: ["bills", state, sessionId],
    queryFn: () => api.entities.Bill.list(sessionId, undefined, state),
    enabled: Number.isSafeInteger(sessionId) && sessionId > 0,
  });
  const billsByNumber = useMemo(
    () =>
      new Map(
        bills.map((bill) => [normalizeMeetingBillNumber(bill.bill_number), bill]),
      ),
    [bills],
  );

  const { data: officialNumbers = [], isLoading: agendaLoading } = useQuery({
    queryKey: ["meetingOfficialAgenda", state, sessionId, meetingId, meeting?.agendaUrl],
    queryFn: () => parseAgendaBills(meeting.agendaUrl),
    enabled: Boolean(meeting?.agendaUrl),
    staleTime: 24 * 60 * 60 * 1000,
  });
  const officialBills = useMemo(
    () =>
      officialNumbers.map((number) => {
        const match = billsByNumber.get(normalizeMeetingBillNumber(number));
        return (
          match ?? {
            bill_number: normalizeMeetingBillNumber(number),
            title: "Bill details are not yet in this session's cache",
          }
        );
      }),
    [billsByNumber, officialNumbers],
  );

  const workspaceMeeting = useMemo(() => {
    if (!meeting) return null;
    return {
      ...meeting,
      committeeId: meeting.committeeId ?? routedMeeting?.committeeId,
      committeeName:
        meeting.committeeName ?? routedMeeting?.committeeName ?? meeting.title,
    };
  }, [meeting, routedMeeting]);

  const { data: workspace, isLoading: workspaceLoading } = useQuery({
    queryKey: ["meetingAgendaWorkspace", state, sessionId, meetingId],
    queryFn: () => meetingAgenda.ensure(workspaceMeeting, officialBills, sessionId, state),
    enabled:
      Boolean(workspaceMeeting && sessionId) &&
      !billsLoading &&
      (!meeting?.agendaUrl || !agendaLoading),
  });
  const agendaKey = ["meetingAgendaItems", workspace?.id];
  const { data: agendaItems = [], isLoading: itemsLoading } = useQuery({
    queryKey: agendaKey,
    queryFn: () => meetingAgenda.listItems(workspace.id),
    enabled: Boolean(workspace?.id),
  });
  const { data: teamsResult } = useQuery({
    queryKey: ["allTeams"],
    queryFn: () => api.entities.Team.getAll(),
  });
  const teams = teamList(teamsResult);

  const addMutation = useMutation({
    mutationFn: (bill) => meetingAgenda.addItem(workspace.id, bill, agendaItems.length),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agendaKey });
      setAddBillOpen(false);
      setBillSearch("");
      toast({ title: "Bill added to working agenda" });
    },
    onError: (error) =>
      toast({ title: "Could not add bill", description: error.message, variant: "destructive" }),
  });
  const removeMutation = useMutation({
    mutationFn: meetingAgenda.removeItem,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: agendaKey }),
  });
  const reorderMutation = useMutation({
    mutationFn: meetingAgenda.reorderItems,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: agendaKey }),
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: agendaKey });
      toast({ title: "Could not reorder agenda", description: error.message, variant: "destructive" });
    },
  });
  const resetMutation = useMutation({
    mutationFn: () => meetingAgenda.reset(workspace),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agendaKey });
      toast({ title: "Working agenda reset to the official agenda" });
    },
  });

  const moveItem = (from, to) => {
    if (to < 0 || to >= agendaItems.length || from === to) return;
    const next = [...agendaItems];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    queryClient.setQueryData(agendaKey, next);
    reorderMutation.mutate(next);
  };
  const dropOn = (targetId) => {
    const from = agendaItems.findIndex((item) => item.id === draggedId);
    const to = agendaItems.findIndex((item) => item.id === targetId);
    setDraggedId(null);
    moveItem(from, to);
  };

  const agendaNumbers = new Set(agendaItems.map((item) => item.bill_number));
  const searchableBills = bills
    .filter((bill) => !agendaNumbers.has(normalizeMeetingBillNumber(bill.bill_number)))
    .filter((bill) => {
      const query = billSearch.trim().toLowerCase();
      return (
        !query ||
        bill.bill_number?.toLowerCase().includes(query) ||
        bill.title?.toLowerCase().includes(query)
      );
    })
    .slice(0, 30);
  const session = sessions.find((item) => Number(item.session_id) === sessionId);
  const loading = meetingLoading || workspaceLoading || itemsLoading;

  if (!meetingId || !Number.isSafeInteger(sessionId) || sessionId <= 0) {
    return (
      <div className="p-8">
        <Card className="mx-auto max-w-xl p-8 text-center">
          <h1 className="text-xl font-semibold">Meeting link is incomplete</h1>
          <Button className="mt-5" onClick={() => navigate("/Calendar")}>Back to Calendar</Button>
        </Card>
      </div>
    );
  }
  if (!meeting && !meetingLoading) {
    return (
      <div className="p-8">
        <Card className="mx-auto max-w-xl p-8 text-center">
          <h1 className="text-xl font-semibold">Meeting not found</h1>
          <p className="mt-2 text-sm text-slate-500">Open this meeting again from Calendar so its latest details can be loaded.</p>
          <Button className="mt-5" onClick={() => navigate("/Calendar")}>Back to Calendar</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <Button variant="ghost" className="-ml-3" onClick={() => navigate(-1)}>
        <ArrowLeft className="mr-2 h-4 w-4" /> Back
      </Button>

      <div className="rounded-2xl bg-gradient-to-br from-slate-950 to-blue-950 p-6 text-white shadow-lg">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-blue-100">
          <span>{session?.session_name ?? session?.name ?? `Session ${sessionId}`}</span>
          <span>→</span>
          <span>{workspace?.committee_name ?? workspaceMeeting?.committeeName}</span>
          <span>→</span>
          <span>{meeting?.start_time ? format(parseISO(meeting.start_time), "MMM d, yyyy · h:mm a") : "Meeting"}</span>
          <span>→</span>
          <span>Bills → Notes</span>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-blue-200">
              <NotebookPen className="h-5 w-5" /> Meeting Workspace
            </div>
            <h1 className="text-2xl font-bold sm:text-3xl">{meeting?.title}</h1>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-200">
              <span className="flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{meeting?.start_time && format(parseISO(meeting.start_time), "EEEE, MMMM d, yyyy")}</span>
              <span className="flex items-center gap-1.5"><Clock className="h-4 w-4" />{meeting?.start_time && format(parseISO(meeting.start_time), "h:mm a")}</span>
              {meeting?.location && <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4" />{meeting.location}</span>}
            </div>
          </div>
          {meeting?.agendaUrl && (
            <Button variant="secondary" asChild>
              <a href={meeting.agendaUrl} target="_blank" rel="noreferrer">Official Agenda <ExternalLink className="ml-2 h-4 w-4" /></a>
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-5 sm:p-6">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-blue-600" />
                <h2 className="text-xl font-bold">Bills on Agenda</h2>
                <Badge variant="secondary">{agendaItems.length}</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-500">The official agenda is preserved. Reorder, add, or remove bills here as the meeting changes.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => resetMutation.mutate()} disabled={!workspace || resetMutation.isPending}>
                <RefreshCcw className="mr-2 h-4 w-4" /> Reset
              </Button>
              <Button onClick={() => setAddBillOpen(true)} disabled={!workspace}>
                <FilePlus2 className="mr-2 h-4 w-4" /> Add Bill
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-14 text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Preparing workspace…</div>
          ) : agendaItems.length === 0 ? (
            <div className="rounded-xl border border-dashed p-10 text-center">
              <FileText className="mx-auto mb-3 h-8 w-8 text-slate-300" />
              <p className="font-medium">No bills on the working agenda</p>
              <p className="mt-1 text-sm text-slate-500">Add a bill if one is called in the room.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {agendaItems.map((item, index) => {
                const fullBill = billsByNumber.get(item.bill_number);
                const displayBill = {
                  ...item,
                  ...(fullBill || {}),
                  bill_number: item.bill_number,
                  bill_title: fullBill?.title ?? item.bill_title,
                };
                const notesOpen = openNoteBill === item.id;
                return (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={() => setDraggedId(item.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => dropOn(item.id)}
                    className={`rounded-xl border bg-white p-4 transition ${draggedId === item.id ? "opacity-50" : ""}`}
                  >
                    <div className="flex items-start gap-3">
                      <button type="button" className="mt-1 cursor-grab text-slate-300 hover:text-slate-500" aria-label="Drag to reorder"><GripVertical className="h-5 w-5" /></button>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-blue-700">{prettyBill(item.bill_number)}</span>
                          <Badge variant={item.source === "official" ? "secondary" : "outline"}>{item.source === "official" ? "Official agenda" : "Added in room"}</Badge>
                        </div>
                        <p className="mt-1 text-sm text-slate-700">{displayBill.bill_title || "Bill details unavailable"}</p>
                      </div>
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => moveItem(index, index - 1)} disabled={index === 0} aria-label="Move bill up"><ArrowUp className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => moveItem(index, index + 1)} disabled={index === agendaItems.length - 1} aria-label="Move bill down"><ArrowDown className="h-4 w-4" /></Button>
                        {fullBill && <Button variant="outline" size="sm" onClick={() => setSelectedBill(fullBill)}>View Bill</Button>}
                        <Button size="sm" variant={notesOpen ? "secondary" : "default"} onClick={() => setOpenNoteBill(notesOpen ? null : item.id)}><NotebookPen className="mr-2 h-4 w-4" />{notesOpen ? "Close Notes" : "Take Notes"}</Button>
                        <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-600" onClick={() => removeMutation.mutate(item.id)} aria-label="Remove bill"><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                    {notesOpen && workspace && <NoteEditor bill={displayBill} meeting={meeting} workspace={workspace} sessionId={sessionId} state={state} teams={teams} />}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={addBillOpen} onOpenChange={setAddBillOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Bill to Working Agenda</DialogTitle>
            <DialogDescription>Choose a bill from {session?.session_name ?? "the selected session"}.</DialogDescription>
          </DialogHeader>
          <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><Input value={billSearch} onChange={(event) => setBillSearch(event.target.value)} placeholder="Search bill number or title…" className="pl-9" /></div>
          <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
            {searchableBills.map((bill) => (
              <button key={bill.id} type="button" onClick={() => addMutation.mutate(bill)} className="flex w-full items-start justify-between gap-4 rounded-lg border p-3 text-left hover:border-blue-300 hover:bg-blue-50">
                <span><strong className="text-blue-700">{prettyBill(bill.bill_number)}</strong><span className="mt-1 block text-sm text-slate-600">{bill.title}</span></span>
                <FilePlus2 className="mt-1 h-4 w-4 shrink-0 text-blue-600" />
              </button>
            ))}
            {!searchableBills.length && <p className="py-8 text-center text-sm text-slate-500">No matching bills available.</p>}
          </div>
        </DialogContent>
      </Dialog>

      <BillDetailsModal
        bill={selectedBill}
        isOpen={Boolean(selectedBill)}
        onClose={() => setSelectedBill(null)}
        isTracked={false}
        onToggleTracking={() => {}}
        onBillUpdate={() => {}}
        teams={teams}
      />
    </div>
  );
}
