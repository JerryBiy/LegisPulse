// API client for LegisTrack
// Handles local bill storage and connects to external APIs (LegiScan, LLM services, etc.)

const storage = typeof window === "undefined" ? null : window.localStorage;
const STORE_KEY = "legistrack_data";

let memoryData = {
  bills: [],
  user: null,
  emailLists: [],
  notifications: [],
  tweets: [],
};
let useMemoryStore = false;

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

export const api = {
  auth: {
    async me() {
      await delay();
      const data = loadData();
      return data.user || null;
    },
    async updateMe(patch) {
      await delay();
      const data = loadData();
      const updated = { ...data.user, ...patch };
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
        // Placeholder for LLM integration
        await delay(500);
        console.log("LLM invoked with params:", params);
        return {
          status: "success",
          message: "LLM processing would happen here",
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

// Export as base44 for backward compatibility during transition
export const base44 = api;
