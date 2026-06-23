-- ============================================================
-- 024: Persistent legislative events
--
-- GA legislature events were previously fetched from Open States
-- on every page load and lost when React Query cache expired.
-- This migration stores them in Supabase so:
--   - All events since session start are retained permanently
--   - Rescheduled meetings overwrite their old time (upsert by id)
--   - Events are available instantly from DB on load; Open States
--     API syncs in the background to keep times current
-- ============================================================

create table if not exists public.legislative_events (
  -- Open States OCD event ID is the stable identifier across reschedules
  id             text primary key,
  title          text not null,
  description    text,
  start_time     timestamptz not null,
  end_time       timestamptz,
  all_day        boolean default false,
  color          text default 'gold',
  location       text,
  location_url   text,
  classification text,
  bills          jsonb default '[]'::jsonb,
  participants   jsonb default '[]'::jsonb,
  links          jsonb default '[]'::jsonb,
  -- Tracks when this record was last synced from the Open States API
  fetched_at     timestamptz default now() not null,
  updated_at     timestamptz default now() not null
);

-- Fast range queries for the calendar date window
create index if not exists idx_legislative_events_start
  on public.legislative_events (start_time);

alter table public.legislative_events enable row level security;

-- Any authenticated user can read (shared public legislative data)
create policy "Authenticated users can read legislative events"
  on public.legislative_events for select
  using (auth.uid() is not null);

-- Any authenticated user can insert (the client upserts on API sync)
create policy "Authenticated users can insert legislative events"
  on public.legislative_events for insert
  with check (auth.uid() is not null);

-- Any authenticated user can update (reschedule overwrites old time)
create policy "Authenticated users can update legislative events"
  on public.legislative_events for update
  using (auth.uid() is not null)
  with check (auth.uid() is not null);
