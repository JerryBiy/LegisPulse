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
          return { __pendingInvite: true };
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

  // ─── App Logs ──────────────────────────────────────────────────────────────
  appLogs: {
    async logUserInApp(pageName) {
      console.debug("User navigated to:", pageName);
      return { success: true };
    },
  },
};
