-- ============================================================
-- Per-user LegiScan session sync state
-- ============================================================
-- Bill caches are user-owned, so their provider dataset version must be
-- tracked per user as well. Historical sessions can then be reused from
-- public.bills and refreshed only when LegiScan's dataset_hash changes.
-- ============================================================

begin;

create table if not exists public.bill_session_sync_state (
  user_id         uuid not null references auth.users(id) on delete cascade,
  state           text not null default 'GA',
  session_id      bigint not null check (session_id > 0),
  dataset_hash    text,
  session_name    text,
  year_start      integer,
  year_end        integer,
  is_special      boolean not null default false,
  is_prior        boolean not null default false,
  is_sine_die     boolean not null default false,
  bill_count      integer not null default 0 check (bill_count >= 0),
  last_synced_at  timestamptz not null default now(),
  primary key (user_id, state, session_id)
);

create index if not exists bill_session_sync_state_user_state_idx
  on public.bill_session_sync_state (user_id, state, year_end desc, year_start desc);

alter table public.bill_session_sync_state enable row level security;

drop policy if exists "Users manage their own bill session sync state"
  on public.bill_session_sync_state;
create policy "Users manage their own bill session sync state"
  on public.bill_session_sync_state for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

comment on table public.bill_session_sync_state is
  'Tracks the LegiScan dataset version stored in each user-owned session bill cache.';
comment on column public.bill_session_sync_state.dataset_hash is
  'LegiScan getSessionList dataset_hash used to detect archive corrections.';

commit;
