-- ============================================================
-- Shared LegiScan bill archive
-- ============================================================
-- Migration 036 tracked archive versions per user because public.bills is
-- user-owned. This migration promotes provider snapshots and their version
-- metadata to shared authenticated caches. Historical sessions already in
-- Supabase are then available to every account without a LegiScan download.
-- ============================================================

begin;

-- --------------------------------------------------------------------------
-- 1. Shared provider snapshots, one row per state/session/bill number.
-- --------------------------------------------------------------------------

create table if not exists public.legislative_bill_cache (
  state           text not null default 'GA',
  session_id      bigint not null check (session_id > 0),
  bill_number     text not null,
  legiscan_id     text not null,
  payload         jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now(),
  primary key (state, session_id, bill_number)
);

create unique index if not exists legislative_bill_cache_legiscan_key
  on public.legislative_bill_cache (state, session_id, legiscan_id);

create index if not exists legislative_bill_cache_session_idx
  on public.legislative_bill_cache (state, session_id);

alter table public.legislative_bill_cache enable row level security;

drop policy if exists "Authenticated users can read legislative bill cache"
  on public.legislative_bill_cache;
create policy "Authenticated users can read legislative bill cache"
  on public.legislative_bill_cache for select
  using (auth.uid() is not null);

drop policy if exists "Authenticated users can insert legislative bill cache"
  on public.legislative_bill_cache;
create policy "Authenticated users can insert legislative bill cache"
  on public.legislative_bill_cache for insert
  with check (auth.uid() is not null);

drop policy if exists "Authenticated users can update legislative bill cache"
  on public.legislative_bill_cache;
create policy "Authenticated users can update legislative bill cache"
  on public.legislative_bill_cache for update
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- Seed the shared archive from the best existing user-owned copy. This makes
-- every historical session already present in Supabase immediately available.
with ranked_bills as (
  select
    bill_row.*,
    row_number() over (
      partition by
        upper(btrim(bill_row.state)),
        bill_row.session_id,
        upper(regexp_replace(bill_row.bill_number, '\s+', '', 'g'))
      order by
        (bill_row.legiscan_id is not null) desc,
        coalesce(bill_row.extra ? 'change_hash', false) desc,
        bill_row.created_date desc,
        bill_row.id desc
    ) as archive_rank
  from public.bills as bill_row
  where bill_row.session_id > 0
    and bill_row.bill_number is not null
    and btrim(bill_row.bill_number) <> ''
    and bill_row.legiscan_id is not null
    and btrim(bill_row.legiscan_id) <> ''
),
archive_rows as (
  select
    upper(btrim(ranked_row.state)) as state,
    ranked_row.session_id,
    upper(regexp_replace(ranked_row.bill_number, '\s+', '', 'g'))
      as bill_number,
    btrim(ranked_row.legiscan_id) as legiscan_id,
    jsonb_build_object(
      'state', upper(btrim(ranked_row.state)),
      'session_id', ranked_row.session_id,
      'session_name', ranked_row.session_name,
      'session', ranked_row.session,
      'legiscan_id', btrim(ranked_row.legiscan_id),
      'bill_number', upper(regexp_replace(ranked_row.bill_number, '\s+', '', 'g')),
      'title', ranked_row.title,
      'chamber', ranked_row.chamber,
      'bill_type', ranked_row.bill_type,
      'sponsor', ranked_row.sponsor,
      'sponsor_party', ranked_row.sponsor_party,
      'sponsors', ranked_row.sponsors,
      'co_sponsors', ranked_row.co_sponsors,
      'session_year', ranked_row.session_year,
      'status', ranked_row.status,
      'last_action', ranked_row.last_action,
      'last_action_date', ranked_row.last_action_date,
      'current_committee', ranked_row.current_committee,
      'url', ranked_row.url,
      'extra', ranked_row.extra
    ) as payload
  from ranked_bills as ranked_row
  where ranked_row.archive_rank = 1
)
insert into public.legislative_bill_cache (
  state,
  session_id,
  bill_number,
  legiscan_id,
  payload
)
select
  archive_row.state,
  archive_row.session_id,
  archive_row.bill_number,
  archive_row.legiscan_id,
  archive_row.payload
from archive_rows as archive_row
on conflict (state, session_id, bill_number) do update
set
  legiscan_id = excluded.legiscan_id,
  payload = excluded.payload,
  updated_at = now();

-- Update the shared provider cache from a normalized application master list.
create or replace function public.sync_legislative_bill_cache(
  p_state text,
  p_session_id bigint,
  p_bills jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_state text := upper(btrim(p_state));
  v_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;
  if p_session_id is null or p_session_id <= 0 then
    raise exception 'A positive LegiScan session_id is required.';
  end if;
  if v_state is null or v_state = '' or
    jsonb_typeof(coalesce(p_bills, '[]'::jsonb)) <> 'array' then
    raise exception 'A state and JSON bill array are required.';
  end if;

  with raw_incoming as (
    select
      incoming_item.value as payload,
      upper(regexp_replace(incoming_item.value ->> 'bill_number', '\s+', '', 'g'))
        as bill_number,
      nullif(btrim(incoming_item.value ->> 'legiscan_id'), '') as legiscan_id
    from jsonb_array_elements(coalesce(p_bills, '[]'::jsonb))
      as incoming_item(value)
  ),
  incoming as (
    select distinct on (raw_row.bill_number)
      raw_row.bill_number,
      raw_row.legiscan_id,
      (
        raw_row.payload
        - 'id'
        - 'user_id'
        - 'summary'
        - 'changes_analysis'
        - 'ai_analysis'
        - 'tracked'
        - 'is_tracked'
        - 'pdf_url'
        - 'tags'
        - 'created_date'
      ) || jsonb_build_object(
        'state', v_state,
        'session_id', p_session_id,
        'bill_number', raw_row.bill_number,
        'legiscan_id', raw_row.legiscan_id
      ) as payload
    from raw_incoming as raw_row
    where raw_row.bill_number <> ''
      and raw_row.legiscan_id is not null
    order by raw_row.bill_number, raw_row.legiscan_id
  ),
  upserted as (
    insert into public.legislative_bill_cache (
      state,
      session_id,
      bill_number,
      legiscan_id,
      payload
    )
    select
      v_state,
      p_session_id,
      incoming_row.bill_number,
      incoming_row.legiscan_id,
      incoming_row.payload
    from incoming as incoming_row
    on conflict (state, session_id, bill_number) do update
    set
      legiscan_id = excluded.legiscan_id,
      payload = excluded.payload,
      updated_at = now()
    returning 1
  )
  select count(*)::integer into v_count from upserted;

  return v_count;
end
$function$;

revoke all on function public.sync_legislative_bill_cache(text, bigint, jsonb)
  from public;
grant execute on function public.sync_legislative_bill_cache(text, bigint, jsonb)
  to authenticated, service_role;

-- Materialize a shared snapshot into the caller's existing user-owned model.
-- This is a database-local copy, not an external sync, and migration 034's RPC
-- preserves summaries, analysis, tags, PDFs, history, and other user fields.
create or replace function public.hydrate_cached_session_bills(
  p_state text,
  p_session_id bigint
)
returns integer
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_state text := upper(btrim(p_state));
  v_payload jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;
  if p_session_id is null or p_session_id <= 0 then
    raise exception 'A positive LegiScan session_id is required.';
  end if;

  select coalesce(
    jsonb_agg(cache_row.payload order by cache_row.bill_number),
    '[]'::jsonb
  )
  into v_payload
  from public.legislative_bill_cache as cache_row
  where cache_row.state = v_state
    and cache_row.session_id = p_session_id;

  return public.sync_session_bills(v_state, p_session_id, v_payload);
end
$function$;

revoke all on function public.hydrate_cached_session_bills(text, bigint)
  from public;
grant execute on function public.hydrate_cached_session_bills(text, bigint)
  to authenticated, service_role;

-- --------------------------------------------------------------------------
-- 2. Promote migration 036's hashes into shared session metadata.
-- --------------------------------------------------------------------------
-- Two 036 shapes have existed during development. If user_id is present,
-- collapse the per-user rows into one shared row. If it is absent, the table
-- is already shared and remains in place. Dynamic SQL prevents PostgreSQL from
-- resolving a column or staging relation that the installed shape does not use.

do $migration$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'bill_session_sync_state'
      and column_name = 'user_id'
  ) then
    execute 'drop table if exists public.bill_session_sync_state_v037';
    execute $sql$
      create table public.bill_session_sync_state_v037 (
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
        primary key (state, session_id)
      )
    $sql$;
    execute $sql$
      with ranked_sync_state as (
        select
          sync_row.*,
          row_number() over (
            partition by upper(btrim(sync_row.state)), sync_row.session_id
            order by sync_row.last_synced_at desc, sync_row.user_id
          ) as sync_rank
        from public.bill_session_sync_state as sync_row
        where exists (
          select 1
          from public.legislative_bill_cache as cache_row
          where cache_row.state = upper(btrim(sync_row.state))
            and cache_row.session_id = sync_row.session_id
        )
      )
      insert into public.bill_session_sync_state_v037 (
        state,
        session_id,
        dataset_hash,
        session_name,
        year_start,
        year_end,
        is_special,
        is_prior,
        is_sine_die,
        bill_count,
        last_synced_at
      )
      select
        upper(btrim(sync_row.state)),
        sync_row.session_id,
        sync_row.dataset_hash,
        sync_row.session_name,
        sync_row.year_start,
        sync_row.year_end,
        sync_row.is_special,
        sync_row.is_prior,
        sync_row.is_sine_die,
        sync_row.bill_count,
        sync_row.last_synced_at
      from ranked_sync_state as sync_row
      where sync_row.sync_rank = 1
    $sql$;
    execute 'drop table public.bill_session_sync_state';
    execute 'alter table public.bill_session_sync_state_v037 rename to bill_session_sync_state';
  end if;
end
$migration$;

create unique index if not exists bill_session_sync_state_state_session_key
  on public.bill_session_sync_state (state, session_id);

create index if not exists bill_session_sync_state_state_year_idx
  on public.bill_session_sync_state (state, year_end desc, year_start desc);

alter table public.bill_session_sync_state enable row level security;

drop policy if exists "Users manage their own bill session sync state"
  on public.bill_session_sync_state;
drop policy if exists "Authenticated users can read bill session sync state"
  on public.bill_session_sync_state;
drop policy if exists "Authenticated users can insert bill session sync state"
  on public.bill_session_sync_state;
drop policy if exists "Authenticated users can update bill session sync state"
  on public.bill_session_sync_state;

create policy "Authenticated users can read bill session sync state"
  on public.bill_session_sync_state for select
  using (auth.uid() is not null);

create policy "Authenticated users can insert bill session sync state"
  on public.bill_session_sync_state for insert
  with check (auth.uid() is not null);

create policy "Authenticated users can update bill session sync state"
  on public.bill_session_sync_state for update
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- Register every populated shared session as a baseline. Existing hashes are
-- preserved; missing hashes are adopted by the app without a provider fetch.
insert into public.bill_session_sync_state as session_state (
  state,
  session_id,
  dataset_hash,
  bill_count,
  last_synced_at
)
select
  cache_row.state,
  cache_row.session_id,
  null,
  count(*)::integer,
  now()
from public.legislative_bill_cache as cache_row
group by cache_row.state, cache_row.session_id
on conflict (state, session_id) do update
set bill_count = greatest(
  session_state.bill_count,
  excluded.bill_count
);

comment on table public.legislative_bill_cache is
  'Shared provider-owned LegiScan bill snapshots; user analysis remains in public.bills.';
comment on table public.bill_session_sync_state is
  'Tracks the shared LegiScan dataset version stored for each session archive.';
comment on column public.bill_session_sync_state.dataset_hash is
  'LegiScan getSessionList dataset_hash used to detect archive corrections.';

commit;
