// API client for LegisTrack
// Data layer backed by Supabase (PostgreSQL + Auth).
// Keeps the same public interface so existing components need no changes.

import { supabase } from "@/lib/supabase";

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
const OPENAI_MODEL = import.meta.env.VITE_OPENAI_MODEL || "gpt-4o";
const OPENAI_BASE_URL =
  import.meta.env.VITE_OPENAI_BASE_URL || "https://api.openai.com/v1";
const DEFAULT_STATE = "GA";
const hydratedBillSessionKeys = new Set();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns the current authenticated user's UUID, throws if not signed in. */
const getUserId = async () => {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) throw new Error("Not authenticated");
  return session.user.id;
};

const requireSessionId = (sessionId) => {
  const value = Number(sessionId);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("A valid LegiScan session_id is required.");
  }
  return value;
};

const normalizeBillNumber = (billNumber) =>
  String(billNumber || "")
    .replace(/\s+/g, "")
    .toUpperCase();

const stripImmutableFields = (value, immutableFields) => {
  const mutable = {};
  for (const [key, fieldValue] of Object.entries(value ?? {})) {
    if (!immutableFields.has(key)) mutable[key] = fieldValue;
  }
  return mutable;
};

const BILL_IMMUTABLE_FIELDS = new Set([
  "id",
  "user_id",
  "state",
  "session_id",
  "session_name",
  "session",
  "session_year",
  "bill_number",
  "legiscan_id",
  "created_date",
]);

const USER_BILL_META_IMMUTABLE_FIELDS = new Set([
  "id",
  "user_id",
  "state",
  "session_id",
  "bill_number",
  "legiscan_id",
  "created_at",
  "updated_at",
]);

const CALENDAR_EVENT_IMMUTABLE_FIELDS = new Set([
  "id",
  "user_id",
  "state",
  "session_id",
  "created_at",
  "updated_at",
]);

const TEAM_BILL_IMMUTABLE_FIELDS = new Set([
  "id",
  "team_id",
  "state",
  "session_id",
  "bill_number",
  "legiscan_id",
  "added_by",
  "added_at",
]);

const TRANSCRIPT_IMMUTABLE_FIELDS = new Set([
  "id",
  "state",
  "session_id",
  "meeting_id",
  "created_by",
  "created_at",
  "updated_at",
]);

const normalizeEmailAddresses = (value) => [
  ...new Set(
    (Array.isArray(value) ? value : [])
      .map((email) => String(email ?? "").trim())
      .filter(Boolean),
  ),
];

const makeBillRef = ({
  state = DEFAULT_STATE,
  sessionId,
  legiscanId,
  billNumber,
}) =>
  `${state}:${requireSessionId(sessionId)}:${legiscanId || normalizeBillNumber(billNumber)}`;

const makeHydratedBillSessionKey = (userId, state, sessionId) =>
  `${userId}:${state}:${requireSessionId(sessionId)}`;

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
    formatProfile(profile) {
      return {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        username: profile.username ?? "",
        avatar_url: profile.avatar_url ?? "",
        phone_number: profile.phone_number ?? "",
        job_title: profile.job_title ?? "",
        organization: profile.organization ?? "",
        timezone: profile.timezone ?? "America/New_York",
        bio: profile.bio ?? "",
        tracked_bill_ids: profile.tracked_bill_ids ?? [],
        twitter_notifications_enabled:
          profile.twitter_notifications_enabled ?? true,
        phone_notifications_enabled:
          profile.phone_notifications_enabled ?? true,
        email_notifications_enabled:
          profile.email_notifications_enabled ?? true,
        notification_phone: profile.notification_phone ?? "",
        notification_preferences: profile.notification_preferences ?? {
          email_updates: true,
          bill_status_changes: true,
          new_bills: true,
        },
      };
    },

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
        return this.formatProfile(existing);
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
          username: supabaseUser?.email?.split("@")[0] ?? null,
          timezone: "America/New_York",
          tracked_bill_ids: [],
        })
        .select()
        .single();
      if (createError) throw createError;
      return this.formatProfile(created);
    },

    async updateMe(patch) {
      const userId = await getUserId();
      const allowedFields = [
        "name",
        "email",
        "username",
        "avatar_url",
        "phone_number",
        "job_title",
        "organization",
        "timezone",
        "bio",
        "twitter_notifications_enabled",
        "phone_notifications_enabled",
        "email_notifications_enabled",
        "notification_phone",
        "notification_preferences",
      ];
      const updatePayload = {};
      for (const field of allowedFields) {
        if (patch[field] !== undefined) {
          updatePayload[field] = patch[field];
        }
      }

      if (
        typeof updatePayload.username === "string" &&
        updatePayload.username.trim() === ""
      ) {
        updatePayload.username = null;
      }

      // Keep legacy profile.name aligned so existing UI paths continue to show the same identity.
      if (
        updatePayload.username !== undefined &&
        updatePayload.name === undefined
      ) {
        updatePayload.name = updatePayload.username;
      }

      const { data, error } = await supabase
        .from("profiles")
        .update(updatePayload)
        .eq("id", userId)
        .select()
        .single();
      if (error) throw error;
      return this.formatProfile(data);
    },

    async updatePassword({ currentPassword, newPassword }) {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user?.email) throw new Error("Unable to verify current user email.");

      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (reauthError) {
        throw new Error("Current password is incorrect.");
      }

      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) throw error;
      return { success: true };
    },

    async uploadAvatar(file) {
      const userId = await getUserId();
      const fileName = (file?.name || "avatar").replace(
        /[^a-zA-Z0-9_.-]/g,
        "_",
      );
      const filePath = `${userId}/${Date.now()}-${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("profile-avatars")
        .upload(filePath, file, {
          upsert: false,
          cacheControl: "3600",
          contentType: file?.type || "image/jpeg",
        });
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from("profile-avatars")
        .getPublicUrl(filePath);

      if (!publicUrlData?.publicUrl) {
        throw new Error("Failed to generate public URL for uploaded avatar.");
      }

      return { publicUrl: publicUrlData.publicUrl, filePath };
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
      async list(sessionId, sortKey = "-last_action_date", state = DEFAULT_STATE) {
        const userId = await getUserId();
        const sid = requireSessionId(sessionId);
        const hydrationKey = makeHydratedBillSessionKey(userId, state, sid);
        if (!hydratedBillSessionKeys.has(hydrationKey)) {
          const { error: hydrationError } = await supabase.rpc(
            "hydrate_cached_session_bills",
            {
              p_state: state,
              p_session_id: sid,
            },
          );
          if (hydrationError) {
            // Migration 037 may not be deployed yet. Continue with the user's
            // existing rows so rollout order never makes the bill list fail.
            console.warn(
              "[Bills] Shared session archive hydration is unavailable.",
              hydrationError,
            );
          } else {
            hydratedBillSessionKeys.add(hydrationKey);
          }
        }
        const PAGE_SIZE = 1000;
        let allBills = [];
        let from = 0;

        while (true) {
          const { data, error } = await supabase
            .from("bills")
            .select("*")
            .eq("user_id", userId)
            .eq("state", state)
            .eq("session_id", sid)
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

      async replaceAll(payloads, sessionId, state = DEFAULT_STATE) {
        const userId = await getUserId();
        const sid = requireSessionId(sessionId);
        const bills = payloads.map((payload) => ({
          id:
            payload.id ||
            `bill-${userId}-${makeBillRef({
              state,
              sessionId: sid,
              legiscanId: payload.legiscan_id,
              billNumber: payload.bill_number,
            }).replace(/:/g, "-")}`,
          ...payload,
          bill_number: normalizeBillNumber(payload.bill_number),
        }));

        // Provider sync is upsert-only: the database RPC updates provider
        // fields but preserves user summaries, analysis, tags, PDFs, history,
        // and manually-created rows. Chunking bounds request size; any failed
        // chunk leaves all pre-existing session data intact.
        const CHUNK_SIZE = 500;
        for (let index = 0; index < bills.length; index += CHUNK_SIZE) {
          const chunk = bills.slice(index, index + CHUNK_SIZE);
          const { error: cacheError } = await supabase.rpc(
            "sync_legislative_bill_cache",
            {
              p_state: state,
              p_session_id: sid,
              p_bills: chunk,
            },
          );
          if (cacheError) {
            // Preserve the existing user-owned sync path until migration 037
            // is deployed; the shared cache is an optimization, not a reason
            // to hide otherwise valid provider results.
            console.warn(
              "[Bills] Shared legislative cache update is unavailable.",
              cacheError,
            );
          }
          const { error } = await supabase.rpc("sync_session_bills", {
            p_state: state,
            p_session_id: sid,
            p_bills: chunk,
          });
          if (error) throw error;
        }
        hydratedBillSessionKeys.add(
          makeHydratedBillSessionKey(userId, state, sid),
        );
        return this.list(sid, undefined, state);
      },

      async create(payload, sessionId, state = DEFAULT_STATE) {
        const userId = await getUserId();
        const sid = requireSessionId(sessionId);
        const id =
          payload.id ||
          `bill-${userId}-${makeBillRef({
            state,
            sessionId: sid,
            legiscanId: payload.legiscan_id,
            billNumber: payload.bill_number,
          }).replace(/:/g, "-")}`;
        const newBill = {
          id,
          user_id: userId,
          ...payload,
          bill_number: normalizeBillNumber(payload.bill_number),
          state,
          session_id: sid,
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

      async update(id, patch, sessionId, state = DEFAULT_STATE) {
        const userId = await getUserId();
        const sid = requireSessionId(sessionId);
        const mutablePatch = stripImmutableFields(
          patch,
          BILL_IMMUTABLE_FIELDS,
        );
        if (Object.keys(mutablePatch).length === 0) {
          throw new Error("No mutable bill fields were provided.");
        }
        const { data, error } = await supabase
          .from("bills")
          .update(mutablePatch)
          .eq("id", id)
          .eq("user_id", userId)
          .eq("state", state)
          .eq("session_id", sid)
          .select()
          .single();
        if (error) throw error;
        return data;
      },

      async delete(id, sessionId, state = DEFAULT_STATE) {
        const userId = await getUserId();
        const sid = requireSessionId(sessionId);
        const { error } = await supabase
          .from("bills")
          .delete()
          .eq("id", id)
          .eq("user_id", userId)
          .eq("state", state)
          .eq("session_id", sid);
        if (error) throw error;
        return { success: true };
      },

      async clearAll(sessionId, state = DEFAULT_STATE) {
        const userId = await getUserId();
        const sid = requireSessionId(sessionId);
        const { error } = await supabase
          .from("bills")
          .delete()
          .eq("user_id", userId)
          .eq("state", state)
          .eq("session_id", sid);
        if (error) throw error;
        return { success: true };
      },

      /** Bulk update lc_number for bills by bill_number. */
      async updateLcNumbers(entries, sessionId, state = DEFAULT_STATE) {
        const userId = await getUserId();
        const sid = requireSessionId(sessionId);
        for (const { bill_number, lc_number } of entries) {
          if (!lc_number) continue;
          const { error } = await supabase
            .from("bills")
            .update({ lc_number })
            .eq("user_id", userId)
            .eq("state", state)
            .eq("session_id", sid)
            .eq("bill_number", normalizeBillNumber(bill_number));
          if (error) throw error;
        }
      },

      /**
       * Bulk update current_committee and history for bills identified by legiscan_id.
       * Called after the detailed enrichment pass (enrichBillsWithDetails) completes.
       * Runs batches of concurrent Supabase updates to avoid overloading the connection.
       *
       * @param {Array<{legiscan_id: number|string, current_committee: string|null, history: Array<unknown>, extra: Record<string, unknown>}>} updates
       */
      async bulkUpdateCommitteeData(updates, sessionId, state = DEFAULT_STATE) {
        if (!updates.length) return;
        const userId = await getUserId();
        const sid = requireSessionId(sessionId);
        const CONCURRENCY = 10;

        for (let i = 0; i < updates.length; i += CONCURRENCY) {
          const chunk = updates.slice(i, i + CONCURRENCY);
          const responses = await Promise.all(
            chunk.map(({ legiscan_id, current_committee, history, extra }) =>
              supabase
                .from("bills")
                .update({ current_committee, history, extra })
                .eq("user_id", userId)
                .eq("state", state)
                .eq("session_id", sid)
                .eq("legiscan_id", String(legiscan_id)),
            ),
          );
          const failed = responses.find((response) => response.error);
          if (failed?.error) throw failed.error;
        }
      },
    },

    /** Provider dataset versions for the shared session bill archive. */
    BillSessionSyncState: {
      async list(state = DEFAULT_STATE) {
        const { data, error } = await supabase
          .from("bill_session_sync_state")
          .select("*")
          .eq("state", state);
        if (error) throw error;
        return data || [];
      },

      async upsert(session, billCount, state = DEFAULT_STATE) {
        const sid = requireSessionId(session?.session_id);
        const { data, error } = await supabase
          .from("bill_session_sync_state")
          .upsert(
            {
              state,
              session_id: sid,
              dataset_hash: session?.dataset_hash || null,
              session_name:
                session?.session_title || session?.session_name || null,
              year_start: Number(session?.year_start) || null,
              year_end: Number(session?.year_end) || null,
              is_special: Boolean(session?.special),
              is_prior: Boolean(session?.prior),
              is_sine_die: Boolean(session?.sine_die),
              bill_count: Math.max(0, Number(billCount) || 0),
              last_synced_at: new Date().toISOString(),
            },
            { onConflict: "state,session_id" },
          )
          .select()
          .single();
        if (error) throw error;
        return data;
      },
    },

    /** Personal tracked bills, isolated by LegiScan session_id. */
    TrackedBill: {
      async list(sessionId, state = DEFAULT_STATE) {
        const userId = await getUserId();
        const sid = requireSessionId(sessionId);
        const { data, error } = await supabase
          .from("tracked_bill_ids")
          .select("bill_id, bill_number, legiscan_id, state, session_id")
          .eq("user_id", userId)
          .eq("state", state)
          .eq("session_id", sid);
        if (error) throw error;
        return data ?? [];
      },

      async getNumbers(sessionId, state = DEFAULT_STATE) {
        const rows = await this.list(sessionId, state);
        return rows.map((row) => row.bill_number).filter(Boolean);
      },

      async add(sessionId, bill, state = DEFAULT_STATE) {
        const userId = await getUserId();
        const sid = requireSessionId(sessionId);
        const billNumber = normalizeBillNumber(bill?.bill_number || bill);
        if (!billNumber) throw new Error("A bill number is required.");
        const legiscanId = bill?.legiscan_id ? String(bill.legiscan_id) : null;
        const billId = makeBillRef({
          state,
          sessionId: sid,
          legiscanId,
          billNumber,
        });
        const { error } = await supabase.from("tracked_bill_ids").upsert(
          {
            user_id: userId,
            bill_id: billId,
            bill_number: billNumber,
            legiscan_id: legiscanId,
            state,
            session_id: sid,
          },
          { onConflict: "user_id,state,session_id,bill_number" },
        );
        if (error) throw error;
      },

      async remove(sessionId, billNumber, state = DEFAULT_STATE) {
        const userId = await getUserId();
        const sid = requireSessionId(sessionId);
        const { error } = await supabase
          .from("tracked_bill_ids")
          .delete()
          .eq("user_id", userId)
          .eq("state", state)
          .eq("session_id", sid)
          .eq("bill_number", normalizeBillNumber(billNumber));
        if (error) throw error;
      },
    },

    EmailList: {
      _fromRow(row) {
        const extra =
          row?.extra && typeof row.extra === "object" && !Array.isArray(row.extra)
            ? row.extra
            : {};
        const emailAddresses = normalizeEmailAddresses(
          row?.recipients ?? row?.email_addresses,
        );
        return {
          ...row,
          recipients: emailAddresses,
          extra,
          email_addresses: emailAddresses,
          is_active: extra.is_active !== false,
        };
      },

      _toDbPatch(payload) {
        const patch = {};
        if (payload?.name !== undefined) patch.name = payload.name;
        if (payload?.description !== undefined) {
          patch.description = payload.description;
        }
        if (
          payload?.recipients !== undefined ||
          payload?.email_addresses !== undefined
        ) {
          patch.recipients = normalizeEmailAddresses(
            payload.email_addresses ?? payload.recipients,
          );
        }
        if (payload?.extra !== undefined || payload?.is_active !== undefined) {
          const extra =
            payload.extra &&
            typeof payload.extra === "object" &&
            !Array.isArray(payload.extra)
              ? payload.extra
              : {};
          patch.extra = {
            ...extra,
            ...(payload.is_active !== undefined
              ? { is_active: Boolean(payload.is_active) }
              : {}),
          };
        }
        return patch;
      },

      async list(sortKey = "-created_date") {
        const userId = await getUserId();
        const { data, error } = await supabase
          .from("email_lists")
          .select("*")
          .eq("user_id", userId);
        if (error) throw error;
        return sortByField(data ?? [], sortKey).map(this._fromRow);
      },

      async create(payload) {
        const userId = await getUserId();
        const id = payload.id || `list-${Date.now()}`;
        const newList = {
          id,
          user_id: userId,
          ...this._toDbPatch(payload),
          created_date: payload.created_date || new Date().toISOString(),
        };
        const { data, error } = await supabase
          .from("email_lists")
          .insert(newList)
          .select()
          .single();
        if (error) throw error;
        return this._fromRow(data);
      },

      async update(id, payload) {
        const userId = await getUserId();
        const dbPatch = this._toDbPatch(payload);
        if (Object.keys(dbPatch).length === 0) {
          throw new Error("No mutable email-list fields were provided.");
        }
        const { data, error } = await supabase
          .from("email_lists")
          .update(dbPatch)
          .eq("id", id)
          .eq("user_id", userId)
          .select()
          .single();
        if (error) throw error;
        return this._fromRow(data);
      },

      async delete(id) {
        const userId = await getUserId();
        const { error } = await supabase
          .from("email_lists")
          .delete()
          .eq("id", id)
          .eq("user_id", userId);
        if (error) throw error;
        return { success: true };
      },
    },

    Notification: {
      _fromRow(row) {
        return {
          ...row,
          notification_type: row.type,
          related_bill_id: row.bill_id,
          is_read: Boolean(row.read),
          priority: row.extra?.priority ?? "medium",
          sent_to_phone: Boolean(row.extra?.sent_to_phone),
        };
      },

      async list(
        sessionId,
        sortKey = "-created_date",
        limit = 50,
        state = DEFAULT_STATE,
      ) {
        const userId = await getUserId();
        const sid = requireSessionId(sessionId);
        const { data, error } = await supabase
          .from("notifications")
          .select("*")
          .eq("user_id", userId)
          .eq("state", state)
          .eq("session_id", sid)
          .order("created_date", { ascending: false })
          .limit(limit);
        if (error) throw error;
        return sortByField(data ?? [], sortKey).map(this._fromRow);
      },

      async getUnreadCount(sessionId, state = DEFAULT_STATE, type = null) {
        const userId = await getUserId();
        const sid = requireSessionId(sessionId);
        let query = supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("state", state)
          .eq("session_id", sid)
          .eq("read", false);
        if (type) query = query.eq("type", type);
        const { count, error } = await query;
        if (error) throw error;
        return count ?? 0;
      },

      async create(payload, sessionId, state = DEFAULT_STATE) {
        const userId = await getUserId();
        const sid = requireSessionId(sessionId);
        const extra = {
          ...(payload.extra ?? {}),
          ...(payload.priority ? { priority: payload.priority } : {}),
          ...(payload.sent_to_phone !== undefined
            ? { sent_to_phone: Boolean(payload.sent_to_phone) }
            : {}),
        };
        const newNotification = {
          id:
            payload.id ||
            `notif-${userId}-${state}-${sid}-${Date.now()}`,
          user_id: userId,
          state,
          session_id: sid,
          legiscan_id: payload.legiscan_id
            ? String(payload.legiscan_id)
            : null,
          type: payload.type || payload.notification_type || "bill_update",
          title: payload.title || "Legislative update",
          message: payload.message || "",
          bill_id:
            normalizeBillNumber(payload.bill_id || payload.related_bill_id) ||
            null,
          read: Boolean(payload.read ?? payload.is_read),
          extra,
          created_date: payload.created_date || new Date().toISOString(),
        };
        const { data, error } = await supabase
          .from("notifications")
          .insert(newNotification)
          .select()
          .single();
        if (error) throw error;
        return { status: "sent", ...this._fromRow(data) };
      },

      async update(id, patch, sessionId, state = DEFAULT_STATE) {
        const userId = await getUserId();
        const sid = requireSessionId(sessionId);
        const dbPatch = {};
        if (patch.type !== undefined || patch.notification_type !== undefined) {
          dbPatch.type = patch.type ?? patch.notification_type;
        }
        if (patch.title !== undefined) dbPatch.title = patch.title;
        if (patch.message !== undefined) dbPatch.message = patch.message;
        if (patch.bill_id !== undefined || patch.related_bill_id !== undefined) {
          dbPatch.bill_id =
            normalizeBillNumber(patch.bill_id ?? patch.related_bill_id) || null;
        }
        if (patch.read !== undefined || patch.is_read !== undefined) {
          dbPatch.read = Boolean(patch.read ?? patch.is_read);
        }
        if (
          patch.extra !== undefined ||
          patch.priority !== undefined ||
          patch.sent_to_phone !== undefined
        ) {
          dbPatch.extra = {
            ...(patch.extra ?? {}),
            ...(patch.priority !== undefined
              ? { priority: patch.priority }
              : {}),
            ...(patch.sent_to_phone !== undefined
              ? { sent_to_phone: Boolean(patch.sent_to_phone) }
              : {}),
          };
        }
        const { data, error } = await supabase
          .from("notifications")
          .update(dbPatch)
          .eq("id", id)
          .eq("user_id", userId)
          .eq("state", state)
          .eq("session_id", sid)
          .select()
          .single();
        if (error) throw error;
        return this._fromRow(data);
      },

      async delete(id, sessionId, state = DEFAULT_STATE) {
        const userId = await getUserId();
        const sid = requireSessionId(sessionId);
        const { error } = await supabase
          .from("notifications")
          .delete()
          .eq("id", id)
          .eq("user_id", userId)
          .eq("state", state)
          .eq("session_id", sid);
        if (error) throw error;
      },
    },

    Tweet: {
      _fromRow(row) {
        const extra =
          row?.extra && typeof row.extra === "object" && !Array.isArray(row.extra)
            ? row.extra
            : {};
        const relatedBills =
          Array.isArray(row?.related_bill_numbers) &&
          row.related_bill_numbers.length > 0
            ? row.related_bill_numbers
            : extra.related_bills;
        return {
          ...row,
          extra,
          account_name: extra.account_name ?? row.author ?? "",
          account_handle: extra.account_handle ?? row.author ?? "",
          related_bills: Array.isArray(relatedBills)
            ? relatedBills.map(normalizeBillNumber).filter(Boolean)
            : [],
          related_legiscan_ids:
            Array.isArray(row?.related_legiscan_ids) &&
            row.related_legiscan_ids.length > 0
              ? row.related_legiscan_ids.map(String).filter(Boolean)
              : Array.isArray(extra.related_legiscan_ids)
                ? extra.related_legiscan_ids.map(String).filter(Boolean)
                : [],
          media_urls: Array.isArray(extra.media_urls) ? extra.media_urls : [],
          engagement: extra.engagement ?? null,
          tweet_url: extra.tweet_url ?? row.url ?? null,
        };
      },

      async list(
        sessionId,
        sortKey = "-posted_at",
        limit = 50,
        state = DEFAULT_STATE,
      ) {
        const userId = await getUserId();
        const sid = requireSessionId(sessionId);
        const { data, error } = await supabase
          .from("tweets")
          .select("*")
          .eq("user_id", userId)
          .eq("state", state)
          .eq("session_id", sid)
          .order("posted_at", { ascending: false, nullsFirst: false })
          .limit(limit);
        if (error) throw error;
        return sortByField(data ?? [], sortKey).map(this._fromRow);
      },
    },

    /** Shared official X posts. X is an early signal, never bill status truth. */
    XPost: {
      async list(
        sessionId,
        sortKey = "-posted_at",
        limit = 50,
        state = DEFAULT_STATE,
      ) {
        const sid = requireSessionId(sessionId);
        const { data: posts, error: postError } = await supabase
          .from("x_posts")
          .select(
            "state, session_id, post_id, account_id, account_name, account_handle, content, posted_at, post_url, related_bill_numbers, media_urls, engagement, ingested_at",
          )
          .eq("state", state)
          .eq("session_id", sid)
          .order("posted_at", { ascending: false, nullsFirst: false })
          .limit(limit);
        if (postError) throw postError;

        const postIds = (posts ?? []).map((post) => post.post_id);
        let movements = [];
        if (postIds.length > 0) {
          const { data, error } = await supabase
            .from("x_bill_movements")
            .select(
              "post_id, bill_type, bill_number, bill_ref, movement_type, confidence, evidence, detected_at",
            )
            .eq("state", state)
            .eq("session_id", sid)
            .in("post_id", postIds);
          if (error) throw error;
          movements = data ?? [];
        }

        const movementMap = new Map();
        for (const movement of movements) {
          if (!movementMap.has(movement.post_id)) {
            movementMap.set(movement.post_id, []);
          }
          movementMap.get(movement.post_id).push(movement);
        }

        return sortByField(posts ?? [], sortKey).map((post) => {
          const metrics = post.engagement ?? {};
          return {
            ...post,
            id: post.post_id,
            related_bills: (post.related_bill_numbers ?? [])
              .map(normalizeBillNumber)
              .filter(Boolean),
            movements: movementMap.get(post.post_id) ?? [],
            media_urls: post.media_urls ?? [],
            engagement: {
              replies: metrics.reply_count ?? metrics.replies ?? 0,
              reposts: metrics.retweet_count ?? metrics.reposts ?? 0,
              likes: metrics.like_count ?? metrics.likes ?? 0,
            },
            x_url: post.post_url,
          };
        });
      },

      async getSyncStatus(state = DEFAULT_STATE) {
        const { data, error } = await supabase
          .from("x_feed_sync_state")
          .select(
            "state, monitored_handles, last_attempt_at, last_success_at, last_error, fetched_count, matched_count, notified_count, updated_at",
          )
          .eq("state", state)
          .maybeSingle();
        if (error) throw error;
        return data ?? null;
      },
    },

    /** Personal bill metadata (flag + notes, per-user, separate from team). */
    UserBillMeta: {
      /** Fetch all personal metadata rows for the current user. Returns map keyed by bill_number. */
      async getAll(sessionId, state = DEFAULT_STATE) {
        const userId = await getUserId();
        const sid = requireSessionId(sessionId);
        const { data, error } = await supabase
          .from("user_bill_metadata")
          .select("bill_number, flag, bill_summary_notes, analysis")
          .eq("user_id", userId)
          .eq("state", state)
          .eq("session_id", sid);
        if (error) throw error;
        const map = {};
        for (const row of data ?? []) {
          map[row.bill_number] = {
            flag: row.flag ?? null,
            bill_summary_notes: row.bill_summary_notes ?? "",
            analysis: row.analysis ?? {},
          };
        }
        return map;
      },

      /** Upsert metadata for a specific bill. */
      async update(sessionId, billNumber, fields, state = DEFAULT_STATE) {
        const userId = await getUserId();
        const sid = requireSessionId(sessionId);
        const mutableFields = stripImmutableFields(
          fields,
          USER_BILL_META_IMMUTABLE_FIELDS,
        );
        const { error } = await supabase.from("user_bill_metadata").upsert(
          {
            user_id: userId,
            state,
            session_id: sid,
            bill_number: normalizeBillNumber(billNumber),
            ...mutableFields,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,state,session_id,bill_number" },
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
        if (!name || !name.trim()) throw new Error("Team name is required.");
        const { data, error } = await supabase.rpc("create_team", {
          p_name: name.trim(),
        });
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) throw new Error("Failed to create team.");
        return row;
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

      async getBillNumbers(teamId, sessionId, state = DEFAULT_STATE) {
        const sid = requireSessionId(sessionId);
        const { data, error } = await supabase
          .from("team_bills")
          .select("bill_number")
          .eq("team_id", teamId)
          .eq("state", state)
          .eq("session_id", sid);
        if (error) throw error;
        return (data ?? []).map((r) => r.bill_number);
      },

      /** Get all bill numbers from all teams the current user belongs to. */
      async getAllTeamBillNumbers(sessionId, state = DEFAULT_STATE) {
        const userId = await getUserId();
        const sid = requireSessionId(sessionId);
        const { data: memberships } = await supabase
          .from("team_members")
          .select("team_id")
          .eq("user_id", userId)
          .eq("status", "active");
        const teamIds = (memberships ?? []).map((m) => m.team_id);
        if (teamIds.length === 0) return [];
        const { data, error } = await supabase
          .from("team_bills")
          .select("bill_number")
          .in("team_id", teamIds)
          .eq("state", state)
          .eq("session_id", sid);
        if (error) throw error;
        return [...new Set((data ?? []).map((r) => r.bill_number))];
      },

      async addBill(teamId, bill, sessionId, state = DEFAULT_STATE) {
        const userId = await getUserId();
        const sid = requireSessionId(sessionId);
        const billNumber = normalizeBillNumber(bill?.bill_number || bill);
        if (!billNumber) throw new Error("A bill number is required.");
        const legiscanId = bill?.legiscan_id
          ? String(bill.legiscan_id)
          : null;
        const { error } = await supabase
          .from("team_bills")
          .upsert(
            {
              team_id: teamId,
              bill_number: billNumber,
              legiscan_id: legiscanId,
              state,
              session_id: sid,
              added_by: userId,
            },
            { onConflict: "team_id,state,session_id,bill_number" },
          );
        if (error) throw error;
      },

      async removeBill(teamId, billNumber, sessionId, state = DEFAULT_STATE) {
        const sid = requireSessionId(sessionId);
        const { error } = await supabase
          .from("team_bills")
          .delete()
          .eq("team_id", teamId)
          .eq("state", state)
          .eq("session_id", sid)
          .eq("bill_number", normalizeBillNumber(billNumber));
        if (error) throw error;
      },

      /** Fetch all team_bills rows with metadata (flag, policy_assistant, notes). */
      async getBillMetadata(teamId, sessionId, state = DEFAULT_STATE) {
        const sid = requireSessionId(sessionId);
        const { data, error } = await supabase
          .from("team_bills")
          .select("bill_number, flag, policy_assistant, bill_summary_notes")
          .eq("team_id", teamId)
          .eq("state", state)
          .eq("session_id", sid);
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

      /**
       * Fetch bill data for the given bill_numbers across all team members.
       * Uses a SECURITY DEFINER RPC so the caller can read bill rows
       * belonging to other users, but only for bills tracked in their teams.
       */
      async getSharedTeamBillData(billNumbers, sessionId, state = DEFAULT_STATE) {
        if (!billNumbers || billNumbers.length === 0) return [];
        const sid = requireSessionId(sessionId);
        const { data, error } = await supabase.rpc("get_team_bills_data", {
          p_state: state,
          p_session_id: sid,
          p_bill_numbers: billNumbers,
        });
        if (error) throw error;
        return data ?? [];
      },

      /** Update metadata on a single team bill row. `fields` can contain flag, policy_assistant, bill_summary_notes. */
      async updateBillMetadata(
        teamId,
        billNumber,
        fields,
        sessionId,
        state = DEFAULT_STATE,
      ) {
        const sid = requireSessionId(sessionId);
        const mutableFields = stripImmutableFields(
          fields,
          TEAM_BILL_IMMUTABLE_FIELDS,
        );
        if (Object.keys(mutableFields).length === 0) {
          throw new Error("No mutable team-bill fields were provided.");
        }
        const { error } = await supabase
          .from("team_bills")
          .update(mutableFields)
          .eq("team_id", teamId)
          .eq("state", state)
          .eq("session_id", sid)
          .eq("bill_number", normalizeBillNumber(billNumber));
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
          profiles: {
            name: m.sender_name,
            email: m.sender_email,
            avatar_url: m.sender_avatar_url,
          },
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
          profiles: {
            name: row.sender_name,
            email: row.sender_email,
            avatar_url: row.sender_avatar_url,
          },
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
    async list(sessionId, startDate, endDate, state = DEFAULT_STATE) {
      const userId = await getUserId();
      const sid = requireSessionId(sessionId);
      let query = supabase
        .from("calendar_events")
        .select("*")
        .eq("user_id", userId)
        .eq("state", state)
        .eq("session_id", sid)
        .order("start_time", { ascending: true });

      if (startDate) query = query.gte("start_time", startDate);
      if (endDate) query = query.lte("start_time", endDate);

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },

    /** Create a new event */
    async create(event, sessionId, state = DEFAULT_STATE) {
      const userId = await getUserId();
      const sid = requireSessionId(sessionId);
      const mutableEvent = stripImmutableFields(
        event,
        CALENDAR_EVENT_IMMUTABLE_FIELDS,
      );
      const { data, error } = await supabase
        .from("calendar_events")
        .insert({
          ...mutableEvent,
          user_id: userId,
          state,
          session_id: sid,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    /** Update an existing event */
    async update(id, patch, sessionId, state = DEFAULT_STATE) {
      const userId = await getUserId();
      const sid = requireSessionId(sessionId);
      const mutablePatch = stripImmutableFields(
        patch,
        CALENDAR_EVENT_IMMUTABLE_FIELDS,
      );
      if (Object.keys(mutablePatch).length === 0) {
        throw new Error("No mutable calendar-event fields were provided.");
      }
      const { data, error } = await supabase
        .from("calendar_events")
        .update(mutablePatch)
        .eq("id", id)
        .eq("user_id", userId)
        .eq("state", state)
        .eq("session_id", sid)
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    /** Delete an event */
    async delete(id, sessionId, state = DEFAULT_STATE) {
      const userId = await getUserId();
      const sid = requireSessionId(sessionId);
      const { error } = await supabase
        .from("calendar_events")
        .delete()
        .eq("id", id)
        .eq("user_id", userId)
        .eq("state", state)
        .eq("session_id", sid);
      if (error) throw error;
    },
  },

  // ─── LC Number Tracking ────────────────────────────────────────────────────
  //
  // Architecture:
  //   • `bill_lc_history` (global, one row per bill) is the source of
  //     truth for the current and previous LC number. ANY user's
  //     sync updates it, so a change detected by user A is
  //     immediately visible to users B, C, … who track the same
  //     bill (especially via shared team bills).
  //   • `bill_lc_tracking` (per-user) records each user's
  //     acknowledgment timestamp (`change_seen`, `change_seen_at`)
  //     so the badge is per-user but the underlying change-detection
  //     is shared.
  LcTracking: {
    /**
     * Fetch the merged LC tracking map for the current user.
     * Returns an object keyed by bill_number where each entry has
     *   { current_lc, previous_lc, lc_changed_at,
     *     change_seen, change_seen_at, last_checked }
     * Values for current/previous/lc_changed_at come from the
     * GLOBAL history table; change_seen/change_seen_at come from
     * the per-user ack table. `change_seen` is computed: true iff
     * the user has acked at or after the latest global change.
     */
    async getAll(sessionId, state = DEFAULT_STATE) {
      const userId = await getUserId();
      const sid = requireSessionId(sessionId);

      // `bill_lc_history` is now global (every bill in the session is
      // tracked by the background job, ~5k+ rows). The UI only needs
      // LC state for bills THIS user follows (personal + team), so we
      // scope the read to that set — otherwise this poll would pull
      // the entire table every minute.
      const [personalNumbers, teamNumbers] = await Promise.all([
        api.entities.TrackedBill.getNumbers(sid, state).catch(() => []),
        api.entities.Team.getAllTeamBillNumbers(sid, state).catch(() => []),
      ]);
      const relevant = [
        ...new Set([
          ...(personalNumbers ?? []),
          ...(teamNumbers ?? []),
        ]),
      ];

      let histRows = [];
      if (relevant.length > 0) {
        const { data, error: histErr } = await supabase
          .from("bill_lc_history")
          .select("bill_number, current_lc, previous_lc, lc_changed_at")
          .eq("state", state)
          .eq("session_id", sid)
          .in("bill_number", relevant);
        if (histErr) throw histErr;
        histRows = data ?? [];
      }

      const { data: ackRows, error: ackErr } = await supabase
        .from("bill_lc_tracking")
        .select(
          "bill_number, current_lc, previous_lc, lc_changed_at, change_seen, change_seen_at, last_checked",
        )
        .eq("user_id", userId)
        .eq("state", state)
        .eq("session_id", sid);
      if (ackErr) throw ackErr;

      const ackMap = {};
      for (const r of ackRows ?? []) ackMap[r.bill_number] = r;

      const map = {};
      for (const h of histRows ?? []) {
        const ack = ackMap[h.bill_number];
        const ackAt = ack?.change_seen_at
          ? new Date(ack.change_seen_at).getTime()
          : 0;
        const changedAt = h.lc_changed_at
          ? new Date(h.lc_changed_at).getTime()
          : 0;
        const change_seen =
          !h.previous_lc || h.previous_lc === h.current_lc
            ? true
            : ackAt >= changedAt && ackAt > 0;
        map[h.bill_number] = {
          current_lc: h.current_lc,
          previous_lc: h.previous_lc,
          lc_changed_at: h.lc_changed_at,
          change_seen,
          change_seen_at: ack?.change_seen_at ?? null,
          last_checked: ack?.last_checked ?? null,
        };
      }
      // Surface any legacy per-user-only rows (pre-history backfill)
      // so already-tracked bills don't disappear from the UI.
      for (const [bn, r] of Object.entries(ackMap)) {
        if (map[bn]) continue;
        map[bn] = {
          current_lc: r.current_lc,
          previous_lc: r.previous_lc,
          lc_changed_at: r.lc_changed_at,
          change_seen: r.change_seen,
          change_seen_at: r.change_seen_at,
          last_checked: r.last_checked,
        };
      }
      return map;
    },

    /**
     * Lightweight, session-wide LC lookup for the dashboard.
     * Returns a plain object keyed by bill_number → current_lc for
     * EVERY bill in the global history table (the background job keeps
     * this populated for all ~5k bills). Unlike getAll(), this is not
     * scoped to the user's tracked bills, so untracked cards can still
     * display their LC number. Only two columns are selected and the
     * result is meant to be cached with a long staleTime.
     */
    async getGlobalLcMap(sessionId, state = DEFAULT_STATE) {
      const sid = requireSessionId(sessionId);
      const PAGE_SIZE = 1000;
      const map = {};
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("bill_lc_history")
          .select("bill_number, current_lc")
          .eq("state", state)
          .eq("session_id", sid)
          .not("current_lc", "is", null)
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const r of data) map[r.bill_number] = r.current_lc;
        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
      return map;
    },

    /**
     * Resolve the legis.ga.gov internal legislation id for a bill number.
     * The background scraper stores this on every bill_lc_history row, so
     * it's the bridge between a LegiScan bill and the legis.ga.gov version
     * detail endpoint. Returns the numeric id or null.
     */
    async getLegislationId(billNumber, sessionId, state = DEFAULT_STATE) {
      const sid = requireSessionId(sessionId);
      const bn = String(billNumber || "")
        .replace(/\s+/g, "")
        .toUpperCase();
      if (!bn) return null;
      const { data, error } = await supabase
        .from("bill_lc_history")
        .select("legislation_id")
        .eq("state", state)
        .eq("session_id", sid)
        .eq("bill_number", bn)
        .maybeSingle();
      if (error) throw error;
      return data?.legislation_id ?? null;
    },

    /**
     * Update the GLOBAL bill_lc_history for the given entries.
     * Detects changes against whatever is currently in the global
     * table (NOT the user's per-user row), so the first user to
     * sync wins and everyone else gets the notification.
     */
    async _updateGlobalHistory(entries, sessionId, state = DEFAULT_STATE) {
      if (!entries?.length) return [];
      const sid = requireSessionId(sessionId);
      const now = new Date().toISOString();
      const billNumbers = entries
        .filter((e) => e.lc_number)
        .map((e) => e.bill_number);
      if (!billNumbers.length) return [];

      const { data: existingRows, error: readErr } = await supabase
        .from("bill_lc_history")
        .select("bill_number, current_lc, previous_lc, lc_changed_at")
        .eq("state", state)
        .eq("session_id", sid)
        .in("bill_number", billNumbers);
      if (readErr) throw readErr;

      const existingMap = {};
      for (const r of existingRows ?? []) existingMap[r.bill_number] = r;

      const upserts = [];
      const changes = [];
      for (const { bill_number, lc_number } of entries) {
        if (!lc_number) continue;
        const ex = existingMap[bill_number];
        const oldLc = ex?.current_lc ?? null;
        const isChange = oldLc !== null && oldLc !== lc_number;
        upserts.push({
          state,
          session_id: sid,
          bill_number,
          current_lc: lc_number,
          previous_lc: isChange ? oldLc : (ex?.previous_lc ?? null),
          lc_changed_at: isChange ? now : (ex?.lc_changed_at ?? null),
          updated_at: now,
        });
        if (isChange) {
          changes.push({
            bill_number,
            previous_lc: oldLc,
            current_lc: lc_number,
          });
        }
      }
      if (!upserts.length) return changes;

      const { error: upErr } = await supabase
        .from("bill_lc_history")
        .upsert(upserts, { onConflict: "state,session_id,bill_number" });
      if (upErr) throw upErr;
      return changes;
    },

    /** Upsert LC tracking for a single bill. */
    async upsert(billNumber, newLc, sessionId, state = DEFAULT_STATE) {
      if (!newLc) return;
      await this.batchUpsert(
        [{ bill_number: billNumber, lc_number: newLc }],
        sessionId,
        state,
      );
    },

    /**
     * Batch upsert LC numbers. Writes to the global history (where
     * change detection actually happens, cross-user) and bumps the
     * per-user row's `last_checked`. Ack state (`change_seen`,
     * `change_seen_at`) is left untouched — it belongs to the user,
     * not the syncing event.
     */
    async batchUpsert(entries, sessionId, state = DEFAULT_STATE) {
      const userId = await getUserId();
      const sid = requireSessionId(sessionId);
      const now = new Date().toISOString();

      await this._updateGlobalHistory(entries, sid, state);

      const trackingPayloads = entries
        .filter((e) => e.lc_number)
        .map(({ bill_number }) => ({
          user_id: userId,
          state,
          session_id: sid,
          bill_number,
          last_checked: now,
          updated_at: now,
        }));
      if (!trackingPayloads.length) return;

      const { error } = await supabase
        .from("bill_lc_tracking")
        .upsert(trackingPayloads, {
          onConflict: "user_id,state,session_id,bill_number",
        });
      if (error) throw error;
    },

    /** Count of unseen LC changes for the current user. */
    async getUnseenCount(sessionId, state = DEFAULT_STATE) {
      const map = await this.getAll(sessionId, state);
      let n = 0;
      for (const t of Object.values(map)) {
        if (t.previous_lc && t.previous_lc !== t.current_lc && !t.change_seen) {
          n += 1;
        }
      }
      return n;
    },

    /** Mark all unseen changes as seen with timestamp. */
    async markAllSeen(sessionId, state = DEFAULT_STATE) {
      const map = await this.getAll(sessionId, state);
      const unseen = Object.entries(map)
        .filter(
          ([, t]) =>
            t.previous_lc && t.previous_lc !== t.current_lc && !t.change_seen,
        )
        .map(([bn]) => bn);
      if (!unseen.length) return;
      await this.markBillsSeen(unseen, sessionId, state);
    },

    /** Mark specific bills' LC changes as seen with timestamp. */
    async markBillsSeen(billNumbers, sessionId, state = DEFAULT_STATE) {
      if (!billNumbers?.length) return;
      const userId = await getUserId();
      const sid = requireSessionId(sessionId);
      const now = new Date().toISOString();
      const payloads = billNumbers.map((bn) => ({
        user_id: userId,
        state,
        session_id: sid,
        bill_number: bn,
        change_seen: true,
        change_seen_at: now,
        updated_at: now,
      }));
      const { error } = await supabase
        .from("bill_lc_tracking")
        .upsert(payloads, {
          onConflict: "user_id,state,session_id,bill_number",
        });
      if (error) throw error;
    },
  },

  // ─── Meeting Intelligence ──────────────────────────────────────────────────
  // Transcription + AI analysis of public legislative meetings. Transcript and
  // segment rows are shared (public meetings); favorites and alerts are per-user.
  meetingIntel: {
    transcripts: {
      /** List all transcripts, newest first. */
      async list(sessionId, limit = 200, state = DEFAULT_STATE) {
        const sid = requireSessionId(sessionId);
        const { data, error } = await supabase
          .from("meeting_transcripts")
          .select("*")
          .eq("state", state)
          .eq("session_id", sid)
          .order("start_time", { ascending: false })
          .limit(limit);
        if (error) throw error;
        return data ?? [];
      },

      async getByMeetingId(meetingId, sessionId, state = DEFAULT_STATE) {
        if (!meetingId) return null;
        const sid = requireSessionId(sessionId);
        const { data, error } = await supabase
          .from("meeting_transcripts")
          .select("*")
          .eq("state", state)
          .eq("session_id", sid)
          .eq("meeting_id", meetingId)
          .maybeSingle();
        if (error) throw error;
        return data ?? null;
      },

      async get(id, sessionId, state = DEFAULT_STATE) {
        const sid = requireSessionId(sessionId);
        const { data, error } = await supabase
          .from("meeting_transcripts")
          .select("*")
          .eq("state", state)
          .eq("session_id", sid)
          .eq("id", id)
          .maybeSingle();
        if (error) throw error;
        return data ?? null;
      },

      /**
       * Create (or fetch existing) the transcript row for a meeting.
       * `meeting` is a normalized legis-ga meeting object.
       */
      async ensureForMeeting(
        meeting,
        fields = {},
        sessionId,
        state = DEFAULT_STATE,
      ) {
        const userId = await getUserId();
        const sid = requireSessionId(sessionId);
        const existing = await this.getByMeetingId(meeting.id, sid, state);
        const mutableFields = stripImmutableFields(
          fields,
          TRANSCRIPT_IMMUTABLE_FIELDS,
        );
        if (existing) {
          // Apply any new fields (e.g. freshly-parsed agenda bills).
          if (Object.keys(mutableFields).length > 0) {
            return this.update(existing.id, mutableFields, sid, state);
          }
          return existing;
        }
        const payload = {
          state,
          session_id: sid,
          meeting_id: meeting.id,
          title: meeting.title ?? "Legislative Meeting",
          chamber: meeting.chamber ?? null,
          committee: meeting.committee ?? meeting.title ?? null,
          start_time: meeting.start_time ?? null,
          status: mutableFields.status ?? "scheduled",
          video_url: meeting.videoUrl ?? null,
          agenda_url: meeting.agendaUrl ?? null,
          created_by: userId,
          ...mutableFields,
        };
        const { data, error } = await supabase
          .from("meeting_transcripts")
          .insert(payload)
          .select()
          .single();
        if (error) throw error;
        return data;
      },

      async update(id, patch, sessionId, state = DEFAULT_STATE) {
        const sid = requireSessionId(sessionId);
        const mutablePatch = stripImmutableFields(
          patch,
          TRANSCRIPT_IMMUTABLE_FIELDS,
        );
        if (Object.keys(mutablePatch).length === 0) {
          throw new Error("No mutable transcript fields were provided.");
        }
        const { data, error } = await supabase
          .from("meeting_transcripts")
          .update(mutablePatch)
          .eq("state", state)
          .eq("session_id", sid)
          .eq("id", id)
          .select()
          .single();
        if (error) throw error;
        return data;
      },

      /**
       * Request unattended live monitoring of a meeting from a YouTube live URL.
       * Sets youtube_url + status='requested'; the worker polls and claims it.
       */
      async requestMonitor(
        meeting,
        youtubeUrl,
        sessionId,
        state = DEFAULT_STATE,
      ) {
        const t = await this.ensureForMeeting(meeting, {}, sessionId, state);
        return this.update(
          t.id,
          {
            youtube_url: youtubeUrl,
            status: "requested",
          },
          sessionId,
          state,
        );
      },
    },

    segments: {
      async list(transcriptId) {
        if (!transcriptId) return [];
        const { data, error } = await supabase
          .from("meeting_transcript_segments")
          .select("*")
          .eq("transcript_id", transcriptId)
          .order("seq", { ascending: true });
        if (error) throw error;
        return data ?? [];
      },

      async add(transcriptId, segment) {
        const { data, error } = await supabase
          .from("meeting_transcript_segments")
          .insert({ transcript_id: transcriptId, ...segment })
          .select()
          .single();
        if (error) throw error;
        return data;
      },

      /** Subscribe to realtime inserts for a transcript's segments. */
      subscribe(transcriptId, onInsert) {
        return supabase
          .channel(`segments_${transcriptId}`)
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "meeting_transcript_segments",
              filter: `transcript_id=eq.${transcriptId}`,
            },
            (payload) => onInsert(payload.new),
          )
          .subscribe();
      },
    },

    favorites: {
      /** Returns a Set of favorited transcript ids for the current user. */
      async getIds() {
        const userId = await getUserId();
        const { data, error } = await supabase
          .from("meeting_favorites")
          .select("transcript_id")
          .eq("user_id", userId);
        if (error) throw error;
        return new Set((data ?? []).map((r) => r.transcript_id));
      },

      async toggle(transcriptId) {
        const userId = await getUserId();
        const { data: existing } = await supabase
          .from("meeting_favorites")
          .select("id")
          .eq("user_id", userId)
          .eq("transcript_id", transcriptId)
          .maybeSingle();
        if (existing) {
          await supabase.from("meeting_favorites").delete().eq("id", existing.id);
          return false;
        }
        await supabase
          .from("meeting_favorites")
          .insert({ user_id: userId, transcript_id: transcriptId });
        return true;
      },
    },

    alerts: {
      async list(sessionId, limit = 100, state = DEFAULT_STATE) {
        const userId = await getUserId();
        const sid = requireSessionId(sessionId);
        const { data, error } = await supabase
          .from("meeting_alerts")
          .select("*")
          .eq("user_id", userId)
          .eq("state", state)
          .eq("session_id", sid)
          .order("created_at", { ascending: false })
          .limit(limit);
        if (error) throw error;
        return data ?? [];
      },

      /**
       * Create alerts for the current user, de-duplicated against existing
       * alerts of the same (transcript_id, bill_number, alert_type).
       */
      async createMany(rows, sessionId, state = DEFAULT_STATE) {
        if (!rows?.length) return [];
        const userId = await getUserId();
        const sid = requireSessionId(sessionId);
        const payloads = rows.map((r) => ({
          user_id: userId,
          state,
          session_id: sid,
          transcript_id: r.transcript_id ?? null,
          bill_number: r.bill_number,
          alert_type: r.alert_type ?? "mentioned",
          message: r.message ?? "",
        }));
        // Avoid duplicate spam: drop rows that already exist for this user.
        const { data: existing } = await supabase
          .from("meeting_alerts")
          .select("transcript_id, bill_number, alert_type")
          .eq("user_id", userId)
          .eq("state", state)
          .eq("session_id", sid)
          .in(
            "bill_number",
            [...new Set(payloads.map((p) => p.bill_number))],
          );
        const existingKeys = new Set(
          (existing ?? []).map(
            (e) => `${e.transcript_id}|${e.bill_number}|${e.alert_type}`,
          ),
        );
        const fresh = payloads.filter(
          (p) =>
            !existingKeys.has(
              `${p.transcript_id}|${p.bill_number}|${p.alert_type}`,
            ),
        );
        if (!fresh.length) return [];
        const { data, error } = await supabase
          .from("meeting_alerts")
          .insert(fresh)
          .select();
        if (error) throw error;
        return data ?? [];
      },

      async markSeen(ids, sessionId, state = DEFAULT_STATE) {
        if (!ids?.length) return;
        const userId = await getUserId();
        const sid = requireSessionId(sessionId);
        const { error } = await supabase
          .from("meeting_alerts")
          .update({ seen: true })
          .eq("user_id", userId)
          .eq("state", state)
          .eq("session_id", sid)
          .in("id", ids);
        if (error) throw error;
      },

      async getUnseenCount(sessionId, state = DEFAULT_STATE) {
        const userId = await getUserId();
        const sid = requireSessionId(sessionId);
        const { count, error } = await supabase
          .from("meeting_alerts")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("state", state)
          .eq("session_id", sid)
          .eq("seen", false);
        if (error) throw error;
        return count ?? 0;
      },
    },
  },

  // ─── Legislative Events ────────────────────────────────────────────────────
  legislativeEvents: {
    /** Ensures a date-only string ("2026-01-13") becomes a full ISO timestamp. */
    _toTimestamp(dt) {
      if (!dt) return null;
      return dt.length <= 10 ? dt + "T00:00:00Z" : dt;
    },

    /** Convert a DB row back into the calendar event shape the UI expects. */
    _fromRow(row) {
      return { ...row, _source: "openstates" };
    },

    /** Fetch persisted legislative events within a date range. */
    async list(startDate, endDate, sessionId, state = DEFAULT_STATE) {
      const sid = requireSessionId(sessionId);
      const { data, error } = await supabase
        .from("legislative_events")
        .select("*")
        .eq("state", state)
        .eq("session_id", sid)
        .gte("start_time", startDate)
        .lte("start_time", endDate)
        .order("start_time", { ascending: true });
      if (error) throw error;
      return (data ?? []).map(this._fromRow);
    },

    /**
     * Upsert normalized Open States events into the DB.
     * Uses the Open States event ID as the conflict key so rescheduled
     * meetings overwrite their old start_time rather than duplicating.
     */
    async upsert(
      normalizedEvents,
      sessionId,
      state = DEFAULT_STATE,
    ) {
      if (!normalizedEvents?.length) return;
      const sid = requireSessionId(sessionId);
      const now = new Date().toISOString();
      const rows = normalizedEvents.map((ev) => ({
        id: `${state}:${sid}:${ev.id}`,
        source_id: ev.id,
        state,
        session_id: sid,
        title: ev.title,
        description: ev.description || null,
        start_time: this._toTimestamp(ev.start_time),
        end_time: this._toTimestamp(ev.end_time),
        all_day: ev.all_day,
        color: ev.color,
        location: ev.location || null,
        location_url: ev.location_url || null,
        classification: ev.classification || null,
        bills: ev.bills ?? [],
        participants: ev.participants ?? [],
        links: ev.links ?? [],
        fetched_at: now,
        updated_at: now,
      }));
      const { error } = await supabase
        .from("legislative_events")
        .upsert(rows, { onConflict: "id" });
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
