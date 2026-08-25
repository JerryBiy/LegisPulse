// src/services/gaMeetingsCache.js
//
// Supabase-backed cache for legis.ga.gov meetings.
// ─────────────────────────────────────────────────────────────
// The upstream API only returns meetings within a relatively
// short window and drops past entries once they're stale. We
// mirror everything we ever fetch into `public.ga_meetings_cache`
// so the calendar can show the full session history, and so
// reschedules (e.g. floor sessions running long pushing all
// later committee meetings back) get applied in-place.

import { supabase } from "@/lib/supabase";
import { fetchGAMeetings } from "./legisGa";

const TABLE = "ga_meetings_cache";

/**
 * Beginning of the current Georgia General Assembly session window
 * we want to keep cached. The GA convenes on the second Monday of
 * January, so Jan 1 of the current year is a safe lower bound.
 */
export function getSessionStartDate(session) {
  const year = Number(session?.year_start) || new Date().getFullYear();
  return new Date(year, 0, 1);
}

// ─── Row <-> normalized meeting conversion ───────────────────

function meetingToRow(m, sessionId, state = "GA") {
  const legisId =
    typeof m.id === "string"
      ? Number(String(m.id).replace(/^legis-/, ""))
      : m.id;
  return {
    id: `${state}:${sessionId}:${m.id}`,
    state,
    session_id: Number(sessionId),
    legis_id: Number.isFinite(legisId) ? legisId : null,
    title: m.title ?? "Legislative Event",
    description: m.description || null,
    start_time: m.start_time,
    end_time: m.end_time ?? null,
    all_day: !!m.all_day,
    color: m.color ?? null,
    location: m.location || null,
    classification: m.classification ?? null,
    chamber: m.chamber ?? null,
    video_url: m.videoUrl ?? null,
    agenda_url: m.agendaUrl ?? null,
    schedule_url: m.scheduleUrl ?? null,
    will_broadcast: !!m.willBroadcast,
    is_vimeo: !!m.isVimeo,
    data: m,
    updated_at: new Date().toISOString(),
  };
}

function rowToMeeting(r) {
  // Prefer the full normalized blob we stashed in `data`.
  if (r.data && typeof r.data === "object") {
    return { ...r.data, _source: r.data._source || "legis-ga" };
  }
  return {
    id: r.id,
    title: r.title,
    description: r.description || "",
    start_time: r.start_time,
    end_time: r.end_time,
    all_day: r.all_day,
    color: r.color,
    location: r.location || "",
    location_url: "",
    classification: r.classification,
    bills: [],
    participants: [],
    links: r.agenda_url ? [{ url: r.agenda_url, note: "Agenda (PDF)" }] : [],
    videoUrl: r.video_url,
    agendaUrl: r.agenda_url,
    scheduleUrl: r.schedule_url,
    willBroadcast: r.will_broadcast,
    isVimeo: r.is_vimeo,
    chamber: r.chamber,
    _source: "legis-ga",
  };
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Read cached meetings whose start_time falls in [startIso, endIso].
 */
export async function fetchCachedMeetings(
  startIso,
  endIso,
  sessionId,
  state = "GA",
  providerSessionId = null,
) {
  if (!startIso || !endIso || !sessionId || !providerSessionId) return [];
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("state", state)
    .eq("session_id", Number(sessionId))
    .gte("start_time", startIso)
    .lte("start_time", endIso)
    .order("start_time", { ascending: true });
  if (error) {
    console.warn("Cached meetings fetch failed:", error.message);
    return [];
  }
  return (data ?? [])
    .filter(
      (row) =>
        Number(row?.data?.provider_session_id) === Number(providerSessionId),
    )
    .map(rowToMeeting);
}

/**
 * Upsert a batch of normalized meetings into the cache.
 * Existing rows are overwritten (so reschedules apply in-place).
 */
export async function upsertMeetings(meetings, sessionId, state = "GA") {
  if (!meetings?.length || !sessionId) return;
  const rows = meetings.map((meeting) =>
    meetingToRow(meeting, sessionId, state),
  );
  const { error } = await supabase
    .from(TABLE)
    .upsert(rows, { onConflict: "id" });
  if (error) throw new Error(`Meeting upsert failed: ${error.message}`);
}

/**
 * Fetch a date range from the legis.ga.gov API and upsert into the
 * cache. The range is chunked into ~30-day windows so a multi-month
 * sync doesn't depend on a single very large API response.
 *
 * Returns the union of all fetched (and upserted) meetings.
 */
export async function syncMeetingsRange(
  startDate,
  endDate,
  sessionId,
  state = "GA",
  providerSessionId = null,
) {
  if (!sessionId || !providerSessionId) return [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (!(start < end)) return [];

  const all = [];
  let cur = new Date(start);
  while (cur <= end) {
    const chunkEnd = new Date(cur);
    chunkEnd.setDate(chunkEnd.getDate() + 30);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());

    const chunk = await fetchGAMeetings(
      cur,
      chunkEnd,
      null,
      providerSessionId,
    );
    if (chunk.length) {
      all.push(...chunk);
      await upsertMeetings(chunk, sessionId, state);
    }
    cur = new Date(chunkEnd.getTime() + 24 * 60 * 60 * 1000);
  }
  return all;
}
