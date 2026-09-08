import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  CalendarDays,
  ExternalLink,
  FileText,
  Loader2,
  MessageSquare,
  NotebookPen,
  Search,
  Send,
  User,
} from "lucide-react";
import { api } from "@/api/apiClient";
import BillDetailsModal from "@/components/bills/BillDetailsModal";
import { RichTextContent } from "@/components/ui/rich-text-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { useLegislativeSession } from "@/lib/LegislativeSessionContext";
import {
  meetingNotes,
  meetingWorkspaceUrl,
  normalizeMeetingBillNumber,
} from "@/services/meetingWorkflow";
import { prettyBill } from "@/services/meetingIntel";

function NoteComments({ note, comments, onAdd, saving }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  return (
    <div className="border-t border-slate-100 pt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <MessageSquare className="h-4 w-4" />
        {comments.length} comment{comments.length === 1 ? "" : "s"}
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {comments.map((comment) => (
            <div key={comment.id} className="rounded-lg bg-slate-50 px-3 py-2">
              <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
                <strong className="text-slate-700">{comment.author_name}</strong>
                <span>{format(parseISO(comment.created_at), "MMM d, h:mm a")}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{comment.body}</p>
            </div>
          ))}
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!body.trim()) return;
              onAdd(note.id, body.trim(), () => setBody(""));
            }}
          >
            <Input value={body} onChange={(event) => setBody(event.target.value)} placeholder="Add a comment…" maxLength={4000} />
            <Button size="icon" type="submit" disabled={!body.trim() || saving} aria-label="Post comment">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}

export default function TeamNotes({ team }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { state, selectedSessionId, isReady } = useLegislativeSession();
  const [dateFilter, setDateFilter] = useState("");
  const [committeeFilter, setCommitteeFilter] = useState("all");
  const [billFilter, setBillFilter] = useState("");
  const [authorFilter, setAuthorFilter] = useState("all");
  const [selectedBill, setSelectedBill] = useState(null);
  const [savingCommentFor, setSavingCommentFor] = useState(null);

  const notesKey = ["teamMeetingNotes", team.id, state, selectedSessionId];
  const { data: notes = [], isLoading, error } = useQuery({
    queryKey: notesKey,
    queryFn: () => meetingNotes.listForTeam(team.id, selectedSessionId, state),
    enabled: isReady,
  });
  const noteIdsKey = notes.map((note) => note.id).join(",");
  const { data: comments = [] } = useQuery({
    queryKey: ["meetingNoteComments", team.id, noteIdsKey],
    queryFn: () => meetingNotes.listComments(notes.map((note) => note.id)),
    enabled: notes.length > 0,
  });
  const { data: bills = [] } = useQuery({
    queryKey: ["bills", state, selectedSessionId],
    queryFn: () => api.entities.Bill.list(selectedSessionId, undefined, state),
    enabled: isReady,
  });

  const commentsByNote = useMemo(() => {
    const grouped = new Map();
    comments.forEach((comment) => {
      const values = grouped.get(comment.note_id) ?? [];
      values.push(comment);
      grouped.set(comment.note_id, values);
    });
    return grouped;
  }, [comments]);
  const committees = useMemo(
    () => [...new Set(notes.map((note) => note.committee_name))].sort(),
    [notes],
  );
  const authors = useMemo(
    () =>
      [...new Map(notes.map((note) => [note.author_id, note.author_name])).entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [notes],
  );
  const visibleNotes = useMemo(() => {
    const billQuery = billFilter.trim().toLowerCase();
    return notes.filter((note) => {
      if (dateFilter && String(note.meeting_start).slice(0, 10) !== dateFilter) return false;
      if (committeeFilter !== "all" && note.committee_name !== committeeFilter) return false;
      if (authorFilter !== "all" && note.author_id !== authorFilter) return false;
      if (
        billQuery &&
        !note.bill_number.toLowerCase().includes(billQuery) &&
        !String(note.bill_title || "").toLowerCase().includes(billQuery)
      ) return false;
      return true;
    });
  }, [authorFilter, billFilter, committeeFilter, dateFilter, notes]);

  const commentMutation = useMutation({
    mutationFn: (/** @type {{noteId: string, body: string, done?: () => void}} */ variables) =>
      meetingNotes.addComment(variables.noteId, variables.body),
    onMutate: ({ noteId }) => setSavingCommentFor(noteId),
    onSuccess: (_comment, variables) => {
      queryClient.invalidateQueries({ queryKey: ["meetingNoteComments", team.id] });
      variables.done?.();
    },
    onError: (mutationError) =>
      toast({ title: "Comment could not be posted", description: mutationError.message, variant: "destructive" }),
    onSettled: () => setSavingCommentFor(null),
  });

  const openBill = (note) => {
    const match = bills.find(
      (bill) =>
        normalizeMeetingBillNumber(bill.bill_number) ===
        normalizeMeetingBillNumber(note.bill_number),
    );
    if (!match) {
      toast({ title: "Bill details are not available in this session cache" });
      return;
    }
    setSelectedBill(match);
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900">
          <NotebookPen className="h-5 w-5 text-blue-600" /> Team Notes
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          Human meeting notes explicitly shared with {team.name}. Private notes never appear here.
        </p>
      </div>

      <div className="grid gap-2 rounded-xl border bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} aria-label="Filter notes by date" />
        <select className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm" value={committeeFilter} onChange={(event) => setCommitteeFilter(event.target.value)} aria-label="Filter notes by committee">
          <option value="all">All committees</option>
          {committees.map((committee) => <option key={committee} value={committee}>{committee}</option>)}
        </select>
        <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><Input className="pl-9" value={billFilter} onChange={(event) => setBillFilter(event.target.value)} placeholder="Filter by bill…" /></div>
        <select className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm" value={authorFilter} onChange={(event) => setAuthorFilter(event.target.value)} aria-label="Filter notes by author">
          <option value="all">All authors</option>
          {authors.map((author) => <option key={author.id} value={author.id}>{author.name}</option>)}
        </select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-sm text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading team notes…</div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error.message}</div>
      ) : visibleNotes.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center">
          <NotebookPen className="mx-auto mb-3 h-9 w-9 text-slate-300" />
          <p className="font-medium text-slate-700">No shared meeting notes match these filters</p>
          <p className="mt-1 text-sm text-slate-500">Notes appear here as soon as an author selects “Share with Team.”</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleNotes.map((note) => (
            <Card key={note.id}>
              <CardContent className="space-y-4 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">{prettyBill(note.bill_number)}</Badge>
                      <span className="font-semibold text-slate-900">{note.committee_name}</span>
                    </div>
                    {note.bill_title && <p className="mt-1 text-sm text-slate-600">{note.bill_title}</p>}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => openBill(note)}><FileText className="mr-1.5 h-4 w-4" />Open Bill</Button>
                    <Button size="sm" variant="outline" onClick={() => {
                      const meeting = {
                        id: note.meeting_id,
                        title: note.meeting_title,
                        start_time: note.meeting_start,
                        committeeId: note.committee_id,
                        committeeName: note.committee_name,
                      };
                      navigate(meetingWorkspaceUrl(meeting, selectedSessionId, state), { state: { meeting } });
                    }}><ExternalLink className="mr-1.5 h-4 w-4" />Open Meeting</Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
                  <span className="flex items-center gap-1"><User className="h-3.5 w-3.5" />{note.author_name}</span>
                  <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{format(parseISO(note.meeting_start), "MMM d, yyyy · h:mm a")}</span>
                  <span>Updated {format(parseISO(note.updated_at), "MMM d, h:mm a")}</span>
                </div>
                <div className="rounded-lg border border-slate-100 bg-white p-4"><RichTextContent value={note.body_html} emptyText="This shared note is empty." className="text-sm" /></div>
                <NoteComments
                  note={note}
                  comments={commentsByNote.get(note.id) ?? []}
                  saving={savingCommentFor === note.id}
                  onAdd={(noteId, body, done) => commentMutation.mutate({ noteId, body, done })}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <BillDetailsModal
        bill={selectedBill}
        isOpen={Boolean(selectedBill)}
        onClose={() => setSelectedBill(null)}
        isTracked={false}
        onToggleTracking={() => {}}
        onBillUpdate={() => {}}
        teams={[team]}
      />
    </div>
  );
}
