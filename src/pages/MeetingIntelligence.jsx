import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/apiClient";
import {
  fetchCachedMeetings,
  syncMeetingsRange,
  getSessionStartDate,
} from "@/services/gaMeetingsCache";
import {
  parseAgendaBills,
  matchTrackedBills,
  analyzeTranscript,
  billKey,
  prettyBill,
} from "@/services/meetingIntel";
import {
  startTabAudioTranscription,
  isTabAudioCaptureSupported,
} from "@/services/transcribe";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Radio,
  Calendar as CalendarIcon,
  History,
  Star,
  Bell,
  ArrowLeft,
  ExternalLink,
  FileText,
  Sparkles,
  Mic,
  Square,
  Building2,
  AlertTriangle,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { format } from "date-fns";
import { useLegislativeSession } from "@/lib/LegislativeSessionContext";
import { resolveLegisGaSessionMapping } from "@/services/legisGa";

// ── Helpers ──────────────────────────────────────────────────────────────────

const CHAMBER_LABEL = { 1: "House", 2: "Senate", 3: "Joint" };

const meetingPhase = (m, now = Date.now()) => {
  const start = m.start_time ? new Date(m.start_time).getTime() : 0;
  const end = m.end_time
    ? new Date(m.end_time).getTime()
    : start + 60 * 60 * 1000;
  if (now >= start && now <= end) return "live";
  if (start > now) return "upcoming";
  return "past";
};

const statusPill = {
  live: "bg-red-100 text-red-700 ring-1 ring-red-200",
  processing: "bg-amber-100 text-amber-700 ring-1 ring-amber-200",
  completed: "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200",
  scheduled: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
  failed: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
};

export default function MeetingIntelligence() {
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
    isLoading: providerSessionLoading,
  } = useQuery({
    queryKey: ["legisGaSessionMapping", state, selectedSessionId],
    queryFn: () => resolveLegisGaSessionMapping(selectedSession),
    enabled: isReady && Boolean(selectedSession),
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
  const providerSessionId = providerSessionMapping?.gaSessionId ?? null;
  const hasProviderSession = Boolean(providerSessionId);
  const [tab, setTab] = useState("live"); // live | history | favorites | alerts
  const [selectedMeetingId, setSelectedMeetingId] = useState(null);
  const [busy, setBusy] = useState(""); // human-readable busy label
  const [error, setError] = useState("");
  const sessionScopeKey = `${state}:${selectedSessionId ?? "none"}`;
  const activeSessionScopeRef = useRef(sessionScopeKey);
  const operationRequestRef = useRef(0);
  activeSessionScopeRef.current = sessionScopeKey;

  // ── Data ───────────────────────────────────────────────────────────────────
  const { data: trackedBills = [] } = useQuery({
    queryKey: ["trackedBills", state, selectedSessionId],
    queryFn: () => api.entities.TrackedBill.getNumbers(selectedSessionId, state),
    enabled: isReady,
  });

  // Kick a background sync of the upcoming window once on mount.
  useEffect(() => {
    if (!isReady || !hasProviderSession) return;
    const start = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const end = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    syncMeetingsRange(
      start,
      end,
      selectedSessionId,
      state,
      providerSessionId,
    )
      .then(() => queryClient.invalidateQueries({ queryKey: ["miMeetings"] }))
      .catch(() => {});
  }, [
    hasProviderSession,
    isReady,
    providerSessionId,
    queryClient,
    selectedSessionId,
    state,
  ]);

  const { data: meetings = [], isLoading: meetingsLoading } = useQuery({
    queryKey: ["miMeetings", state, selectedSessionId, providerSessionId],
    queryFn: () => {
      const startIso = getSessionStartDate(selectedSession).toISOString();
      const endYear = Number(selectedSession?.year_end) || new Date().getFullYear();
      const endIso = new Date(endYear, 11, 31, 23, 59, 59).toISOString();
      return fetchCachedMeetings(
        startIso,
        endIso,
        selectedSessionId,
        state,
        providerSessionId,
      );
    },
    enabled: isReady && hasProviderSession,
    refetchInterval: 60000,
  });

  const { data: transcripts = [] } = useQuery({
    queryKey: ["miTranscripts", state, selectedSessionId],
    queryFn: () =>
      api.meetingIntel.transcripts.list(selectedSessionId, 200, state),
    enabled: isReady,
    refetchInterval: 30000,
  });

  const { data: favoriteIds = new Set() } = useQuery({
    queryKey: ["miFavorites", state, selectedSessionId],
    queryFn: () => api.meetingIntel.favorites.getIds(),
  });

  const { data: alerts = [] } = useQuery({
    queryKey: ["miAlerts", state, selectedSessionId],
    queryFn: () => api.meetingIntel.alerts.list(selectedSessionId, 100, state),
    enabled: isReady,
    refetchInterval: 30000,
  });

  // transcript row keyed by meeting_id for quick lookup
  const transcriptByMeeting = useMemo(() => {
    const map = new Map();
    for (const t of transcripts) if (t.meeting_id) map.set(t.meeting_id, t);
    return map;
  }, [transcripts]);

  const trackedKeySet = useMemo(
    () => new Set(trackedBills.map((b) => billKey(b))),
    [trackedBills],
  );

  // Phase buckets
  const { live, upcoming, past } = useMemo(() => {
    const out = { live: [], upcoming: [], past: [] };
    for (const m of meetings) out[meetingPhase(m)].push(m);
    out.upcoming.sort(
      (a, b) => new Date(a.start_time) - new Date(b.start_time),
    );
    out.past.sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
    return out;
  }, [meetings]);

  const selectedMeeting = useMemo(
    () => meetings.find((m) => m.id === selectedMeetingId) || null,
    [meetings, selectedMeetingId],
  );
  const selectedTranscript = selectedMeeting
    ? transcriptByMeeting.get(selectedMeeting.id) || null
    : null;

  // ── Mutations (imperative helpers) ─────────────────────────────────────────
  const refreshTranscripts = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: ["miTranscripts", state, selectedSessionId],
      }),
    [queryClient, selectedSessionId, state],
  );

  const handleParseAgenda = useCallback(
    async (meeting) => {
      if (!meeting?.agendaUrl) {
        setError("This meeting has no agenda PDF to parse.");
        return;
      }
      const requestId = ++operationRequestRef.current;
      const originScope = sessionScopeKey;
      setError("");
      setBusy("Parsing agenda…");
      try {
        const agendaBills = await parseAgendaBills(meeting.agendaUrl);
        const t = await api.meetingIntel.transcripts.ensureForMeeting(
          meeting,
          { agenda_bills: agendaBills },
          selectedSessionId,
          state,
        );
        // Tracked-bill matches → agenda alerts
        const matches = matchTrackedBills(agendaBills, trackedBills);
        if (matches.length) {
          await api.meetingIntel.alerts.createMany(
            matches.map((bn) => ({
              transcript_id: t.id,
              bill_number: prettyBill(bn),
              alert_type: "agenda",
              message: `${prettyBill(bn)} is on the agenda for "${meeting.title}".`,
            })),
            selectedSessionId,
            state,
          );
          queryClient.invalidateQueries({ queryKey: ["miAlerts"] });
        }
        refreshTranscripts();
      } catch (e) {
        if (
          requestId === operationRequestRef.current &&
          originScope === activeSessionScopeRef.current
        ) {
          setError(e?.message || "Failed to parse agenda.");
        }
      } finally {
        if (
          requestId === operationRequestRef.current &&
          originScope === activeSessionScopeRef.current
        ) {
          setBusy("");
        }
      }
    },
    [
      trackedBills,
      queryClient,
      refreshTranscripts,
      selectedSessionId,
      sessionScopeKey,
      state,
    ],
  );

  const handleAnalyze = useCallback(
    async (meeting, transcript) => {
      const text = transcript?.transcript_text || "";
      if (text.trim().length < 40) {
        setError("There isn't enough transcript text to analyze yet.");
        return;
      }
      const requestId = ++operationRequestRef.current;
      const originScope = sessionScopeKey;
      setError("");
      setBusy("Analyzing transcript…");
      try {
        const result = await analyzeTranscript(text, {
          title: meeting.title,
          trackedBills,
          agendaBills: transcript.agenda_bills || [],
        });
        await api.meetingIntel.transcripts.update(
          transcript.id,
          {
            summary: result.summary,
            mentioned_bills: result.mentioned_bills,
            status: transcript.status === "live" ? "live" : "completed",
          },
          selectedSessionId,
          state,
        );

        // Build tracked-bill alerts: mentions + amendments.
        const alertRows = [];
        for (const bn of result.mentioned_bills) {
          if (trackedKeySet.has(billKey(bn))) {
            alertRows.push({
              transcript_id: transcript.id,
              bill_number: prettyBill(bn),
              alert_type: "mentioned",
              message: `${prettyBill(bn)} was discussed in "${meeting.title}".`,
            });
          }
        }
        for (const am of result.amendments) {
          if (trackedKeySet.has(billKey(am.bill_number))) {
            alertRows.push({
              transcript_id: transcript.id,
              bill_number: prettyBill(am.bill_number),
              alert_type: "amendment",
              message: `Amendment to ${prettyBill(am.bill_number)}: ${am.description}`,
            });
          }
        }
        if (alertRows.length) {
          await api.meetingIntel.alerts.createMany(
            alertRows,
            selectedSessionId,
            state,
          );
          queryClient.invalidateQueries({ queryKey: ["miAlerts"] });
        }
        refreshTranscripts();
      } catch (e) {
        if (
          requestId === operationRequestRef.current &&
          originScope === activeSessionScopeRef.current
        ) {
          setError(e?.message || "Analysis failed.");
        }
      } finally {
        if (
          requestId === operationRequestRef.current &&
          originScope === activeSessionScopeRef.current
        ) {
          setBusy("");
        }
      }
    },
    [
      trackedBills,
      trackedKeySet,
      queryClient,
      refreshTranscripts,
      selectedSessionId,
      sessionScopeKey,
      state,
    ],
  );

  const handleToggleFavorite = useCallback(
    async (meeting) => {
      const t =
        transcriptByMeeting.get(meeting.id) ||
        (await api.meetingIntel.transcripts.ensureForMeeting(
          meeting,
          {},
          selectedSessionId,
          state,
        ));
      await api.meetingIntel.favorites.toggle(t.id);
      queryClient.invalidateQueries({ queryKey: ["miFavorites"] });
      refreshTranscripts();
    },
    [
      transcriptByMeeting,
      queryClient,
      refreshTranscripts,
      selectedSessionId,
      state,
    ],
  );

  useEffect(() => {
    operationRequestRef.current += 1;
    setSelectedMeetingId(null);
    setTab("live");
    setError("");
    setBusy("");
  }, [selectedSessionId, state]);

  // ── Render ─────────────────────────────────────────────────────────────────
  const unseenAlerts = alerts.filter((a) => !a.seen).length;

  if (selectedMeeting) {
    return (
      <MeetingDetail
        key={`${sessionScopeKey}:${selectedMeeting.id}`}
        meeting={selectedMeeting}
        transcript={selectedTranscript}
        trackedBills={trackedBills}
        trackedKeySet={trackedKeySet}
        isFavorite={
          selectedTranscript && favoriteIds.has(selectedTranscript.id)
        }
        busy={busy}
        error={error}
        onBack={() => {
          setSelectedMeetingId(null);
          setError("");
        }}
        onParseAgenda={() => handleParseAgenda(selectedMeeting)}
        onAnalyze={() => handleAnalyze(selectedMeeting, selectedTranscript)}
        onToggleFavorite={() => handleToggleFavorite(selectedMeeting)}
        onTranscriptChanged={refreshTranscripts}
        setError={setError}
        sessionId={selectedSessionId}
        state={state}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="p-3 bg-blue-100 rounded-lg">
            <Radio className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-slate-900">
              Meeting Intelligence
            </h1>
            <p className="text-slate-600 mt-1">
              Live transcripts, AI summaries, and tracked-bill alerts from
              legislative meetings
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 w-fit flex-wrap">
          <TabButton active={tab === "live"} onClick={() => setTab("live")}>
            <Radio className="w-4 h-4" /> Live &amp; Upcoming
            {live.length > 0 && (
              <span className="ml-1 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            )}
          </TabButton>
          <TabButton
            active={tab === "history"}
            onClick={() => setTab("history")}
          >
            <History className="w-4 h-4" /> History
          </TabButton>
          <TabButton
            active={tab === "favorites"}
            onClick={() => setTab("favorites")}
          >
            <Star className="w-4 h-4" /> Favorites
          </TabButton>
          <TabButton active={tab === "alerts"} onClick={() => setTab("alerts")}>
            <Bell className="w-4 h-4" /> Alerts
            {unseenAlerts > 0 && (
              <span className="ml-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-red-500 text-white text-[11px] font-bold rounded-full">
                {unseenAlerts > 99 ? "99+" : unseenAlerts}
              </span>
            )}
          </TabButton>
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
            {error}
          </div>
        )}

        {providerSessionError && (
          <div className="text-sm text-amber-950 bg-amber-50 border border-amber-300 rounded-lg p-3">
            Official meeting data is unavailable because this session could not
            be matched safely to the Georgia Legislature. {providerSessionError.message}
          </div>
        )}

        {/* Content */}
        {tab === "alerts" ? (
          <AlertsList
            alerts={alerts}
            transcripts={transcripts}
            meetings={meetings}
            onOpen={(meetingId) => setSelectedMeetingId(meetingId)}
            onMarkAllSeen={async () => {
              const ids = alerts.filter((a) => !a.seen).map((a) => a.id);
              if (ids.length) {
                await api.meetingIntel.alerts.markSeen(
                  ids,
                  selectedSessionId,
                  state,
                );
                queryClient.invalidateQueries({ queryKey: ["miAlerts"] });
              }
            }}
          />
        ) : meetingsLoading || providerSessionLoading ? (
          <div className="text-center py-12">
            <Loader2 className="w-8 h-8 text-blue-600 mx-auto animate-spin" />
            <p className="mt-3 text-slate-600">Loading meetings…</p>
          </div>
        ) : (
          <MeetingList
            tab={tab}
            live={live}
            upcoming={upcoming}
            past={past}
            transcriptByMeeting={transcriptByMeeting}
            favoriteIds={favoriteIds}
            trackedKeySet={trackedKeySet}
            onOpen={(m) => {
              setSelectedMeetingId(m.id);
              setError("");
            }}
            onToggleFavorite={handleToggleFavorite}
          />
        )}
      </div>
    </div>
  );
}

// ── Tab button ───────────────────────────────────────────────────────────────
function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
        active
          ? "bg-white text-slate-900 shadow-sm"
          : "text-slate-500 hover:text-slate-700"
      }`}
    >
      {children}
    </button>
  );
}

// ── Tracked-bill match badges ────────────────────────────────────────────────
function MatchBadges({ transcript, trackedKeySet }) {
  if (!transcript) return null;
  const bills = [
    ...(transcript.agenda_bills || []),
    ...(transcript.mentioned_bills || []),
  ];
  const matched = [
    ...new Set(
      bills.filter((b) => trackedKeySet.has(billKey(b))).map((b) => prettyBill(b)),
    ),
  ];
  if (!matched.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {matched.map((b) => (
        <span
          key={b}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 ring-1 ring-blue-200"
        >
          <Star className="w-3 h-3" /> {b}
        </span>
      ))}
    </div>
  );
}

// ── Meeting list ─────────────────────────────────────────────────────────────
function MeetingList({
  tab,
  live,
  upcoming,
  past,
  transcriptByMeeting,
  favoriteIds,
  trackedKeySet,
  onOpen,
  onToggleFavorite,
}) {
  let groups = [];
  if (tab === "live") {
    groups = [
      { label: "Live now", items: live, live: true },
      { label: "Upcoming", items: upcoming },
    ];
  } else if (tab === "history") {
    groups = [{ label: "Past meetings", items: past }];
  } else if (tab === "favorites") {
    const favItems = [...live, ...upcoming, ...past].filter((m) => {
      const t = transcriptByMeeting.get(m.id);
      return t && favoriteIds.has(t.id);
    });
    groups = [{ label: "Favorited", items: favItems }];
  }

  const anyItems = groups.some((g) => g.items.length > 0);
  if (!anyItems) {
    return (
      <div className="text-center py-12">
        <CalendarIcon className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <p className="text-slate-600">
          {tab === "favorites"
            ? "No favorited meetings yet."
            : tab === "history"
              ? "No past meetings in the cache yet."
              : "No live or upcoming meetings right now."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <div key={g.label} className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-2">
              {g.live && (
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              )}
              {g.label} ({g.items.length})
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {g.items.map((m) => {
                const t = transcriptByMeeting.get(m.id);
                const isFav = t && favoriteIds.has(t.id);
                return (
                  <Card
                    key={m.id}
                    className="hover:shadow-md transition-shadow cursor-pointer"
                    onClick={() => onOpen(m)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div
                            className={`p-1.5 rounded-md shrink-0 ${
                              m.chamber === 2
                                ? "bg-purple-100 text-purple-600"
                                : "bg-blue-100 text-blue-600"
                            }`}
                          >
                            <Building2 className="w-4 h-4" />
                          </div>
                          <p className="font-semibold text-slate-900 truncate">
                            {m.title}
                          </p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleFavorite(m);
                          }}
                          className={`shrink-0 ${
                            isFav ? "text-yellow-500" : "text-slate-300 hover:text-yellow-400"
                          }`}
                          title={isFav ? "Unfavorite" : "Favorite"}
                        >
                          <Star
                            className="w-5 h-5"
                            fill={isFav ? "currentColor" : "none"}
                          />
                        </button>
                      </div>

                      <div className="flex items-center gap-3 mt-2 text-sm text-slate-500">
                        <span>
                          {m.start_time
                            ? format(new Date(m.start_time), "MMM d, h:mm a")
                            : "TBD"}
                        </span>
                        {m.chamber && (
                          <Badge variant="outline" className="text-xs">
                            {CHAMBER_LABEL[m.chamber] ?? "—"}
                          </Badge>
                        )}
                        {t?.status && (
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              statusPill[t.status] || statusPill.scheduled
                            }`}
                          >
                            {t.status}
                          </span>
                        )}
                      </div>

                      <MatchBadges
                        transcript={t}
                        trackedKeySet={trackedKeySet}
                      />

                      <div className="flex items-center gap-3 mt-3 text-xs">
                        {m.videoUrl && (
                          <span className="inline-flex items-center gap-1 text-slate-500">
                            <Radio className="w-3 h-3" /> Video
                          </span>
                        )}
                        {m.agendaUrl && (
                          <span className="inline-flex items-center gap-1 text-slate-500">
                            <FileText className="w-3 h-3" /> Agenda
                          </span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        ))}
    </div>
  );
}

// ── Alerts list ──────────────────────────────────────────────────────────────
function AlertsList({ alerts, transcripts, meetings, onOpen, onMarkAllSeen }) {
  const transcriptMeetingId = useMemo(() => {
    const map = new Map();
    for (const t of transcripts) map.set(t.id, t.meeting_id);
    return map;
  }, [transcripts]);

  const typeStyle = {
    amendment: "bg-amber-50 border-amber-200",
    agenda: "bg-blue-50 border-blue-200",
    mentioned: "bg-slate-50 border-slate-200",
  };
  const typeIcon = {
    amendment: <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />,
    agenda: <CalendarIcon className="w-4 h-4 text-blue-600 shrink-0" />,
    mentioned: <FileText className="w-4 h-4 text-slate-500 shrink-0" />,
  };

  if (!alerts.length) {
    return (
      <div className="text-center py-12">
        <Bell className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <p className="text-slate-600">
          No alerts yet. Parse a meeting's agenda or analyze a transcript to get
          notified about your tracked bills.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={onMarkAllSeen}>
          Mark all read
        </Button>
      </div>
      {alerts.map((a) => {
        const meetingId = transcriptMeetingId.get(a.transcript_id);
        const meeting = meetings.find((m) => m.id === meetingId);
        return (
          <div
            key={a.id}
            className={`flex items-start gap-3 p-3 rounded-lg border ${
              typeStyle[a.alert_type] || typeStyle.mentioned
            } ${a.seen ? "opacity-60" : ""} ${
              meetingId ? "cursor-pointer hover:shadow-sm" : ""
            }`}
            onClick={() => meetingId && onOpen(meetingId)}
          >
            {typeIcon[a.alert_type] || typeIcon.mentioned}
            <div className="min-w-0">
              <p className="text-sm text-slate-800">{a.message}</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {meeting?.title ? `${meeting.title} · ` : ""}
                {format(new Date(a.created_at), "MMM d, h:mm a")}
              </p>
            </div>
            {!a.seen && (
              <span className="ml-auto w-2 h-2 rounded-full bg-red-500 shrink-0 mt-1.5" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Meeting detail (transcript, summary, capture) ────────────────────────────
function MeetingDetail({
  meeting,
  transcript,
  trackedKeySet,
  isFavorite,
  busy,
  error,
  onBack,
  onParseAgenda,
  onAnalyze,
  onToggleFavorite,
  onTranscriptChanged,
  setError,
  sessionId,
  state,
}) {
  const queryClient = useQueryClient();
  const [capturing, setCapturing] = useState(false);
  const [startingCapture, setStartingCapture] = useState(false);
  const [finalizingCapture, setFinalizingCapture] = useState(false);
  const [ytUrl, setYtUrl] = useState(
    /youtu\.?be/i.test(meeting.videoUrl || "") ? meeting.videoUrl : "",
  );
  const [requesting, setRequesting] = useState(false);
  const captureRef = useRef(null);
  const capturePendingRef = useRef(false);
  const captureStoppingRef = useRef(false);
  const captureFinalizationRef = useRef(null);
  const activeRef = useRef(true);
  const seqRef = useRef(0);
  const transcriptIdRef = useRef(transcript?.id || null);
  const textRef = useRef(transcript?.transcript_text || "");

  // Segments query + realtime
  const { data: segments = [] } = useQuery({
    queryKey: ["miSegments", transcript?.id],
    queryFn: () => api.meetingIntel.segments.list(transcript.id),
    enabled: !!transcript?.id,
    refetchInterval: capturing ? 5000 : false,
  });

  useEffect(() => {
    if (!transcript?.id) return;
    seqRef.current = segments.length;
    transcriptIdRef.current = transcript.id;
    textRef.current = transcript.transcript_text || "";
  }, [transcript?.id, transcript?.transcript_text, segments.length]);

  useEffect(() => {
    if (!transcript?.id) return undefined;
    const channel = api.meetingIntel.segments.subscribe(transcript.id, () => {
      queryClient.invalidateQueries({
        queryKey: ["miSegments", transcript.id],
      });
    });
    return () => {
      try {
        channel?.unsubscribe?.();
      } catch {
        /* noop */
      }
    };
  }, [transcript?.id, queryClient]);

  // Stop capture when leaving the detail view.
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      const controller = captureRef.current;
      captureRef.current = null;
      controller?.stop?.();
    };
  }, []);

  const startCapture = async () => {
    if (
      capturePendingRef.current ||
      captureStoppingRef.current ||
      captureFinalizationRef.current ||
      capturing
    ) {
      return;
    }
    capturePendingRef.current = true;
    setStartingCapture(true);
    setError("");
    try {
      // Ensure a transcript row exists and mark it live.
      const t = await api.meetingIntel.transcripts.ensureForMeeting(
        meeting,
        {},
        sessionId,
        state,
      );
      if (!activeRef.current) return;
      transcriptIdRef.current = t.id;
      textRef.current = t.transcript_text || "";
      seqRef.current = (await api.meetingIntel.segments.list(t.id)).length;
      if (!activeRef.current) return;
      onTranscriptChanged();

      let captureStopped = false;
      let captureMarkedLive = false;
      let finalizationPromise = null;
      const completeCapture = async () => {
        let lastError;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            await api.meetingIntel.transcripts.update(
              t.id,
              { status: "completed" },
              sessionId,
              state,
            );
            return;
          } catch (completionError) {
            lastError = completionError;
            if (attempt < 2) {
              await new Promise((resolve) =>
                setTimeout(resolve, 250 * (attempt + 1)),
              );
            }
          }
        }
        throw lastError;
      };
      const finalizeCapture = () => {
        captureStopped = true;
        if (!captureMarkedLive) {
          captureStoppingRef.current = false;
          if (activeRef.current) {
            setCapturing(false);
            setFinalizingCapture(false);
          }
          return Promise.resolve();
        }
        if (finalizationPromise) return finalizationPromise;

        captureStoppingRef.current = true;
        if (activeRef.current) {
          setCapturing(false);
          setFinalizingCapture(true);
        }
        const task = completeCapture()
          .then(() => {
            if (activeRef.current) onTranscriptChanged();
          })
          .catch((completionError) => {
            console.error("Could not finalize attended capture", completionError);
            if (activeRef.current) {
              setError(
                "Capture stopped, but its transcript status could not be finalized. Please retry shortly.",
              );
            }
          })
          .finally(() => {
            if (captureFinalizationRef.current === task) {
              captureFinalizationRef.current = null;
            }
            captureStoppingRef.current = false;
            if (activeRef.current) setFinalizingCapture(false);
          });
        finalizationPromise = task;
        captureFinalizationRef.current = task;
        return task;
      };
      let managedController = null;
      const controller = await startTabAudioTranscription({
        windowMs: 20000,
        onSegment: async (text) => {
          if (!text || !activeRef.current) return;
          seqRef.current += 1;
          textRef.current = `${textRef.current} ${text}`.trim();
          try {
            await api.meetingIntel.segments.add(transcriptIdRef.current, {
              seq: seqRef.current,
              text,
            });
            await api.meetingIntel.transcripts.update(
              transcriptIdRef.current,
              { transcript_text: textRef.current },
              sessionId,
              state,
            );
            if (!activeRef.current) return;
            queryClient.invalidateQueries({
              queryKey: ["miSegments", transcriptIdRef.current],
            });
            onTranscriptChanged();
          } catch (e) {
            console.warn("segment save failed", e);
          }
        },
        onError: (e) => {
          if (activeRef.current) setError(e.message);
        },
        onStop: () => {
          if (captureRef.current === managedController) {
            captureRef.current = null;
          }
          void finalizeCapture();
        },
      });
      let stopRequested = false;
      managedController = {
        stop: () => {
          if (stopRequested) {
            void finalizeCapture();
            return;
          }
          stopRequested = true;
          captureStoppingRef.current = true;
          if (activeRef.current) {
            setCapturing(false);
            setFinalizingCapture(captureMarkedLive);
          }
          try {
            controller?.stop?.();
          } finally {
            void finalizeCapture();
          }
        },
      };
      if (!activeRef.current || captureStopped) {
        managedController.stop();
        return;
      }
      captureRef.current = managedController;
      await api.meetingIntel.transcripts.update(
        t.id,
        { status: "live" },
        sessionId,
        state,
      );
      captureMarkedLive = true;
      if (!activeRef.current || captureStopped) {
        managedController.stop();
        if (captureRef.current === managedController) captureRef.current = null;
        await finalizeCapture();
        return;
      }
      setCapturing(true);
    } catch (e) {
      const controller = captureRef.current;
      captureRef.current = null;
      controller?.stop?.();
      if (!activeRef.current) {
        console.error("Attended capture startup failed", e);
      }
      if (activeRef.current) {
        setError(e?.message || "Could not start capture.");
      }
    } finally {
      capturePendingRef.current = false;
      if (activeRef.current) setStartingCapture(false);
    }
  };

  const stopCapture = () => {
    captureRef.current?.stop?.();
    captureRef.current = null;
  };

  const requestLiveMonitor = async () => {
    if (!ytUrl.trim()) {
      setError("Paste the meeting's YouTube live URL first.");
      return;
    }
    setError("");
    setRequesting(true);
    try {
      await api.meetingIntel.transcripts.requestMonitor(
        meeting,
        ytUrl.trim(),
        sessionId,
        state,
      );
      if (activeRef.current) onTranscriptChanged();
    } catch (e) {
      if (activeRef.current) {
        setError(e?.message || "Could not request monitoring.");
      }
    }
    if (activeRef.current) setRequesting(false);
  };

  const monitorStatus = transcript?.status;
  const agendaBills = transcript?.agenda_bills || [];
  const mentionedBills = transcript?.mentioned_bills || [];

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto p-6 space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Button variant="ghost" onClick={onBack} className="gap-2 text-slate-600">
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleFavorite}
              className={isFavorite ? "text-yellow-500" : "text-slate-400"}
            >
              <Star className="w-4 h-4 mr-1" fill={isFavorite ? "currentColor" : "none"} />
              {isFavorite ? "Favorited" : "Favorite"}
            </Button>
            {meeting.agendaUrl && (
              <Button variant="outline" size="sm" onClick={onParseAgenda} className="gap-1">
                <FileText className="w-4 h-4" /> Parse agenda
              </Button>
            )}
            {meeting.videoUrl && (
              <Button variant="outline" size="sm" asChild className="gap-1">
                <a href={meeting.videoUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-4 h-4" /> Watch
                </a>
              </Button>
            )}
          </div>
        </div>

        {/* Header card */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div
                className={`p-2 rounded-lg shrink-0 ${
                  meeting.chamber === 2
                    ? "bg-purple-100 text-purple-600"
                    : "bg-blue-100 text-blue-600"
                }`}
              >
                <Building2 className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl font-bold text-slate-900">
                  {meeting.title}
                </h1>
                <p className="text-sm text-slate-500 mt-0.5">
                  {CHAMBER_LABEL[meeting.chamber] ?? "Meeting"} ·{" "}
                  {meeting.start_time
                    ? format(new Date(meeting.start_time), "EEE MMM d, h:mm a")
                    : "Time TBD"}
                  {meeting.location ? ` · ${meeting.location}` : ""}
                </p>
              </div>
            </div>

            {(agendaBills.length > 0 || mentionedBills.length > 0) && (
              <div className="mt-4 space-y-2">
                {agendaBills.length > 0 && (
                  <BillChipRow
                    label="On agenda"
                    bills={agendaBills}
                    trackedKeySet={trackedKeySet}
                  />
                )}
                {mentionedBills.length > 0 && (
                  <BillChipRow
                    label="Discussed"
                    bills={mentionedBills}
                    trackedKeySet={trackedKeySet}
                  />
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
            {error}
          </div>
        )}

        {/* Capture / analyze controls */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Mic className="w-4 h-4 text-blue-600" /> Transcription
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!isTabAudioCaptureSupported() ? (
              <p className="text-sm text-slate-500">
                Attended capture needs a recent desktop Chrome/Edge. For
                unattended live transcription, deploy the{" "}
                <code className="text-xs">transcribe-meeting</code> Edge Function.
              </p>
            ) : !capturing ? (
              <div className="flex items-center gap-2 flex-wrap">
                 <Button
                   onClick={startCapture}
                   disabled={startingCapture || finalizingCapture}
                   className="bg-red-600 hover:bg-red-700 gap-2"
                 >
                   {startingCapture || finalizingCapture ? (
                     <Loader2 className="w-4 h-4 animate-spin" />
                   ) : (
                     <Radio className="w-4 h-4" />
                   )}
                   {finalizingCapture
                     ? "Finalizing capture..."
                     : startingCapture
                       ? "Waiting for shared tab..."
                       : "Start capturing tab audio"}
                 </Button>
                <p className="text-xs text-slate-500">
                  Pick the meeting's video tab and enable “Share tab audio”.
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <Button onClick={stopCapture} variant="outline" className="gap-2">
                  <Square className="w-4 h-4" /> Stop
                </Button>
                <span className="inline-flex items-center gap-1.5 text-sm text-red-600 font-medium">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  Listening… (transcribing every 20s)
                </span>
              </div>
            )}

            {/* Unattended live monitoring (worker pulls YouTube audio) */}
            <div className="border-t border-slate-100 pt-3 space-y-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Unattended live (YouTube)
              </p>
              {monitorStatus === "requested" ? (
                <div className="flex items-center gap-2 text-sm text-amber-700">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Requested — waiting for the worker to pick this up…
                </div>
              ) : monitorStatus === "live" && transcript?.youtube_url ? (
                <div className="flex items-center gap-2 text-sm text-red-600 font-medium">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  Worker is transcribing this meeting live.
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <Input
                    value={ytUrl}
                    onChange={(e) => setYtUrl(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=…"
                    className="max-w-sm h-9 text-sm"
                  />
                  <Button
                    onClick={requestLiveMonitor}
                    disabled={requesting}
                    variant="outline"
                    className="gap-2"
                  >
                    {requesting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Radio className="w-4 h-4 text-red-500" />
                    )}
                    Start live monitoring
                  </Button>
                </div>
              )}
              <p className="text-xs text-slate-400">
                Requires the worker process running (see worker/README.md).
              </p>
            </div>

            <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
              <Button
                variant="outline"
                onClick={onAnalyze}
                disabled={!!busy || (transcript?.transcript_text || "").length < 40}
                className="gap-2"
              >
                {busy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4 text-purple-500" />
                )}
                Analyze & summarize
              </Button>
              {busy && <span className="text-sm text-slate-500">{busy}</span>}
            </div>
          </CardContent>
        </Card>

        {/* AI summary */}
        {transcript?.summary && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-500" /> AI Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-slate-700 whitespace-pre-line leading-relaxed">
                {transcript.summary}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Live transcript */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-600" /> Transcript
              {capturing && (
                <RefreshCw className="w-3.5 h-3.5 text-slate-400 animate-spin" />
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {segments.length === 0 ? (
              <p className="text-slate-400 italic text-sm">
                No transcript yet. Start capturing the meeting's tab audio, or
                once the live Edge Function is deployed it will fill in
                automatically.
              </p>
            ) : (
              <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                {segments.map((s) => (
                  <p key={s.id} className="text-sm text-slate-700 leading-relaxed">
                    {s.text}
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function BillChipRow({ label, bills, trackedKeySet }) {
  const pretty = [...new Set(bills.map((b) => prettyBill(b)))];
  return (
    <div className="flex items-start gap-2 flex-wrap">
      <span className="text-xs font-semibold text-slate-400 uppercase mt-1">
        {label}
      </span>
      <div className="flex flex-wrap gap-1">
        {pretty.map((b) => {
          const tracked = trackedKeySet.has(billKey(b));
          return (
            <span
              key={b}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                tracked
                  ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              {tracked && <Star className="w-3 h-3" />}
              {b}
            </span>
          );
        })}
      </div>
    </div>
  );
}
