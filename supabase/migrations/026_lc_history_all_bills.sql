-- ============================================================
-- All-Bills LC Tracking
-- ============================================================
-- Previously `bill_lc_history` only held rows for bills that at
-- least one user tracked (personal or team), and the LC numbers
-- were parsed from LegiScan bill text — one row per *tracked*
-- bill.
--
-- We now track the LC number of EVERY bill in the active Georgia
-- session by scraping legis.ga.gov directly (the `lc-recheck`
-- Edge Function enumerates all legislation and reads each bill's
-- version list, which carries the LC number).
--
-- Two extra columns support an efficient, incremental background
-- job:
--   • legislation_id — the legis.ga.gov legislation id, so the
--     function (and the client) can deep-link / re-fetch without
--     re-resolving.
--   • status_date    — the bill's last status date as reported by
--     the legis.ga.gov search index. The job uses this as a cheap
--     change signal: a bill's version list (and therefore its LC
--     number) only changes when its status advances, so unchanged
--     bills are skipped on subsequent runs. This keeps steady-state
--     runs fast even though the table now covers ~5k+ bills.
-- ============================================================

alter table public.bill_lc_history
  add column if not exists legislation_id bigint,
  add column if not exists status_date text;

create index if not exists idx_bill_lc_history_legislation_id
  on public.bill_lc_history (legislation_id);
