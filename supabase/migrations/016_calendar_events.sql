-- ============================================================
-- Calendar Events
-- User-owned calendar events with title, description, time, color.
-- ============================================================

-- ─── Table ───────────────────────────────────────────────────
create table if not exists public.calendar_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  description text,
  start_time  timestamptz not null,
  end_time    timestamptz not null,
  all_day     boolean default false,
  color       text default 'blue',
  location    text,
  created_at  timestamptz default now() not null,
  updated_at  timestamptz default now() not null
);

alter table public.calendar_events enable row level security;

-- ─── RLS Policies ────────────────────────────────────────────

create policy "Users can view their own events"
  on public.calendar_events for select
  using (auth.uid() = user_id);

create policy "Users can insert their own events"
  on public.calendar_events for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own events"
  on public.calendar_events for update
  using (auth.uid() = user_id);

create policy "Users can delete their own events"
  on public.calendar_events for delete
  using (auth.uid() = user_id);

-- ─── Index ────────────────────────────────────────────────────
create index if not exists idx_calendar_events_user_start
  on public.calendar_events (user_id, start_time);

-- ─── Updated-at trigger ──────────────────────────────────────
create or replace function public.update_calendar_event_timestamp()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_calendar_event_updated_at
  before update on public.calendar_events
  for each row execute procedure public.update_calendar_event_timestamp();
