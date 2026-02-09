// Lightweight in-browser mock of the Base44 client.
// Provides simple async functions with slight latency to mimic network calls.

const storage = typeof window === "undefined" ? null : window.localStorage;
const STORE_KEY = "legispulse_mock_api_v1";

const seedBills = [
  {
    id: "bill-hb-1",
    bill_number: "HB 1",
    title: "Education funding modernization",
    chamber: "house",
    bill_type: "bill",
    sponsor: "Rep. Taylor",
    session_year: 2026,
    status: "in_committee",
    last_action: "Assigned to Education Committee",
    last_action_date: "2026-01-10",
    created_date: "2026-01-05",
    tags: ["education"],
    ocga_sections_affected: ["20-2-160"],
  },
  {
    id: "bill-sb-12",
    bill_number: "SB 12",
    title: "Transportation infrastructure improvements",
    chamber: "senate",
    bill_type: "bill",
    sponsor: "Sen. Morgan",
    session_year: 2026,
    status: "introduced",
    last_action: "First reading in Senate",
    last_action_date: "2026-01-12",
    created_date: "2026-01-12",
    tags: ["transportation"],
    ocga_sections_affected: ["32-2-1"],
  },
  {
    id: "bill-hb-45",
    bill_number: "HB 45",
    title: "Healthcare accessibility expansion",
    chamber: "house",
    bill_type: "bill",
    sponsor: "Rep. Chen",
    session_year: 2026,
    status: "passed_first_reading",
    last_action: "Passed first reading",
    last_action_date: "2026-01-15",
    created_date: "2026-01-14",
    tags: ["health"],
    ocga_sections_affected: ["31-2-1"],
  },
  {
    id: "bill-sr-5",
    bill_number: "SR 5",
    title: "Study committee on rural broadband",
    chamber: "senate",
    bill_type: "resolution",
    sponsor: "Sen. Patel",
    session_year: 2026,
    status: "in_committee",
    last_action: "Referred to Technology Committee",
    last_action_date: "2026-01-08",
    created_date: "2026-01-08",
    tags: ["technology"],
    ocga_sections_affected: [],
  },
  {
    id: "bill-hr-9",
    bill_number: "HR 9",
    title: "Resolution honoring civic engagement",
    chamber: "house",
    bill_type: "resolution",
    sponsor: "Rep. Rivera",
    session_year: 2026,
    status: "introduced",
    last_action: "Introduced",
    last_action_date: "2026-01-18",
    created_date: "2026-01-18",
    tags: ["civic"],
    ocga_sections_affected: [],
  },
];

const seedUser = {
  id: "user-1",
  name: "Mock User",
  email: "mock.user@example.com",
  tracked_bill_ids: ["bill-hb-1", "bill-sb-12"],
  twitter_notifications_enabled: true,
  phone_notifications_enabled: true,
  email_notifications_enabled: true,
  notification_phone: "+1 (404) 555-1234",
  notification_preferences: {
    email_updates: true,
    bill_status_changes: true,
    new_bills: true,
  },
  role: "admin",
};

const seedEmailLists = [
  {
    id: "list-1",
    name: "Atlanta Clients",
    description: "Constituents and partners in metro Atlanta",
    email_addresses: ["client1@example.com", "client2@example.com"],
    is_active: true,
    created_date: "2026-01-10",
  },
];

const seedNotifications = [
  {
    id: "notif-1",
    user_id: seedUser.id,
    notification_type: "bill_status_change",
    title: "HB 1 moved to committee",
    message: "HB 1 was assigned to Education Committee",
    priority: "medium",
    is_read: false,
    created_date: new Date().toISOString(),
  },
];

const seedTweets = [
  {
    id: "tweet-1",
    account_handle: "@GeorgiaHouseofReps",
    account_name: "Georgia House",
    content: "HB 1 advanced to committee for further review.",
    related_bills: ["HB 1"],
    posted_at: new Date().toISOString(),
    tweet_url: "https://twitter.com/GeorgiaHouseofReps/status/1",
    engagement: { replies: 3, retweets: 5, likes: 42 },
    media_urls: [],
  },
  {
    id: "tweet-2",
    account_handle: "@Georgia_Senate",
    account_name: "Georgia Senate",
    content: "Discussing SB 12 transportation upgrades this week.",
    related_bills: ["SB 12"],
    posted_at: new Date().toISOString(),
    tweet_url: "https://twitter.com/Georgia_Senate/status/2",
    engagement: { replies: 2, retweets: 4, likes: 30 },
    media_urls: [],
  },
];

const defaultData = {
  user: seedUser,
  bills: seedBills,
  emailLists: seedEmailLists,
  notifications: seedNotifications,
  tweets: seedTweets,
};

// Fallback in-memory store if localStorage quota is exceeded
let memoryData = { ...defaultData };
let useMemoryStore = false;

const loadData = () => {
  if (useMemoryStore || !storage) return { ...memoryData };
  try {
    const raw = storage.getItem(STORE_KEY);
    if (!raw) return { ...memoryData };
    const parsed = JSON.parse(raw);
    return { ...defaultData, ...parsed };
  } catch (err) {
    console.warn("Failed to parse mock data, switching to memory store", err);
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
    // Quota exceeded or other storage errors: fall back to memory for this session
    console.warn("localStorage unavailable, using in-memory store", err);
    useMemoryStore = true;
    memoryData = data;
  }
};

const delay = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

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

const addItem = (arr, item) => {
  const now = new Date().toISOString();
  return [...arr, { created_date: now, ...item }];
};

export const base44 = {
  auth: {
    async me() {
      await delay();
      const data = loadData();
      return { ...data.user };
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
      return Promise.resolve();
    },
    redirectToLogin() {
      // No-op in mock mode
      return Promise.resolve();
    },
  },
  entities: {
    Bill: {
      async list(sortKey = "-created_date") {
        await delay();
        const data = loadData();
        return sortByField(data.bills, sortKey);
      },
      async replaceAll(payloads) {
        await delay();
        const data = loadData();
        const now = Date.now();
        const bills = payloads.map((payload, idx) => ({
          id:
            payload.id ||
            `bill-${payload.bill_number?.replace(/\s+/g, "-")}-${now}-${idx}`,
          bill_type: "bill",
          status: "introduced",
          session_year: 2026,
          tags: [],
          ocga_sections_affected: [],
          ...payload,
          created_date: payload.created_date || new Date().toISOString(),
        }));
        saveData({ ...data, bills });
        return bills;
      },
      async create(payload) {
        await delay();
        const data = loadData();
        // Use bill_number as part of ID to ensure uniqueness
        const id =
          payload.id ||
          `bill-${payload.bill_number?.replace(/\s+/g, "-")}-${Date.now()}`;
        const newBill = {
          id,
          bill_type: "bill",
          status: "introduced",
          session_year: 2026,
          tags: [],
          ocga_sections_affected: [],
          ...payload,
          created_date: payload.created_date || new Date().toISOString(),
        };
        // Use concat instead of addItem to avoid potential issues
        const bills = [...data.bills, newBill];
        saveData({ ...data, bills });
        return newBill;
      },
      async update(id, patch) {
        await delay();
        const data = loadData();
        const bills = data.bills.map((b) =>
          b.id === id ? { ...b, ...patch } : b,
        );
        saveData({ ...data, bills });
        return bills.find((b) => b.id === id);
      },
      async clearAll() {
        await delay();
        const data = loadData();
        saveData({ ...data, bills: [] });
        return [];
      },
    },
    EmailList: {
      async list(sortKey = "-created_date") {
        await delay();
        const data = loadData();
        return sortByField(data.emailLists, sortKey);
      },
      async create(payload) {
        await delay();
        const data = loadData();
        const id = payload.id || `list-${Date.now()}`;
        const list = { id, created_date: new Date().toISOString(), ...payload };
        saveData({ ...data, emailLists: addItem(data.emailLists, list) });
        return list;
      },
      async update(id, patch) {
        await delay();
        const data = loadData();
        const emailLists = data.emailLists.map((l) =>
          l.id === id ? { ...l, ...patch } : l,
        );
        saveData({ ...data, emailLists });
        return emailLists.find((l) => l.id === id);
      },
      async delete(id) {
        await delay();
        const data = loadData();
        const emailLists = data.emailLists.filter((l) => l.id !== id);
        saveData({ ...data, emailLists });
        return true;
      },
    },
    Notification: {
      async filter(filters = {}, sortKey = "-created_date", limit = 50) {
        await delay();
        const data = loadData();
        let items = data.notifications;
        if (filters.user_id) {
          items = items.filter((n) => n.user_id === filters.user_id);
        }
        const sorted = sortByField(items, sortKey);
        return sorted.slice(0, limit);
      },
      async create(payload) {
        await delay();
        const data = loadData();
        const item = {
          id: payload.id || `notif-${Date.now()}`,
          ...payload,
          created_date: new Date().toISOString(),
          is_read: false,
        };
        saveData({ ...data, notifications: addItem(data.notifications, item) });
        return item;
      },
      async update(id, patch) {
        await delay();
        const data = loadData();
        const notifications = data.notifications.map((n) =>
          n.id === id ? { ...n, ...patch } : n,
        );
        saveData({ ...data, notifications });
        return notifications.find((n) => n.id === id);
      },
      async delete(id) {
        await delay();
        const data = loadData();
        const notifications = data.notifications.filter((n) => n.id !== id);
        saveData({ ...data, notifications });
        return true;
      },
    },
    Tweet: {
      async list(sortKey = "-posted_at", limit = 50) {
        await delay();
        const data = loadData();
        const sorted = sortByField(data.tweets, sortKey);
        return sorted.slice(0, limit);
      },
    },
  },
  integrations: {
    Core: {
      async InvokeLLM(payload) {
        await delay();
        if (payload?.response_json_schema?.properties?.bills) {
          // Bill sync path returns seed bills as mock scrape
          return { bills: seedBills };
        }
        // Generic AI response
        return {
          plain_language_summary:
            "This is a mock AI summary for the selected bill.",
          law_changes: "Explains the key statutory changes in simple terms.",
          affected_parties:
            "Citizens, agencies, and businesses impacted by the bill.",
          practical_impact:
            "Outlines expected real-world effects once enacted.",
          has_updates: false,
          updates: [],
        };
      },
      async SendEmail(payload) {
        await delay();
        return { status: "sent", ...payload };
      },
    },
  },
  appLogs: {
    async logUserInApp() {
      await delay(50);
      return true;
    },
  },
};
