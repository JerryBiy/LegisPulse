// API client for LegisTrack
// Handles local bill storage and connects to external APIs (LegiScan, LLM services, etc.)

const storage = typeof window === "undefined" ? null : window.localStorage;
const STORE_KEY = "legistrack_data";
const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
const OPENAI_MODEL = import.meta.env.VITE_OPENAI_MODEL || "gpt-5.2";
const OPENAI_BASE_URL =
  import.meta.env.VITE_OPENAI_BASE_URL || "https://api.openai.com/v1";

let memoryData = {
  bills: [],
  user: null,
  emailLists: [],
  notifications: [],
  tweets: [],
};
let useMemoryStore = false;

const getDefaultUser = () => ({
  id: "local-user",
  name: "Local User",
  email: "local@example.com",
  tracked_bill_ids: [],
});

const loadData = () => {
  if (useMemoryStore || !storage) return { ...memoryData };
  try {
    const raw = storage.getItem(STORE_KEY);
    if (!raw)
      return {
        bills: [],
        user: null,
        emailLists: [],
        notifications: [],
        tweets: [],
      };
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (err) {
    console.warn("Failed to parse stored data, switching to memory store", err);
    useMemoryStore = true;
    return { ...memoryData };
  }
};

const saveData = (data) => {
  if (useMemoryStore || !storage) {
    memoryData = data;
    return;
  }
  try {
    storage.setItem(STORE_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn("Storage unavailable, using in-memory store", err);
    useMemoryStore = true;
    memoryData = data;
  }
};

const delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

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
  auth: {
    async me() {
      await delay();
      const data = loadData();
      if (!data.user) {
        const user = getDefaultUser();
        saveData({ ...data, user });
        return user;
      }
      return data.user;
    },
    async updateMe(patch) {
      await delay();
      const data = loadData();
      const baseUser = data.user || getDefaultUser();
      const updated = {
        ...baseUser,
        ...patch,
        tracked_bill_ids:
          patch.tracked_bill_ids !== undefined
            ? patch.tracked_bill_ids
            : baseUser.tracked_bill_ids || [],
      };
      saveData({ ...data, user: updated });
      return updated;
    },
    logout() {
      if (storage) {
        storage.removeItem(STORE_KEY);
      }
      memoryData = {
        bills: [],
        user: null,
        emailLists: [],
        notifications: [],
        tweets: [],
      };
      return Promise.resolve();
    },
    redirectToLogin() {
      return Promise.resolve();
    },
  },
  entities: {
    Bill: {
      async list(sortKey = "-last_action_date") {
        await delay();
        const data = loadData();
        return sortByField(data.bills || [], sortKey);
      },
      async replaceAll(payloads) {
        await delay();
        const data = loadData();
        const now = Date.now();
        const bills = payloads.map((payload, idx) => ({
          id:
            payload.id ||
            `bill-${payload.bill_number?.replace(/\s+/g, "-")}-${now}-${idx}`,
          ...payload,
          created_date: payload.created_date || new Date().toISOString(),
        }));
        saveData({ ...data, bills });
        return bills;
      },
      async create(payload) {
        await delay();
        const data = loadData();
        const id =
          payload.id ||
          `bill-${payload.bill_number?.replace(/\s+/g, "-")}-${Date.now()}`;
        const newBill = {
          id,
          ...payload,
          created_date: payload.created_date || new Date().toISOString(),
        };
        const bills = [...(data.bills || []), newBill];
        saveData({ ...data, bills });
        return newBill;
      },
      async update(id, patch) {
        await delay();
        const data = loadData();
        const bills = (data.bills || []).map((b) =>
          b.id === id ? { ...b, ...patch } : b,
        );
        saveData({ ...data, bills });
        return bills.find((b) => b.id === id);
      },
      async delete(id) {
        await delay();
        const data = loadData();
        const bills = (data.bills || []).filter((b) => b.id !== id);
        saveData({ ...data, bills });
        return { success: true };
      },
      async clearAll() {
        await delay();
        const data = loadData();
        saveData({ ...data, bills: [] });
        return { success: true };
      },
    },
    EmailList: {
      async list(sortKey = "-created_date") {
        await delay();
        const data = loadData();
        return sortByField(data.emailLists || [], sortKey);
      },
      async create(payload) {
        await delay();
        const data = loadData();
        const id = payload.id || `list-${Date.now()}`;
        const newList = {
          id,
          ...payload,
          created_date: payload.created_date || new Date().toISOString(),
        };
        const emailLists = [...(data.emailLists || []), newList];
        saveData({ ...data, emailLists });
        return newList;
      },
    },
    Notification: {
      async list(sortKey = "-created_date", limit = 50) {
        await delay();
        const data = loadData();
        const sorted = sortByField(data.notifications || [], sortKey);
        return sorted.slice(0, limit);
      },
      async create(payload) {
        await delay();
        const data = loadData();
        const newNotification = {
          id: payload.id || `notif-${Date.now()}`,
          ...payload,
          created_date: payload.created_date || new Date().toISOString(),
        };
        const notifications = [...(data.notifications || []), newNotification];
        saveData({ ...data, notifications });
        return { status: "sent", ...newNotification };
      },
    },
    Tweet: {
      async list(sortKey = "-posted_at", limit = 50) {
        await delay();
        const data = loadData();
        const sorted = sortByField(data.tweets || [], sortKey);
        return sorted.slice(0, limit);
      },
    },
  },
  integrations: {
    Core: {
      async InvokeLLM(params) {
        await delay();

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
        console.log(
          "User prompt likely truncated before send",
          typeof params?.prompt === "string"
            ? params.prompt.length > 30000
            : false,
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

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content || "";

        if (expectsJson) {
          const parsed = extractJsonObject(content);
          if (!parsed || typeof parsed !== "object") {
            throw new Error("LLM returned an invalid JSON response.");
          }
          return parsed;
        }

        return {
          text: content,
          usage: data?.usage,
        };
      },
    },
  },
  appLogs: {
    async logUserInApp(pageName) {
      await delay();
      console.debug("User navigated to:", pageName);
      return { success: true };
    },
  },
};
