import { api } from "@/api/apiClient";
import {
  enrichBillsWithDetails,
  fetchGABills,
  fetchLCNumbersForBills,
  isLegiScanConfigured,
} from "@/services/legiscan";

const DEFAULT_STATE = "GA";
const DETAIL_ENRICHMENT_LIMIT = 120;
const pendingSyncs = new Map();
const pendingAllSessionSyncs = new Map();

function storedBill(bill, sessionId, session, state) {
  return {
    state,
    session_id: sessionId,
    session_name:
      bill.session_name ||
      session?.session_title ||
      session?.session_name ||
      null,
    session:
      bill.session_name ||
      session?.session_title ||
      session?.session_name ||
      null,
    legiscan_id: bill.legiscan_id,
    bill_number: bill.bill_number,
    title: bill.title,
    chamber: bill.chamber,
    bill_type: bill.bill_type,
    sponsor: bill.sponsor,
    sponsor_party: bill.sponsor_party || null,
    sponsors: bill.sponsors || [],
    co_sponsors: bill.co_sponsors || [],
    session_year: bill.session_year,
    status: bill.status,
    last_action: bill.last_action,
    last_action_date: bill.last_action_date,
    current_committee: bill.current_committee || null,
    url: bill.url,
    extra: bill.change_hash ? { change_hash: bill.change_hash } : null,
  };
}

const actionTime = (bill) =>
  Date.parse(bill?.last_action_date || bill?.status_date || "") || 0;

function detailCandidates(bills, existingBills, limit = DETAIL_ENRICHMENT_LIMIT) {
  const existingByLegiscanId = new Map(
    existingBills
      .filter((bill) => bill.legiscan_id)
      .map((bill) => [String(bill.legiscan_id), bill]),
  );

  return bills
    .filter((bill) => {
      if (!bill.legiscan_id) return false;
      const existing = existingByLegiscanId.get(String(bill.legiscan_id));
      if (!existing || !Array.isArray(existing.history)) return true;
      const previousHash = existing.extra?.change_hash ?? null;
      const nextHash = bill.change_hash ?? null;
      return Boolean(nextHash) && nextHash !== previousHash;
    })
    .sort((left, right) => actionTime(right) - actionTime(left))
    .slice(0, Math.max(0, Number(limit) || 0))
    .map((bill) => ({
      ...bill,
      existingExtra:
        existingByLegiscanId.get(String(bill.legiscan_id))?.extra ?? {},
    }));
}

/**
 * Populate one LegiScan session end-to-end. All reads and writes stay inside
 * the supplied state/session scope. Detail and LC enrichment are best-effort;
 * the master bill list remains usable if either provider phase is unavailable.
 */
async function runSessionSync({
  sessionId,
  session,
  state = DEFAULT_STATE,
  onPhase = (..._args) => {},
  onProgress = (..._args) => {},
  onMasterSaved = (..._args) => {},
  onWarning = (message, error) => console.warn(message, error),
  masterOnly = false,
  detailEnrichmentLimit = DETAIL_ENRICHMENT_LIMIT,
  sponsorEnrichmentLimit = 200,
}) {
  const sid = Number(sessionId);
  if (!Number.isSafeInteger(sid) || sid <= 0) {
    throw new Error("Select a legislative session before syncing bills.");
  }
  if (!isLegiScanConfigured()) {
    throw new Error(
      "LegiScan API key not configured. Add VITE_LEGISCAN_API_KEY to your .env file.",
    );
  }

  const existingBills = await api.entities.Bill.list(sid, undefined, state);
  onPhase("bills");
  const bills = await fetchGABills(sid, {
    sponsorEnrichmentLimit,
    enrichCommittees: !masterOnly,
    enrichParties: !masterOnly,
  });
  onProgress(bills.length, bills.length);
  const existingByNumber = new Map(
    existingBills.map((bill) => [bill.bill_number, bill]),
  );
  const savedBills = await api.entities.Bill.replaceAll(
    bills.map((bill) => {
      const incoming = storedBill(bill, sid, session, state);
      if (!masterOnly) return incoming;
      const existing = existingByNumber.get(incoming.bill_number);
      if (!existing) return incoming;
      return {
        ...incoming,
        sponsor:
          incoming.sponsor && incoming.sponsor !== "Unknown"
            ? incoming.sponsor
            : existing.sponsor,
        sponsor_party: incoming.sponsor_party || existing.sponsor_party,
        sponsors:
          incoming.sponsors?.length > 0
            ? incoming.sponsors
            : existing.sponsors || [],
        co_sponsors:
          incoming.co_sponsors?.length > 0
            ? incoming.co_sponsors
            : existing.co_sponsors || [],
        current_committee:
          incoming.current_committee || existing.current_committee || null,
      };
    }),
    sid,
    state,
  );
  onMasterSaved(savedBills);

  if (masterOnly) {
    onPhase(null);
    return { bills: savedBills, total: bills.length };
  }

  onPhase("committees");
  const candidates = detailCandidates(
    bills,
    existingBills,
    detailEnrichmentLimit,
  );
  onProgress(0, candidates.length);
  try {
    const enriched = await enrichBillsWithDetails(
      candidates,
      (current, total) => onProgress(current, total),
    );
    if (enriched.length > 0) {
      const candidateById = new Map(
        candidates.map((bill) => [String(bill.legiscan_id), bill]),
      );
      await api.entities.Bill.bulkUpdateCommitteeData(
        enriched.map((bill) => {
          const candidate = candidateById.get(String(bill.legiscan_id));
          return {
            ...bill,
            extra: {
              ...(candidate?.existingExtra ?? {}),
              ...(candidate?.change_hash
                ? { change_hash: candidate.change_hash }
                : {}),
            },
          };
        }),
        sid,
        state,
      );
    }
  } catch (error) {
    onWarning("[Committees] Detail enrichment failed (non-fatal).", error);
  }

  onPhase("lc");
  try {
    const personalTracked = await api.entities.TrackedBill.getNumbers(
      sid,
      state,
    ).catch(() => []);
    const allTeamData = await api.entities.Team.getAll().catch(() => ({
      teams: [],
    }));
    const teamLists = await Promise.all(
      (allTeamData?.teams ?? []).map((team) =>
        api.entities.Team.getBillNumbers(team.id, sid, state).catch(() => []),
      ),
    );
    const allTrackedNumbers = [
      ...new Set([...personalTracked, ...teamLists.flat()]),
    ];
    const trackedBillsWithIds = bills.filter(
      (bill) =>
        allTrackedNumbers.includes(bill.bill_number) && bill.legiscan_id,
    );

    if (trackedBillsWithIds.length > 0) {
      onProgress(0, trackedBillsWithIds.length);
      const lcResults = await fetchLCNumbersForBills(
        trackedBillsWithIds,
        (current, total) => onProgress(current, total),
      );
      const lcEntries = Object.entries(lcResults)
        .filter(([, lcNumber]) => lcNumber)
        .map(([billNumber, lcNumber]) => ({
          bill_number: billNumber,
          lc_number: lcNumber,
        }));
      if (lcEntries.length > 0) {
        await api.entities.Bill.updateLcNumbers(lcEntries, sid, state);
        await api.LcTracking.batchUpsert(lcEntries, sid, state);
      }
    }
  } catch (error) {
    onWarning("[LC] LC enrichment failed (non-fatal).", error);
  }

  onPhase(null);
  return {
    bills: await api.entities.Bill.list(sid, undefined, state),
    total: bills.length,
  };
}

/**
 * Populate one LegiScan session end-to-end. Concurrent callers for the same
 * state/session share one promise so bootstrap and a manual sync cannot race.
 */
export function syncBillsForSession(options) {
  const sid = Number(options?.sessionId);
  const state = options?.state || DEFAULT_STATE;
  const syncKey = `${state}:${sid}`;
  const pending = pendingSyncs.get(syncKey);
  if (pending) return pending;

  const task = runSessionSync(options).finally(() => {
    if (pendingSyncs.get(syncKey) === task) pendingSyncs.delete(syncKey);
  });
  pendingSyncs.set(syncKey, task);
  return task;
}

/**
 * Refresh every real LegiScan session as one background job. The master lists
 * are the currency boundary users care about when switching sessions; deeper
 * sponsor/history data remains lazy or session-specific so opening the app
 * does not burn hundreds of detail calls per historical session.
 */
export function syncAllBillSessions({
  sessions,
  state = DEFAULT_STATE,
  concurrency = 4,
  onSessionStart = (..._args) => {},
  onSessionComplete = (..._args) => {},
  onMasterSaved = (..._args) => {},
}) {
  const validSessions = (sessions ?? []).filter((session) => {
    const sid = Number(session?.session_id);
    return Number.isSafeInteger(sid) && sid > 0;
  });
  if (validSessions.length === 0) {
    return Promise.resolve({
      completedAt: new Date().toISOString(),
      failures: [],
      results: [],
      totalBills: 0,
    });
  }

  const syncKey = `${state}:${validSessions
    .map((session) => session.session_id)
    .join(",")}`;
  const existing = pendingAllSessionSyncs.get(syncKey);
  if (existing) return existing;

  const task = (async () => {
    const results = new Array(validSessions.length);
    let cursor = 0;
    let completed = 0;
    const workerCount = Math.min(
      validSessions.length,
      Math.max(1, Number(concurrency) || 1),
    );

    const worker = async () => {
      while (cursor < validSessions.length) {
        const index = cursor;
        cursor += 1;
        const session = validSessions[index];
        onSessionStart(session, index, validSessions.length);
        try {
          const result = await syncBillsForSession({
            sessionId: session.session_id,
            session,
            state,
            masterOnly: true,
            sponsorEnrichmentLimit: 0,
            onMasterSaved: (bills) => onMasterSaved(session, bills),
          });
          results[index] = { session, result, error: null };
        } catch (error) {
          results[index] = { session, result: null, error };
        } finally {
          completed += 1;
          onSessionComplete(
            session,
            results[index],
            completed,
            validSessions.length,
          );
        }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    const failures = results.filter((entry) => entry?.error);
    return {
      completedAt: new Date().toISOString(),
      failures,
      results,
      totalBills: results.reduce(
        (sum, entry) => sum + (entry?.result?.total ?? 0),
        0,
      ),
    };
  })().finally(() => {
    if (pendingAllSessionSyncs.get(syncKey) === task) {
      pendingAllSessionSyncs.delete(syncKey);
    }
  });

  pendingAllSessionSyncs.set(syncKey, task);
  return task;
}
