import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getGASessions, isLegiScanConfigured } from "@/services/legiscan";
import { api } from "@/api/apiClient";
import { syncAllBillSessions } from "@/services/billSync";
import { useAuth } from "@/lib/AuthContext";

const LegislativeSessionContext = createContext(null);
const STATE = "GA";
const STORAGE_KEY = `legispulse:selected-session:${STATE}`;

function readStoredSessionId() {
  try {
    const value = sessionStorage.getItem(STORAGE_KEY);
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function LegislativeSessionProvider({ children }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [selectedSessionId, setSelectedSessionIdState] = useState(
    readStoredSessionId,
  );
  const [allSessionSyncProgress, setAllSessionSyncProgress] = useState({
    completed: 0,
    currentSession: null,
    total: 0,
  });

  const {
    data: sessions = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["legislativeSessions", STATE],
    queryFn: getGASessions,
    enabled: isLegiScanConfigured(),
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });

  useEffect(() => {
    if (!sessions.length) return;
    const storedIsValid = sessions.some(
      (session) => session.session_id === selectedSessionId,
    );
    if (!storedIsValid) setSelectedSessionIdState(sessions[0].session_id);
  }, [sessions, selectedSessionId]);

  const selectedSession = useMemo(
    () =>
      sessions.find((session) => session.session_id === selectedSessionId) ||
      null,
    [sessions, selectedSessionId],
  );

  const sessionsSignature = sessions
    .map((session) => session.session_id)
    .join(",");
  const {
    data: allSessionSyncResult,
    error: allSessionSyncError,
    isFetching: isSyncingAllSessions,
    refetch: refetchAllSessions,
  } = useQuery({
    queryKey: ["allSessionBillSync", user?.id ?? null, STATE, sessionsSignature],
    queryFn: async () => {
      setAllSessionSyncProgress({
        completed: 0,
        currentSession: null,
        total: sessions.length,
      });
      return syncAllBillSessions({
        sessions,
        state: STATE,
        onSessionStart: (session) =>
          setAllSessionSyncProgress((progress) => ({
            ...progress,
            currentSession: getSessionDisplayName(session),
          })),
        onSessionComplete: (_session, _result, completed, total) =>
          setAllSessionSyncProgress((progress) => ({
            ...progress,
            completed,
            total,
          })),
        onMasterSaved: (session, bills) =>
          queryClient.setQueryData(
            ["bills", STATE, session.session_id],
            bills,
          ),
      });
    },
    enabled: Boolean(user?.id) && sessions.length > 0 && isLegiScanConfigured(),
    staleTime: Infinity,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const syncAllSessions = useCallback(async () => {
    const response = await refetchAllSessions();
    if (response.error) throw response.error;
    return response.data;
  }, [refetchAllSessions]);

  useEffect(() => {
    if (!selectedSessionId) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, String(selectedSessionId));
    } catch {
      // Session storage can be unavailable in privacy-restricted browsers.
    }
  }, [selectedSessionId]);

  const setSelectedSessionId = useCallback(
    (nextId) => {
      const numericId = Number(nextId);
      if (!Number.isSafeInteger(numericId) || numericId <= 0) return;
      setSelectedSessionIdState(numericId);
      queryClient.invalidateQueries({
        predicate: (query) =>
          [
            "bills",
            "profile",
            "trackedBills",
            "teamBills",
            "allTeamBills",
            "allTeamBillNumbers",
            "sharedTeamBillData",
            "userBillMeta",
            "personalBillMeta",
            "lcTracking",
            "lcGlobalMap",
            "committeeBills",
            "gaCommittees",
            "gaAllCommittees",
            "committeeDetails",
            "legislativeEvents",
            "legEventsCached",
            "calendarEvents",
            "notifications",
            "tweets",
            "miTranscripts",
            "miMeetings",
            "miFavorites",
            "miAlerts",
            "miAlertCount",
          ].includes(query.queryKey[0]),
      });
    },
    [queryClient],
  );

  const value = useMemo(
    () => ({
      state: STATE,
      sessions,
      selectedSession,
      selectedSessionId: selectedSession?.session_id ?? null,
      setSelectedSessionId,
      isLoading,
      isBootstrappingBills: isSyncingAllSessions,
      isSyncingAllSessions,
      allSessionSyncProgress,
      allSessionSyncFailures: allSessionSyncResult?.failures ?? [],
      lastAllSessionsSyncAt: allSessionSyncResult?.completedAt ?? null,
      syncAllSessions,
      allSessionSyncError,
      error:
        error ||
        (!isLegiScanConfigured()
          ? new Error("LegiScan API key is not configured.")
          : null),
      isReady: Boolean(selectedSession),
    }),
    [
      sessions,
      selectedSession,
      setSelectedSessionId,
      isLoading,
      isSyncingAllSessions,
      allSessionSyncProgress,
      allSessionSyncResult,
      syncAllSessions,
      allSessionSyncError,
      error,
    ],
  );

  return (
    <LegislativeSessionContext.Provider value={value}>
      {children}
    </LegislativeSessionContext.Provider>
  );
}

export function useLegislativeSession() {
  const context = useContext(LegislativeSessionContext);
  if (!context) {
    throw new Error(
      "useLegislativeSession must be used inside LegislativeSessionProvider",
    );
  }
  return context;
}

export function getSessionDisplayName(session) {
  if (!session) return "Select a session";
  return (
    session.session_title ||
    session.session_name ||
    `${session.year_start || "Unknown"} ${session.session_tag || "Session"}`
  );
}

export function getSessionGroupLabel(session) {
  const start = Number(session?.year_start);
  const end = Number(session?.year_end);
  if (start && end && end !== start) return `${start}-${end}`;
  if (!start) return "Other sessions";
  const bienniumStart = start % 2 === 0 ? start - 1 : start;
  return `${bienniumStart}-${bienniumStart + 1}`;
}
