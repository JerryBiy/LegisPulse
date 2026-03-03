// API client for LegisTrack
// Data layer backed by Supabase (PostgreSQL + Auth).
// Keeps the same public interface so existing components need no changes.

import { supabase } from "@/lib/supabase";

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
const OPENAI_MODEL = import.meta.env.VITE_OPENAI_MODEL || "gpt-4o";
const OPENAI_BASE_URL =
  import.meta.env.VITE_OPENAI_BASE_URL || "https://api.openai.com/v1";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns the current authenticated user's UUID, throws if not signed in. */
const getUserId = async () => {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) throw new Error("Not authenticated");
  return session.user.id;
};

const sortByField = (items, sortKey) => {
  if (!sortKey) return items;
  const direction = sortKey.startsWith("-") ? -1 : 1;
  const key = sortKey.replace(/^-/, "");
  return [...items].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av === bv) return 0;
    return av > bv ? direction : -direction;
  });
};

const extractJsonObject = (text) => {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    // Try extracting fenced JSON first
    const fencedMatch = text.match(/```json\s*([\s\S]*?)\s*```/i);
    if (fencedMatch?.[1]) {
      try {
        return JSON.parse(fencedMatch[1]);
      } catch {
        // continue
      }
    }

    // Fallback: first object-like block
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch?.[0]) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
};

export const api = {
  // ─── Auth ───────────────────────────────────────────────────────────────────
  auth: {
    async me() {
      const userId = await getUserId();
      const { data: session } = await supabase.auth.getSession();
      const supabaseUser = session?.session?.user;

      // Try to fetch existing profile
      const { data: existing, error: fetchError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();

      if (fetchError) throw fetchError;

      // Profile exists — return it as-is (preserves tracked_bill_ids)
      if (existing) {
        return {
          id: existing.id,
          name: existing.name,
          email: existing.email,
          tracked_bill_ids: existing.tracked_bill_ids ?? [],
        };
      }

      // No profile yet (trigger missed) — create it now
      const { data: created, error: createError } = await supabase
        .from("profiles")
        .insert({
          id: userId,
          email: supabaseUser?.email ?? null,
          name:
            supabaseUser?.user_metadata?.name ??
            supabaseUser?.email?.split("@")[0] ??
            "User",
          tracked_bill_ids: [],
        })
        .select()
        .single();
      if (createError) throw createError;
      return {
        id: created.id,
        name: created.name,
        email: created.email,
        tracked_bill_ids: [],
      };
    },

    async updateMe(patch) {
      const userId = await getUserId();
      const updatePayload = {};
      if (patch.name !== undefined) updatePayload.name = patch.name;
      if (patch.email !== undefined) updatePayload.email = patch.email;
      if (patch.tracked_bill_ids !== undefined)
        updatePayload.tracked_bill_ids = patch.tracked_bill_ids;

      const { data, error } = await supabase
        .from("profiles")
        .update(updatePayload)
        .eq("id", userId)
        .select()
        .single();
      if (error) throw error;
      return {
        id: data.id,
        name: data.name,
        email: data.email,
        tracked_bill_ids: data.tracked_bill_ids ?? [],
      };
    },

    async logout() {
      await supabase.auth.signOut();
    },

    redirectToLogin() {
      return Promise.resolve();
    },
  },

  // ─── Entities ──────────────────────────────────────────────────────────────
  entities: {
    Bill: {
      async list(sortKey = "-last_action_date") {
        const userId = await getUserId();
        const PAGE_SIZE = 1000;
        let allBills = [];
        let from = 0;

        while (true) {
          const { data, error } = await supabase
            .from("bills")
            .select("*")
            .eq("user_id", userId)
            .range(from, from + PAGE_SIZE - 1);

          if (error) throw error;
          if (!data || data.length === 0) break;
          allBills = allBills.concat(data);
          if (data.length < PAGE_SIZE) break;
          from += PAGE_SIZE;
        }

        const key = sortKey.replace(/^-/, "");
        const dir = sortKey.startsWith("-") ? -1 : 1;
        return allBills.sort((a, b) => {
          if (a[key] === b[key]) return 0;
          return a[key] > b[key] ? dir : -dir;
        });
      },

      async replaceAll(payloads) {
        const userId = await getUserId();
        const now = Date.now();
        const bills = payloads.map((payload, idx) => ({
          id:
            payload.id ||
            `bill-${payload.bill_number?.replace(/\s+/g, "-")}-${now}-${idx}`,
          user_id: userId,
          ...payload,
          created_date: payload.created_date || new Date().toISOString(),
        }));

        // Delete all existing bills for this user, then insert new ones
        await supabase.from("bills").delete().eq("user_id", userId);
        if (bills.length === 0) return [];

        const { data, error } = await supabase
          .from("bills")
          .insert(bills)
          .select();
        if (error) throw error;
        return data ?? [];
      },

      async create(payload) {
        const userId = await getUserId();
        const id =
          payload.id ||
          `bill-${payload.bill_number?.replace(/\s+/g, "-")}-${Date.now()}`;
        const newBill = {
          id,
          user_id: userId,
          ...payload,
          created_date: payload.created_date || new Date().toISOString(),
        };
        const { data, error } = await supabase
          .from("bills")
          .insert(newBill)
          .select()
          .single();
        if (error) throw error;
        return data;
      },

      async update(id, patch) {
        const userId = await getUserId();
        const { data, error } = await supabase
          .from("bills")
          .update(patch)
          .eq("id", id)
          .eq("user_id", userId)
          .select()
          .single();
        if (error) throw error;
        return data;
      },

      async delete(id) {
        const userId = await getUserId();
        const { error } = await supabase
          .from("bills")
          .delete()
          .eq("id", id)
          .eq("user_id", userId);
        if (error) throw error;
        return { success: true };
      },

      async clearAll() {
        const userId = await getUserId();
        const { error } = await supabase
          .from("bills")
          .delete()
          .eq("user_id", userId);
        if (error) throw error;
        return { success: true };
      },
    },

    EmailList: {
      async list(sortKey = "-created_date") {
        const userId = await getUserId();
        const { data, error } = await supabase
          .from("email_lists")
          .select("*")
          .eq("user_id", userId);
        if (error) throw error;
        return sortByField(data ?? [], sortKey);
      },

      async create(payload) {
        const userId = await getUserId();
        const id = payload.id || `list-${Date.now()}`;
        const newList = {
          id,
          user_id: userId,
          ...payload,
          created_date: payload.created_date || new Date().toISOString(),
        };
        const { data, error } = await supabase
          .from("email_lists")
          .insert(newList)
          .select()
          .single();
        if (error) throw error;
        return data;
      },
    },

    Notification: {
      async list(sortKey = "-created_date", limit = 50) {
        const userId = await getUserId();
        const { data, error } = await supabase
          .from("notifications")
          .select("*")
          .eq("user_id", userId)
          .limit(limit);
        if (error) throw error;
        return sortByField(data ?? [], sortKey);
      },

      async create(payload) {
        const userId = await getUserId();
        const newNotification = {
          id: payload.id || `notif-${Date.now()}`,
          user_id: userId,
          ...payload,
          created_date: payload.created_date || new Date().toISOString(),
        };
        const { data, error } = await supabase
          .from("notifications")
          .insert(newNotification)
          .select()
          .single();
        if (error) throw error;
        return { status: "sent", ...data };
      },
    },

    Tweet: {
      async list(sortKey = "-posted_at", limit = 50) {
        const userId = await getUserId();
        const { data, error } = await supabase
          .from("tweets")
          .select("*")
          .eq("user_id", userId)
          .limit(limit);
        if (error) throw error;
        return sortByField(data ?? [], sortKey);
      },
    },

    /** Personal bill metadata (flag + notes, per-user, separate from team). */
    UserBillMeta: {
      /** Fetch all personal metadata rows for the current user. Returns map keyed by bill_number. */
      async getAll() {
        const userId = await getUserId();
        const { data, error } = await supabase
          .from("user_bill_metadata")
          .select("bill_number, flag, bill_summary_notes")
          .eq("user_id", userId);
        if (error) throw error;
        const map = {};
        for (const row of data ?? []) {
          map[row.bill_number] = {
            flag: row.flag ?? null,
            bill_summary_notes: row.bill_summary_notes ?? "",
          };
        }
        return map;
      },

      /** Upsert metadata for a specific bill. */
      async update(billNumber, fields) {
        const userId = await getUserId();
        const { error } = await supabase.from("user_bill_metadata").upsert(
          {
            user_id: userId,
            bill_number: billNumber,
            ...fields,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,bill_number" },
        );
        if (error) throw error;
      },
    },

    Team: {
      async getOrCreate() {
        const userId = await getUserId();
        const { data: sessionData } = await supabase.auth.getSession();
        const email = sessionData?.session?.user?.email ?? "";

        // Check for pending invites FIRST — before creating anything
        // Use RPC to bypass RLS (security definer function)
        const { data: pending, error: pendingErr } = await supabase.rpc(
          "get_my_pending_invites",
        );
        if (pendingErr)
          console.error("[Team] get_my_pending_invites error:", pendingErr);
        if (pending && pending.length > 0) {
          // Detect current team situation so the UI can show the right warning
          // Check member role first
          const { data: currentMembership } = await supabase
            .from("team_members")
            .select("team_id, teams(name)")
            .eq("user_id", userId)
            .eq("status", "active")
            .eq("role", "member")
            .maybeSingle();
          if (currentMembership?.teams?.name) {
            return {
              __pendingInvite: true,
              __currentTeamName: currentMembership.teams.name,
              __isOwner: false,
              __ownedTeamMemberCount: 0,
            };
          }
          // Check owner role
          const { data: ownedTeam } = await supabase
            .from("teams")
            .select("id, name")
            .eq("created_by", userId)
            .maybeSingle();
          if (ownedTeam) {
            const { count } = await supabase
              .from("team_members")
              .select("id", { count: "exact", head: true })
              .eq("team_id", ownedTeam.id)
              .eq("status", "active")
              .eq("role", "member");
            return {
              __pendingInvite: true,
              __currentTeamName: ownedTeam.name,
              __isOwner: true,
              __ownedTeamMemberCount: count ?? 0,
            };
          }
          return {
            __pendingInvite: true,
            __currentTeamName: null,
            __isOwner: false,
            __ownedTeamMemberCount: 0,
          };
        }

        // Check if user is an active MEMBER of someone else's team (invited)
        // This takes priority over ownership so invited users see the shared team
        const { data: membership, error: memberErr } = await supabase
          .from("team_members")
          .select("team_id, teams(*)")
          .eq("user_id", userId)
          .eq("status", "active")
          .eq("role", "member")
          .maybeSingle();
        if (memberErr) throw memberErr;
        if (membership?.teams) return membership.teams;

        // Check if user owns a team
        const { data: owned, error: ownedErr } = await supabase
          .from("teams")
          .select("*")
          .eq("created_by", userId)
          .maybeSingle();
        if (ownedErr) throw ownedErr;
        if (owned) return owned;

        // Auto-create a new team
        const firstName = email.split("@")[0] || "My";
        const { data: newTeam, error } = await supabase
          .from("teams")
          .insert({ name: `${firstName}'s Team`, created_by: userId })
          .select()
          .single();
        if (error) throw error;

        // Add self as owner member
        await supabase.from("team_members").insert({
          team_id: newTeam.id,
          user_id: userId,
          email,
          role: "owner",
          status: "active",
        });
        return newTeam;
      },

      // Returns ALL teams the user belongs to (as owner or active member).
      // Also includes a __pendingInvites array when pending invites exist.
      async getAll() {
        const userId = await getUserId();

        // 1) Check pending invites
        const { data: pending } = await supabase.rpc("get_my_pending_invites");
        const hasPending = pending && pending.length > 0;

        // 2) Fetch all teams via active memberships
        const { data: memberships, error: memErr } = await supabase
          .from("team_members")
          .select("team_id, role, teams(*)")
          .eq("user_id", userId)
          .eq("status", "active");
        if (memErr) throw memErr;

        const teams = (memberships ?? [])
          .filter((m) => m.teams)
          .map((m) => ({ ...m.teams, _role: m.role }));

        return {
          teams,
          __pendingInvites: hasPending
            ? (pending ?? []).map((r) => ({
                id: r.id,
                team_id: r.team_id,
                email: r.invite_email,
                role: r.role,
                status: r.status,
                teams: { name: r.team_name },
              }))
            : [],
        };
      },

      // Legacy single-team getter — kept for Layout sidebar compatibility
      async get() {
        const { teams } = await api.entities.Team.getAll();
        return teams.length > 0 ? teams[0] : null;
      },

      async createTeam(name) {
        const userId = await getUserId();
        const { data: sessionData } = await supabase.auth.getSession();
        const email = sessionData?.session?.user?.email ?? "";
        if (!name || !name.trim()) throw new Error("Team name is required.");
        const teamName = name.trim();
        const { data: newTeam, error } = await supabase
          .from("teams")
          .insert({ name: teamName, created_by: userId })
          .select()
          .single();
        if (error) throw error;
        await supabase.from("team_members").insert({
          team_id: newTeam.id,
          user_id: userId,
          email,
          role: "owner",
          status: "active",
        });
        return newTeam;
      },

      async joinByCode(code) {
        const { data, error } = await supabase.rpc("join_team_by_code", {
          p_code: (code ?? "").trim().toUpperCase(),
        });
        if (error) throw error;
        // Return the full team object
        const { data: team, error: teamErr } = await supabase
          .from("teams")
          .select("*")
          .eq("id", data)
          .single();
        if (teamErr) throw teamErr;
        return team;
      },

      async acceptPendingInvites() {
        const { error } = await supabase.rpc("accept_my_team_invites");
        if (error) throw error;
      },

      async getPendingInvites() {
        const { data, error } = await supabase.rpc("get_my_pending_invites");
        if (error) throw error;
        // Normalize to match UI expectations: { id, teams: { name } }
        return (data ?? []).map((r) => ({
          id: r.id,
          team_id: r.team_id,
          email: r.invite_email,
          role: r.role,
          status: r.status,
          teams: { name: r.team_name },
        }));
      },

      async getMembers(teamId) {
        const { data, error } = await supabase
          .from("team_members")
          .select("*")
          .eq("team_id", teamId)
          .order("joined_at");
        if (error) throw error;
        return data ?? [];
      },

      async inviteMember(teamId, email) {
        const { data, error } = await supabase
          .from("team_members")
          .insert({
            team_id: teamId,
            email: email.toLowerCase().trim(),
            role: "member",
            status: "pending",
            user_id: null,
          })
          .select()
          .single();
        if (error) throw error;
        return data;
      },

      async removeMember(memberId) {
        // Use security definer RPC so owner can delete any member in their team
        const { error } = await supabase.rpc("remove_team_member", {
          member_id: memberId,
        });
        if (error) throw error;
      },

      async declineInvite(inviteId) {
        const { error } = await supabase.rpc("decline_my_team_invite", {
          invite_id: inviteId,
        });
        if (error) throw error;
      },

      async leaveTeam(teamId) {
        const { error } = await supabase.rpc("leave_my_team", {
          p_team_id: teamId,
        });
        if (error) throw error;
      },

      async renameTeam(teamId, name) {
        const { error } = await supabase.rpc("rename_team", {
          p_team_id: teamId,
          p_name: name,
        });
        if (error) throw error;
      },

      async approveJoinRequest(memberId) {
        const { error } = await supabase.rpc("approve_join_request", {
          p_member_id: memberId,
        });
        if (error) throw error;
      },

      async declineJoinRequest(memberId) {
        const { error } = await supabase.rpc("decline_join_request", {
          p_member_id: memberId,
        });
        if (error) throw error;
      },

      async getBillNumbers(teamId) {
        const { data, error } = await supabase
          .from("team_bills")
          .select("bill_number")
          .eq("team_id", teamId);
        if (error) throw error;
        return (data ?? []).map((r) => r.bill_number);
      },

      async addBill(teamId, billNumber) {
        const userId = await getUserId();
        const { error } = await supabase
          .from("team_bills")
          .upsert(
            { team_id: teamId, bill_number: billNumber, added_by: userId },
            { onConflict: "team_id,bill_number" },
          );
        if (error) throw error;
      },

      async removeBill(teamId, billNumber) {
        const { error } = await supabase
          .from("team_bills")
          .delete()
          .eq("team_id", teamId)
          .eq("bill_number", billNumber);
        if (error) throw error;
      },

      /** Fetch all team_bills rows with metadata (flag, policy_assistant, notes). */
      async getBillMetadata(teamId) {
        const { data, error } = await supabase
          .from("team_bills")
          .select("bill_number, flag, policy_assistant, bill_summary_notes")
          .eq("team_id", teamId);
        if (error) throw error;
        // Return a map keyed by bill_number for fast lookup.
        const map = {};
        for (const row of data ?? []) {
          map[row.bill_number] = {
            flag: row.flag ?? null,
            policy_assistant: row.policy_assistant ?? null,
            bill_summary_notes: row.bill_summary_notes ?? "",
          };
        }
        return map;
      },

      /** Update metadata on a single team bill row. `fields` can contain flag, policy_assistant, bill_summary_notes. */
      async updateBillMetadata(teamId, billNumber, fields) {
        const { error } = await supabase
          .from("team_bills")
          .update(fields)
          .eq("team_id", teamId)
          .eq("bill_number", billNumber);
        if (error) throw error;
      },

      /**
       * Get notification counts for the Team nav badge.
       * @param {string|null} lastChatVisit - ISO timestamp of last Team page visit (for unread chat)
       * @returns {{ pendingInvites: number, joinRequests: number, unreadChats: number }}
       */
      async getTeamNotifications(lastChatVisit = null) {
        const userId = await getUserId();

        // 1) Pending invites for me
        const { data: pending } = await supabase.rpc("get_my_pending_invites");
        const pendingInvites = pending?.length ?? 0;

        // 2) My active memberships (to find owned teams + active team IDs)
        const { data: memberships } = await supabase
          .from("team_members")
          .select("team_id, role, teams!inner(created_by)")
          .eq("user_id", userId)
          .eq("status", "active");

        const ownedTeamIds = (memberships ?? [])
          .filter((m) => m.teams?.created_by === userId)
          .map((m) => m.team_id);
        const allTeamIds = (memberships ?? []).map((m) => m.team_id);

        // 3) Join requests in teams I own
        let joinRequests = 0;
        if (ownedTeamIds.length > 0) {
          const { count } = await supabase
            .from("team_members")
            .select("id", { count: "exact", head: true })
            .in("team_id", ownedTeamIds)
            .eq("status", "pending_approval");
          joinRequests = count ?? 0;
        }

        // 4) Unread chat messages since last Team page visit
        let unreadChats = 0;
        if (allTeamIds.length > 0 && lastChatVisit) {
          const { count } = await supabase
            .from("team_chat_messages")
            .select("id", { count: "exact", head: true })
            .in("team_id", allTeamIds)
            .gt("created_at", lastChatVisit)
            .neq("user_id", userId);
          unreadChats = count ?? 0;
        }

        return { pendingInvites, joinRequests, unreadChats };
      },

      /**
       * Get full details of pending join requests for teams I own.
       * Returns array of { id, team_id, email, teamName }.
       */
      async getPendingJoinRequests() {
        const userId = await getUserId();

        const { data, error } = await supabase
          .from("team_members")
          .select("id, team_id, email, teams!inner(name, created_by)")
          .eq("status", "pending_approval")
          .eq("teams.created_by", userId);

        if (error) throw error;

        return (data ?? []).map((r) => ({
          id: r.id,
          team_id: r.team_id,
          email: r.email,
          teamName: r.teams?.name ?? "Unknown team",
        }));
      },
    },

    TeamChat: {
      /** Fetch messages for a team via a SECURITY DEFINER RPC — bypasses RLS entirely. */
      async getMessages(teamId) {
        const { data, error } = await supabase.rpc("get_team_chat_messages", {
          p_team_id: teamId,
        });
        if (error) throw error;
        return (data ?? []).map((m) => ({
          ...m,
          profiles: { name: m.sender_name, email: m.sender_email },
        }));
      },

      /** Enrich a bare realtime message row with its sender's profile. */
      async enrichMessage(msg, teamId) {
        const { data: profiles } = await supabase.rpc(
          "get_team_member_profiles",
          { p_team_id: teamId },
        );
        const profile =
          (profiles ?? []).find((p) => p.id === msg.user_id) ?? null;
        return { ...msg, profiles: profile };
      },

      /** Upload a file to Supabase Storage, returns { url, name, type, size }. */
      async uploadFile(teamId, file) {
        const userId = await getUserId();
        const ext = file.name.split(".").pop();
        const path = `${userId}/${teamId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error } = await supabase.storage
          .from("team-chat-files")
          .upload(path, file, { cacheControl: "3600", upsert: false });
        if (error) throw error;
        const { data: urlData } = supabase.storage
          .from("team-chat-files")
          .getPublicUrl(path);
        return {
          url: urlData.publicUrl,
          name: file.name,
          type: file.type,
          size: file.size,
        };
      },

      /** Send a message with optional attachment. */
      async sendMessage(teamId, message, attachment = null) {
        const params = {
          p_team_id: teamId,
          p_message: (message || "").trim(),
          p_attachment_url: attachment?.url ?? null,
          p_attachment_name: attachment?.name ?? null,
          p_attachment_type: attachment?.type ?? null,
          p_attachment_size: attachment?.size ?? null,
        };
        const { data, error } = await supabase.rpc(
          "send_team_chat_message",
          params,
        );
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) throw new Error("Message was not saved.");
        return {
          ...row,
          profiles: { name: row.sender_name, email: row.sender_email },
        };
      },

      /** Delete one of your own messages. */
      async deleteMessage(messageId) {
        const { error } = await supabase
          .from("team_chat_messages")
          .delete()
          .eq("id", messageId);
        if (error) throw error;
      },

      /** Subscribe to real-time new messages for a team. Returns the channel so it can be unsubscribed. */
      subscribeToMessages(teamId, onInsert) {
        return supabase
          .channel(`team_chat_${teamId}`)
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "team_chat_messages",
              filter: `team_id=eq.${teamId}`,
            },
            (payload) => onInsert(payload.new),
          )
          .subscribe();
      },
    },
  },

  // ─── Integrations ──────────────────────────────────────────────────────────
  integrations: {
    Core: {
      async InvokeLLM(params) {
        if (!OPENAI_API_KEY) {
          throw new Error(
            "AI is not configured. Add VITE_OPENAI_API_KEY to your .env file.",
          );
        }

        const expectsJson = Boolean(params?.response_json_schema);
        const systemPrompt = expectsJson
          ? "You are a helpful policy analysis assistant. Return ONLY valid JSON matching the requested schema. Do not include markdown fences or extra commentary."
          : "You are a helpful policy analysis assistant.";

        console.groupCollapsed("[AI Debug] Outgoing OpenAI request");
        console.log("Model", OPENAI_MODEL);
        console.log("Base URL", OPENAI_BASE_URL);
        console.log("Temperature", params?.temperature ?? 0.2);
        console.log("Expects JSON", expectsJson);
        console.log(
          "User prompt length",
          typeof params?.prompt === "string" ? params.prompt.length : 0,
        );
        console.log(
          "User prompt preview (start)",
          typeof params?.prompt === "string"
            ? params.prompt.slice(0, 2000)
            : "",
        );
        console.log(
          "User prompt preview (end)",
          typeof params?.prompt === "string"
            ? params.prompt.length > 2000
              ? params.prompt.slice(-2000)
              : params.prompt
            : "",
        );
        console.groupEnd();

        const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: OPENAI_MODEL,
            temperature: params?.temperature ?? 0.2,
            response_format: expectsJson ? { type: "json_object" } : undefined,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: params?.prompt || "" },
            ],
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `LLM request failed (${response.status}): ${errorText.slice(0, 300)}`,
          );
        }

        const responseData = await response.json();
        const content = responseData?.choices?.[0]?.message?.content || "";

        if (expectsJson) {
          const parsed = extractJsonObject(content);
          if (!parsed || typeof parsed !== "object") {
            throw new Error("LLM returned an invalid JSON response.");
          }
          return parsed;
        }

        return {
          text: content,
          usage: responseData?.usage,
        };
      },
    },
  },

  // ─── Calendar Events ────────────────────────────────────────────────────────
  calendarEvents: {
    /** List events in a date range */
    async list(startDate, endDate) {
      const userId = await getUserId();
      let query = supabase
        .from("calendar_events")
        .select("*")
        .eq("user_id", userId)
        .order("start_time", { ascending: true });

      if (startDate) query = query.gte("start_time", startDate);
      if (endDate) query = query.lte("start_time", endDate);

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },

    /** Create a new event */
    async create(event) {
      const userId = await getUserId();
      const { data, error } = await supabase
        .from("calendar_events")
        .insert({ ...event, user_id: userId })
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    /** Update an existing event */
    async update(id, patch) {
      const userId = await getUserId();
      const { data, error } = await supabase
        .from("calendar_events")
        .update(patch)
        .eq("id", id)
        .eq("user_id", userId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    /** Delete an event */
    async delete(id) {
      const userId = await getUserId();
      const { error } = await supabase
        .from("calendar_events")
        .delete()
        .eq("id", id)
        .eq("user_id", userId);
      if (error) throw error;
    },
  },

  // ─── App Logs ──────────────────────────────────────────────────────────────
  appLogs: {
    async logUserInApp(pageName) {
      console.debug("User navigated to:", pageName);
      return { success: true };
    },
  },
};
