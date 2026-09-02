import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyBillMovements,
  extractBillReferences,
  resolveSessionForPost,
} from "./xFeedSync.js";

test("extracts compact, spaced, and long-form Georgia bill references", () => {
  assert.deepEqual(
    extractBillReferences(
      "HB 10, SB20, House Resolution 4 and Senate Bill No. 88 are listed. HB10 repeats.",
    ),
    [
      { billType: "HB", billNumber: 10, billRef: "HB10" },
      { billType: "SB", billNumber: 20, billRef: "SB20" },
      { billType: "HR", billNumber: 4, billRef: "HR4" },
      { billType: "SB", billNumber: 88, billRef: "SB88" },
    ],
  );
});

test("classifies movement only from the sentence containing the target bill", () => {
  const text =
    "HB 10 was assigned to the Insurance Committee. SB 20 passed the Senate 48-2.";
  assert.deepEqual(
    classifyBillMovements(text, "HB10", "@GAHouseHub").map(
      (movement) => movement.type,
    ),
    ["assigned_to_committee"],
  );
  assert.deepEqual(
    classifyBillMovements(text, "SB20", "@GASenatePress").map(
      (movement) => movement.type,
    ),
    ["passed_senate"],
  );
});

test("uses the official source chamber for concise floor-note passage posts", () => {
  assert.deepEqual(
    classifyBillMovements("HB 10 passes 160-5.", "HB10", "@GAHouseHub").map(
      (movement) => movement.type,
    ),
    ["passed_house"],
  );
});

test("separates regular and special sessions for the same bill number", () => {
  const sessions = [
    {
      session_id: 100,
      session_name: "2025-2026 Regular Session",
      year_start: 2025,
      year_end: 2026,
      is_special: false,
    },
    {
      session_id: 200,
      session_name: "2026 Special Session",
      year_start: 2026,
      year_end: 2026,
      is_special: true,
    },
  ];
  const cachedRefsBySession = new Map([
    [100, new Set(["HB10"])],
    [200, new Set(["HB10"])],
  ]);
  const billRefs = [{ billType: "HB", billNumber: 10, billRef: "HB10" }];

  const regular = resolveSessionForPost({
    post: {
      postedAt: "2026-02-12T15:00:00Z",
      content: "HB 10 passed the House.",
    },
    sessions,
    billRefs,
    cachedRefsBySession,
  });
  assert.equal(regular.session?.session_id, 100);

  const special = resolveSessionForPost({
    post: {
      postedAt: "2026-11-12T15:00:00Z",
      content: "During the 2026 Special Session, HB 10 passed the House.",
    },
    sessions,
    billRefs,
    cachedRefsBySession,
  });
  assert.equal(special.session?.session_id, 200);
});

test("an explicit deployment session mapping wins without number-only guessing", () => {
  const result = resolveSessionForPost({
    post: {
      postedAt: "2026-11-12T15:00:00Z",
      content: "HB 10 passes 160-5.",
    },
    sessions: [
      {
        session_id: 100,
        session_name: "2025-2026 Regular Session",
        year_start: 2025,
        year_end: 2026,
        is_special: false,
      },
      {
        session_id: 200,
        session_name: "2026 Special Session",
        year_start: 2026,
        year_end: 2026,
        is_special: true,
      },
    ],
    billRefs: [{ billType: "HB", billNumber: 10, billRef: "HB10" }],
    configuredSessionIds: new Set([200]),
  });
  assert.equal(result.session?.session_id, 200);
});
