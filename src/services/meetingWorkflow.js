import { supabase } from "@/lib/supabase";

const validSessionId = (value) => {
  const sessionId = Number(value);
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
    throw new Error("A valid legislative session is required.");
  }
  return sessionId;
};

const currentUserId = async () => {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.user?.id) throw new Error("Not authenticated");
  return data.session.user.id;
};

export const normalizeMeetingBillNumber = (value) =>
  String(value || "")
    .replace(/\s+/g, "")
    .toUpperCase();

export const meetingWorkspaceUrl = (meeting, sessionId, state = "GA") => {
  const query = new URLSearchParams({
    meetingId: String(meeting?.id || ""),
    sessionId: String(validSessionId(sessionId)),
    state,
  });
  return `/MeetingWorkspace?${query.toString()}`;
};

export const committeeAssignments = {
  async list(sessionId, state = "GA") {
    const userId = await currentUserId();
    const { data, error } = await supabase
      .from("user_committee_assignments")
      .select("*")
      .eq("user_id", userId)
      .eq("state", state)
      .eq("session_id", validSessionId(sessionId))
      .order("committee_name", { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  async set(committee, assigned, sessionId, state = "GA") {
    const userId = await currentUserId();
    const committeeId = String(committee?.id ?? committee?.committee_id ?? "");
    if (!committeeId) throw new Error("A committee is required.");
    const identity = {
      user_id: userId,
      state,
      session_id: validSessionId(sessionId),
      committee_id: committeeId,
    };
    if (!assigned) {
      const { error } = await supabase
        .from("user_committee_assignments")
        .delete()
        .match(identity);
      if (error) throw error;
      return false;
    }
    const { error } = await supabase
      .from("user_committee_assignments")
      .upsert(
        {
          ...identity,
          committee_name:
            committee?.name ?? committee?.committee_name ?? "Committee",
        },
        { onConflict: "user_id,state,session_id,committee_id" },
      );
    if (error) throw error;
    return true;
  },
};

export const meetingAgenda = {
  async getMeeting(meetingId, sessionId, state = "GA") {
    const sid = validSessionId(sessionId);
    const rawId = String(meetingId || "");
    const cacheId = rawId.startsWith(`${state}:${sid}:`)
      ? rawId
      : `${state}:${sid}:${rawId}`;
    const { data, error } = await supabase
      .from("ga_meetings_cache")
      .select("*")
      .eq("state", state)
      .eq("session_id", sid)
      .eq("id", cacheId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const stored = data.data && typeof data.data === "object" ? data.data : {};
    return {
      ...stored,
      id: stored.id ?? rawId,
      title: stored.title ?? data.title,
      description: stored.description ?? data.description ?? "",
      start_time: stored.start_time ?? data.start_time,
      end_time: stored.end_time ?? data.end_time,
      location: stored.location ?? data.location ?? "",
      classification:
        stored.classification ?? data.classification ?? "Committee Meeting",
      chamber: stored.chamber ?? data.chamber,
      agendaUrl: stored.agendaUrl ?? data.agenda_url,
      videoUrl: stored.videoUrl ?? data.video_url,
      provider_session_id: stored.provider_session_id ?? null,
      _source: stored._source ?? "legis-ga",
    };
  },

  async getWorkspace(meetingId, sessionId, state = "GA") {
    const userId = await currentUserId();
    const { data, error } = await supabase
      .from("meeting_agenda_workspaces")
      .select("*")
      .eq("user_id", userId)
      .eq("state", state)
      .eq("session_id", validSessionId(sessionId))
      .eq("meeting_id", String(meetingId))
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async ensure(meeting, officialBills, sessionId, state = "GA") {
    const userId = await currentUserId();
    const sid = validSessionId(sessionId);
    const meetingId = String(meeting?.id || "");
    if (!meetingId || !meeting?.start_time) {
      throw new Error("Meeting details are incomplete.");
    }
    let workspace = await this.getWorkspace(meetingId, sid, state);
    if (!workspace) {
      const officialNumbers = (officialBills ?? []).map((bill) =>
        normalizeMeetingBillNumber(
          bill?.bill_number ?? bill?.identifier ?? bill,
        ),
      );
      const { data, error } = await supabase
        .from("meeting_agenda_workspaces")
        .insert({
          user_id: userId,
          state,
          session_id: sid,
          provider_session_id: meeting.provider_session_id ?? null,
          meeting_id: meetingId,
          committee_id: meeting.committeeId
            ? String(meeting.committeeId)
            : null,
          committee_name: meeting.committeeName ?? meeting.title ?? "Committee",
          meeting_title: meeting.title ?? "Committee Meeting",
          meeting_start: meeting.start_time,
          location: meeting.location || null,
          agenda_url: meeting.agendaUrl || null,
          official_agenda_bill_numbers: officialNumbers,
        })
        .select()
        .single();
      if (error) {
        if (error.code !== "23505") throw error;
        workspace = await this.getWorkspace(meetingId, sid, state);
      } else {
        workspace = data;
      }
    }

    const { count, error: countError } = await supabase
      .from("meeting_agenda_items")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id);
    if (countError) throw countError;
    if (!count && officialBills?.length) {
      const rows = officialBills.map((bill, position) => ({
        workspace_id: workspace.id,
        bill_number: normalizeMeetingBillNumber(
          bill?.bill_number ?? bill?.identifier ?? bill,
        ),
        bill_id: bill?.id ? String(bill.id) : null,
        bill_title: bill?.title || null,
        position,
        source: "official",
      }));
      const { error } = await supabase
        .from("meeting_agenda_items")
        .upsert(rows, { onConflict: "workspace_id,bill_number" });
      if (error) throw error;
    }
    return workspace;
  },

  async listItems(workspaceId) {
    const { data, error } = await supabase
      .from("meeting_agenda_items")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  async addItem(workspaceId, bill, position) {
    const { data, error } = await supabase
      .from("meeting_agenda_items")
      .insert({
        workspace_id: workspaceId,
        bill_number: normalizeMeetingBillNumber(bill?.bill_number),
        bill_id: bill?.id ? String(bill.id) : null,
        bill_title: bill?.title || null,
        position,
        source: "manual",
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async removeItem(itemId) {
    const { error } = await supabase
      .from("meeting_agenda_items")
      .delete()
      .eq("id", itemId);
    if (error) throw error;
  },

  async reorderItems(items) {
    await Promise.all(
      items.map(async (item, position) => {
        const { error } = await supabase
          .from("meeting_agenda_items")
          .update({ position })
          .eq("id", item.id);
        if (error) throw error;
      }),
    );
  },

  async reset(workspace) {
    const { error: deleteError } = await supabase
      .from("meeting_agenda_items")
      .delete()
      .eq("workspace_id", workspace.id);
    if (deleteError) throw deleteError;
    const numbers = workspace.official_agenda_bill_numbers ?? [];
    if (!numbers.length) return;
    const { error } = await supabase.from("meeting_agenda_items").insert(
      numbers.map((billNumber, position) => ({
        workspace_id: workspace.id,
        bill_number: normalizeMeetingBillNumber(billNumber),
        position,
        source: "official",
      })),
    );
    if (error) throw error;
  },
};

export const meetingNotes = {
  async getMine(meetingId, billNumber, sessionId, state = "GA") {
    const userId = await currentUserId();
    const { data, error } = await supabase
      .from("meeting_notes")
      .select("*")
      .eq("author_id", userId)
      .eq("state", state)
      .eq("session_id", validSessionId(sessionId))
      .eq("meeting_id", String(meetingId))
      .eq("bill_number", normalizeMeetingBillNumber(billNumber))
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async save(note, sessionId, state = "GA") {
    const userId = await currentUserId();
    const payload = {
      author_id: userId,
      state,
      session_id: validSessionId(sessionId),
      meeting_id: String(note.meeting_id),
      meeting_title: note.meeting_title,
      meeting_start: note.meeting_start,
      committee_id: note.committee_id ? String(note.committee_id) : null,
      committee_name: note.committee_name,
      bill_number: normalizeMeetingBillNumber(note.bill_number),
      bill_id: note.bill_id ? String(note.bill_id) : null,
      bill_title: note.bill_title || null,
      body_html: note.body_html || "",
      visibility: note.visibility === "team" ? "team" : "private",
      team_id: note.visibility === "team" ? note.team_id : null,
    };
    const { data, error } = await supabase
      .from("meeting_notes")
      .upsert(payload, {
        onConflict: "author_id,state,session_id,meeting_id,bill_number",
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async listForTeam(teamId, sessionId, state = "GA") {
    const { data, error } = await supabase
      .from("meeting_notes")
      .select("*")
      .eq("team_id", teamId)
      .eq("visibility", "team")
      .eq("state", state)
      .eq("session_id", validSessionId(sessionId))
      .order("meeting_start", { ascending: false })
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async listComments(noteIds) {
    if (!noteIds?.length) return [];
    const { data, error } = await supabase
      .from("meeting_note_comments")
      .select("*")
      .in("note_id", noteIds)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  async addComment(noteId, body) {
    const userId = await currentUserId();
    const { data, error } = await supabase
      .from("meeting_note_comments")
      .insert({ note_id: noteId, author_id: userId, body: body.trim() })
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};
