-- ============================================================
-- LegiScan session isolation
-- ============================================================
-- A bill number is only unique inside a state + LegiScan session.
-- Session 0 is an explicit legacy/unresolved sentinel. Existing rows are
-- preserved there; this migration intentionally does not infer a real
-- session from a year or bill number.
--
-- Application writes for LegiScan-backed data should always supply:
--   state      -- two-letter state code, e.g. "GA"
--   session_id -- the LegiScan session_id (never a legis.ga.gov session id)
--   legiscan_id (for bill-reference rows whenever it is known)
-- ============================================================

begin;

-- --------------------------------------------------------------------------
-- 1. Add the shared state/session boundary to every session-owned record.
-- --------------------------------------------------------------------------

alter table public.bills
  add column if not exists state text not null default 'GA',
  add column if not exists session_id bigint not null default 0,
  add column if not exists session_name text;

alter table public.tracked_bill_ids
  add column if not exists state text not null default 'GA',
  add column if not exists session_id bigint not null default 0,
  add column if not exists bill_number text,
  add column if not exists legiscan_id text;

alter table public.team_bills
  add column if not exists state text not null default 'GA',
  add column if not exists session_id bigint not null default 0,
  add column if not exists legiscan_id text;

alter table public.user_bill_metadata
  add column if not exists state text not null default 'GA',
  add column if not exists session_id bigint not null default 0,
  add column if not exists legiscan_id text;

alter table public.bill_lc_tracking
  add column if not exists state text not null default 'GA',
  add column if not exists session_id bigint not null default 0,
  add column if not exists legiscan_id text;

alter table public.bill_lc_history
  add column if not exists state text not null default 'GA',
  add column if not exists session_id bigint not null default 0,
  add column if not exists legiscan_id text;

alter table public.meeting_transcripts
  add column if not exists state text not null default 'GA',
  add column if not exists session_id bigint not null default 0;

alter table public.meeting_alerts
  add column if not exists state text not null default 'GA',
  add column if not exists session_id bigint not null default 0,
  add column if not exists legiscan_id text;

alter table public.notifications
  add column if not exists state text not null default 'GA',
  add column if not exists session_id bigint not null default 0,
  add column if not exists legiscan_id text;

alter table public.legislative_events
  add column if not exists state text not null default 'GA',
  add column if not exists session_id bigint not null default 0,
  add column if not exists source_id text;

alter table public.ga_meetings_cache
  add column if not exists state text not null default 'GA',
  add column if not exists session_id bigint not null default 0;

alter table public.calendar_events
  add column if not exists state text not null default 'GA',
  add column if not exists session_id bigint not null default 0;

alter table public.tweets
  add column if not exists state text not null default 'GA',
  add column if not exists session_id bigint not null default 0,
  add column if not exists related_bill_numbers text[] not null default '{}',
  add column if not exists related_legiscan_ids text[] not null default '{}';

update public.tweets
set related_bill_numbers = '{}'
where related_bill_numbers is null;

update public.tweets
set related_legiscan_ids = '{}'
where related_legiscan_ids is null;

alter table public.tweets
  alter column related_bill_numbers set default '{}',
  alter column related_bill_numbers set not null,
  alter column related_legiscan_ids set default '{}',
  alter column related_legiscan_ids set not null;

-- A development database may have indexes from an earlier partial draft of
-- this migration. Remove them before normalizing their indexed values; they
-- are recreated below after collision repair.
drop index if exists public.tracked_bill_ids_user_state_session_bill_key;
drop index if exists public.tracked_bill_ids_user_state_session_number_key;
drop index if exists public.tracked_bill_ids_user_state_session_legiscan_key;

-- `ADD COLUMN IF NOT EXISTS` does not repair a column that was introduced by
-- a partially-applied development migration with weaker null/default rules.
-- Normalize those columns before enforcing the final contract.
do $migration$
declare
  table_name text;
begin
  foreach table_name in array array[
    'bills',
    'tracked_bill_ids',
    'team_bills',
    'user_bill_metadata',
    'bill_lc_tracking',
    'bill_lc_history',
    'meeting_transcripts',
    'meeting_alerts',
    'notifications',
    'legislative_events',
    'ga_meetings_cache',
    'calendar_events',
    'tweets'
  ]
  loop
    execute format(
      'update public.%I set state = ''GA'' where state is null or btrim(state) = ''''',
      table_name
    );
    execute format(
      'update public.%I set state = upper(btrim(state)) where state <> upper(btrim(state))',
      table_name
    );
    execute format(
      'update public.%I set session_id = 0 where session_id is null',
      table_name
    );
    execute format(
      'alter table public.%I alter column state set default ''GA''',
      table_name
    );
    execute format(
      'alter table public.%I alter column state set not null',
      table_name
    );
    execute format(
      'alter table public.%I alter column session_id set default 0',
      table_name
    );
    execute format(
      'alter table public.%I alter column session_id set not null',
      table_name
    );
  end loop;
end
$migration$;

-- Normalize every legacy tracking number only after state/session repair.
-- Whitespace variants such as "HB 1" and "HB1" were both valid under the
-- old (user_id, bill_id) key. Keep one deterministic row after normalization
-- so the new session-aware bill-number key can always be created.
update public.tracked_bill_ids
set bill_number = upper(
  regexp_replace(
    coalesce(nullif(btrim(bill_number), ''), btrim(bill_id)),
    '\s+',
    '',
    'g'
  )
);

with ranked_tracking_rows as (
  select
    tracking_row.id,
    row_number() over (
      partition by
        tracking_row.user_id,
        tracking_row.state,
        tracking_row.session_id,
        tracking_row.bill_number
      order by
        (tracking_row.legiscan_id is not null) desc,
        tracking_row.created_at asc,
        tracking_row.id asc
    ) as duplicate_rank
  from public.tracked_bill_ids as tracking_row
)
delete from public.tracked_bill_ids as tracking_row
using ranked_tracking_rows as ranked_row
where tracking_row.id = ranked_row.id
  and ranked_row.duplicate_rank > 1;

alter table public.tracked_bill_ids
  alter column bill_number set not null;

comment on column public.bills.session_id is
  'LegiScan session_id. 0 means legacy/unresolved and must not be treated as a real session.';
comment on column public.tracked_bill_ids.session_id is
  'LegiScan session_id. 0 means legacy/unresolved.';
comment on column public.team_bills.session_id is
  'LegiScan session_id. 0 means legacy/unresolved.';
comment on column public.user_bill_metadata.session_id is
  'LegiScan session_id. 0 means legacy/unresolved.';
comment on column public.bill_lc_tracking.session_id is
  'LegiScan session_id. 0 means legacy/unresolved.';
comment on column public.bill_lc_history.session_id is
  'LegiScan session_id. 0 means legacy/unresolved.';
comment on column public.meeting_transcripts.session_id is
  'LegiScan session_id associated with the meeting. 0 means legacy/unresolved.';
comment on column public.meeting_alerts.session_id is
  'LegiScan session_id associated with the alerted bill. 0 means legacy/unresolved.';
comment on column public.notifications.session_id is
  'LegiScan session_id associated with the notification. 0 means legacy/unresolved or session-neutral.';
comment on column public.legislative_events.session_id is
  'LegiScan session_id associated with the event. 0 means legacy/unresolved.';
comment on column public.ga_meetings_cache.session_id is
  'LegiScan session_id associated with the cached meeting. 0 means legacy/unresolved.';
comment on column public.calendar_events.session_id is
  'LegiScan session_id selected when the user event was created. 0 means legacy/unresolved.';
comment on column public.tweets.session_id is
  'LegiScan session_id used to classify this tweet. 0 means legacy/unresolved.';

-- --------------------------------------------------------------------------
-- 2. Replace bill-number-only ownership keys with session-aware keys.
-- --------------------------------------------------------------------------

-- Lightweight personal tracking.
alter table public.tracked_bill_ids
  drop constraint if exists tracked_bill_ids_user_id_bill_id_key;

create unique index if not exists tracked_bill_ids_user_state_session_bill_key
  on public.tracked_bill_ids (user_id, state, session_id, bill_id);

create unique index if not exists tracked_bill_ids_user_state_session_number_key
  on public.tracked_bill_ids (user_id, state, session_id, bill_number);

create unique index if not exists tracked_bill_ids_user_state_session_legiscan_key
  on public.tracked_bill_ids (user_id, state, session_id, legiscan_id)
  where session_id <> 0 and legiscan_id is not null;

-- Older releases stored personal tracking only as a JSON array on profiles.
-- Preserve those bill numbers in the unresolved session-0 queue. The app
-- requires the user to choose a real session before assigning any of them.
with legacy_profile_bills as (
  select
    profile_row.id as user_id,
    upper(regexp_replace(legacy_item.value #>> '{}', '\s+', '', 'g'))
      as bill_number
  from public.profiles as profile_row
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(profile_row.tracked_bill_ids) = 'array'
        then profile_row.tracked_bill_ids
      else '[]'::jsonb
    end
  ) as legacy_item(value)
  where jsonb_typeof(legacy_item.value) = 'string'
)
insert into public.tracked_bill_ids (
  user_id,
  bill_id,
  state,
  session_id,
  bill_number,
  legiscan_id
)
select
  legacy_row.user_id,
  'legacy:GA:0:' || legacy_row.bill_number,
  'GA',
  0,
  legacy_row.bill_number,
  null
from legacy_profile_bills as legacy_row
where legacy_row.bill_number <> ''
on conflict (user_id, state, session_id, bill_number) do nothing;

-- The relational session-0 queue is now the durable legacy source. Clearing
-- the obsolete JSON prevents a rerun from resurrecting already-reconciled rows.
update public.profiles
set tracked_bill_ids = '[]'::jsonb
where jsonb_typeof(tracked_bill_ids) = 'array'
  and jsonb_array_length(tracked_bill_ids) > 0;

-- Team tracking and team notes/assignments.
alter table public.team_bills
  drop constraint if exists team_bills_team_id_bill_number_key;

create unique index if not exists team_bills_team_state_session_bill_key
  on public.team_bills (team_id, state, session_id, bill_number);

create unique index if not exists team_bills_team_state_session_legiscan_key
  on public.team_bills (team_id, state, session_id, legiscan_id)
  where session_id <> 0 and legiscan_id is not null;

-- Per-user notes and detailed AI analysis.
alter table public.user_bill_metadata
  drop constraint if exists user_bill_metadata_user_id_bill_number_key;

create unique index if not exists user_bill_metadata_user_state_session_bill_key
  on public.user_bill_metadata (user_id, state, session_id, bill_number);

create unique index if not exists user_bill_metadata_user_state_session_legiscan_key
  on public.user_bill_metadata (user_id, state, session_id, legiscan_id)
  where session_id <> 0 and legiscan_id is not null;

-- Per-user LC acknowledgement state.
alter table public.bill_lc_tracking
  drop constraint if exists bill_lc_tracking_user_id_bill_number_key;

create unique index if not exists bill_lc_tracking_user_state_session_bill_key
  on public.bill_lc_tracking (user_id, state, session_id, bill_number);

create unique index if not exists bill_lc_tracking_user_state_session_legiscan_key
  on public.bill_lc_tracking (user_id, state, session_id, legiscan_id)
  where session_id <> 0 and legiscan_id is not null;

-- The global LC table previously used bill_number alone as its primary key.
-- Replace it only when necessary so rerunning this migration remains safe.
do $migration$
declare
  primary_key_name text;
  primary_key_columns text[];
begin
  select
    constraint_row.conname,
    array_agg(attribute_row.attname::text order by key_column.ordinality)
  into primary_key_name, primary_key_columns
  from pg_constraint constraint_row
  cross join lateral unnest(constraint_row.conkey)
    with ordinality as key_column(attnum, ordinality)
  join pg_attribute attribute_row
    on attribute_row.attrelid = constraint_row.conrelid
   and attribute_row.attnum = key_column.attnum
  where constraint_row.conrelid = 'public.bill_lc_history'::regclass
    and constraint_row.contype = 'p'
  group by constraint_row.conname;

  if primary_key_name is not null
     and primary_key_columns is distinct from
       array['state', 'session_id', 'bill_number']::text[] then
    execute format(
      'alter table public.bill_lc_history drop constraint %I',
      primary_key_name
    );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.bill_lc_history'::regclass
      and contype = 'p'
  ) then
    alter table public.bill_lc_history
      add constraint bill_lc_history_pkey
      primary key (state, session_id, bill_number);
  end if;
end
$migration$;

create unique index if not exists bill_lc_history_state_session_legiscan_key
  on public.bill_lc_history (state, session_id, legiscan_id)
  where session_id <> 0 and legiscan_id is not null;

-- Bill cache rows are user-owned. LegiScan IDs identify a bill exactly within
-- a real session; legacy session-0 rows are excluded to avoid guessing/deduping.
create unique index if not exists bills_user_state_session_legiscan_key
  on public.bills (user_id, state, session_id, legiscan_id)
  where session_id <> 0 and legiscan_id is not null;

create unique index if not exists bills_user_state_session_number_key
  on public.bills (user_id, state, session_id, bill_number)
  where session_id <> 0 and bill_number is not null;

create index if not exists bills_user_state_session_idx
  on public.bills (user_id, state, session_id);

create index if not exists bills_state_session_bill_number_idx
  on public.bills (state, session_id, bill_number);

-- Meeting IDs are no longer assumed to be globally unique across sessions.
alter table public.meeting_transcripts
  drop constraint if exists meeting_transcripts_meeting_id_key;

create unique index if not exists meeting_transcripts_state_session_meeting_key
  on public.meeting_transcripts (state, session_id, meeting_id);

-- Session-aware lookup indexes for records without a bill-number uniqueness
-- constraint of their own.
create index if not exists meeting_alerts_user_state_session_seen_idx
  on public.meeting_alerts (user_id, state, session_id, seen);

create index if not exists meeting_alerts_state_session_bill_idx
  on public.meeting_alerts (state, session_id, bill_number);

create index if not exists notifications_user_state_session_read_idx
  on public.notifications (user_id, state, session_id, read);

create index if not exists notifications_state_session_legiscan_idx
  on public.notifications (state, session_id, legiscan_id)
  where legiscan_id is not null;

create index if not exists legislative_events_state_session_start_idx
  on public.legislative_events (state, session_id, start_time);

create unique index if not exists ga_meetings_state_session_legis_key
  on public.ga_meetings_cache (state, session_id, legis_id)
  where legis_id is not null;

create index if not exists ga_meetings_state_session_start_idx
  on public.ga_meetings_cache (state, session_id, start_time);

create index if not exists calendar_events_user_state_session_start_idx
  on public.calendar_events (user_id, state, session_id, start_time);

create index if not exists tweets_user_state_session_posted_idx
  on public.tweets (user_id, state, session_id, posted_at);

-- --------------------------------------------------------------------------
-- 3. Recreate the shared-team RPC with an explicit session boundary.
-- --------------------------------------------------------------------------
-- Changing a PostgreSQL function's argument list creates an overload rather
-- than replacing the old function. Drop the one-argument version so callers
-- cannot accidentally bypass session isolation.
drop function if exists public.get_team_bills_data(text[]);

create or replace function public.get_team_bills_data(
  p_state text,
  p_session_id bigint,
  p_bill_numbers text[]
)
returns setof public.bills
language sql
security definer
stable
set search_path = public
as $function$
  select distinct on (bill_row.bill_number)
    bill_row.*
  from public.bills as bill_row
  where bill_row.state = upper(btrim(p_state))
    and bill_row.session_id = p_session_id
    and bill_row.bill_number = any(p_bill_numbers)
    and exists (
      select 1
      from public.team_bills as team_bill_row
      join public.team_members as membership_row
        on membership_row.team_id = team_bill_row.team_id
      where membership_row.user_id = auth.uid()
        and membership_row.status = 'active'
        and team_bill_row.state = bill_row.state
        and team_bill_row.session_id = bill_row.session_id
        and team_bill_row.bill_number = bill_row.bill_number
        and (
          team_bill_row.legiscan_id is null
          or team_bill_row.legiscan_id = bill_row.legiscan_id
        )
    )
  order by
    bill_row.bill_number,
    (bill_row.legiscan_id is not null) desc,
    bill_row.created_date desc;
$function$;

revoke all on function public.get_team_bills_data(text, bigint, text[])
  from public;
grant execute on function public.get_team_bills_data(text, bigint, text[])
  to authenticated, service_role;

-- Synchronize provider-owned bill fields without deleting the session or
-- overwriting user-owned summaries, analysis, tags, PDFs, history, and notes.
-- Each RPC call is one database transaction; a failed upsert leaves existing
-- rows intact.
create or replace function public.sync_session_bills(
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
  v_user_id uuid := auth.uid();
  v_count integer := 0;
begin
  if v_user_id is null then
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
      nullif(btrim(incoming_row.id), '') as id,
      upper(regexp_replace(incoming_row.bill_number, '\s+', '', 'g'))
        as bill_number,
      incoming_row.title,
      incoming_row.chamber,
      incoming_row.bill_type,
      incoming_row.sponsor,
      incoming_row.sponsor_party,
      incoming_row.sponsors,
      incoming_row.co_sponsors,
      incoming_row.session_year,
      incoming_row.status,
      incoming_row.last_action,
      incoming_row.last_action_date,
      incoming_row.current_committee,
      incoming_row.session_name,
      incoming_row.session,
      nullif(btrim(incoming_row.legiscan_id), '') as legiscan_id,
      incoming_row.url,
      incoming_row.extra
    from jsonb_to_recordset(coalesce(p_bills, '[]'::jsonb)) as incoming_row(
      id text,
      bill_number text,
      title text,
      chamber text,
      bill_type text,
      sponsor text,
      sponsor_party text,
      sponsors jsonb,
      co_sponsors jsonb,
      session_year integer,
      status text,
      last_action text,
      last_action_date text,
      current_committee text,
      session_name text,
      session text,
      legiscan_id text,
      url text,
      extra jsonb
    )
  ),
  incoming as (
    select distinct on (raw_row.bill_number)
      raw_row.*
    from raw_incoming as raw_row
    where raw_row.bill_number <> ''
      and raw_row.legiscan_id is not null
    order by raw_row.bill_number, raw_row.legiscan_id
  ),
  upserted as (
    insert into public.bills (
      id,
      user_id,
      state,
      session_id,
      session_name,
      session,
      bill_number,
      legiscan_id,
      title,
      chamber,
      bill_type,
      sponsor,
      sponsor_party,
      sponsors,
      co_sponsors,
      session_year,
      status,
      last_action,
      last_action_date,
      current_committee,
      url,
      extra
    )
    select
      coalesce(
        incoming_row.id,
        'bill-' || v_user_id::text || '-' || lower(v_state) || '-' ||
          p_session_id::text || '-' || incoming_row.legiscan_id
      ),
      v_user_id,
      v_state,
      p_session_id,
      incoming_row.session_name,
      incoming_row.session,
      incoming_row.bill_number,
      incoming_row.legiscan_id,
      incoming_row.title,
      incoming_row.chamber,
      incoming_row.bill_type,
      incoming_row.sponsor,
      incoming_row.sponsor_party,
      incoming_row.sponsors,
      incoming_row.co_sponsors,
      incoming_row.session_year,
      incoming_row.status,
      incoming_row.last_action,
      incoming_row.last_action_date,
      incoming_row.current_committee,
      incoming_row.url,
      incoming_row.extra
    from incoming as incoming_row
    on conflict (user_id, state, session_id, bill_number)
      where session_id <> 0 and bill_number is not null
    do update set
      session_name = excluded.session_name,
      session = excluded.session,
      legiscan_id = excluded.legiscan_id,
      title = excluded.title,
      chamber = excluded.chamber,
      bill_type = excluded.bill_type,
      sponsor = excluded.sponsor,
      sponsor_party = excluded.sponsor_party,
      sponsors = excluded.sponsors,
      co_sponsors = excluded.co_sponsors,
      session_year = excluded.session_year,
      status = excluded.status,
      last_action = excluded.last_action,
      last_action_date = excluded.last_action_date,
      current_committee = coalesce(
        excluded.current_committee,
        bills.current_committee
      ),
      url = excluded.url
    returning 1
  )
  select count(*)::integer into v_count from upserted;

  return v_count;
end
$function$;

revoke all on function public.sync_session_bills(text, bigint, jsonb)
  from public;
grant execute on function public.sync_session_bills(text, bigint, jsonb)
  to authenticated, service_role;

-- Atomically move explicitly selected legacy tracking rows into a real
-- session. Canonical LegiScan IDs are resolved from that user's scoped bill
-- cache inside the database; caller-provided IDs are never trusted.
create or replace function public.import_legacy_tracked_bills(
  p_state text,
  p_session_id bigint,
  p_bill_numbers text[]
)
returns integer
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_state text := upper(btrim(p_state));
  v_user_id uuid := auth.uid();
  v_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication is required.';
  end if;
  if p_session_id is null or p_session_id <= 0 then
    raise exception 'A positive LegiScan session_id is required.';
  end if;
  if v_state is null or v_state = '' then
    raise exception 'A state is required.';
  end if;

  with requested as (
    select distinct
      upper(regexp_replace(requested_number, '\s+', '', 'g')) as bill_number
    from unnest(coalesce(p_bill_numbers, array[]::text[])) as requested_number
  ),
  locked_legacy as (
    select tracking_row.id, tracking_row.bill_number
    from public.tracked_bill_ids as tracking_row
    join requested as requested_row
      on requested_row.bill_number = tracking_row.bill_number
    where tracking_row.user_id = v_user_id
      and tracking_row.state = v_state
      and tracking_row.session_id = 0
    for update of tracking_row
  ),
  canonical as (
    select
      legacy_row.id as legacy_id,
      bill_row.bill_number,
      bill_row.legiscan_id
    from locked_legacy as legacy_row
    join public.bills as bill_row
      on bill_row.user_id = v_user_id
      and bill_row.state = v_state
      and bill_row.session_id = p_session_id
      and bill_row.bill_number = legacy_row.bill_number
      and bill_row.legiscan_id is not null
  ),
  assigned as (
    insert into public.tracked_bill_ids (
      user_id,
      bill_id,
      state,
      session_id,
      bill_number,
      legiscan_id
    )
    select
      v_user_id,
      v_state || ':' || p_session_id::text || ':' || canonical_row.legiscan_id,
      v_state,
      p_session_id,
      canonical_row.bill_number,
      canonical_row.legiscan_id
    from canonical as canonical_row
    on conflict (user_id, state, session_id, bill_number)
    do update set
      bill_id = excluded.bill_id,
      legiscan_id = excluded.legiscan_id
    returning bill_number
  ),
  removed as (
    delete from public.tracked_bill_ids as legacy_row
    using canonical as canonical_row, assigned as assigned_row
    where legacy_row.id = canonical_row.legacy_id
      and assigned_row.bill_number = canonical_row.bill_number
    returning legacy_row.id
  )
  select count(*)::integer into v_count from removed;

  return v_count;
end
$function$;

revoke all on function public.import_legacy_tracked_bills(text, bigint, text[])
  from public;
grant execute on function public.import_legacy_tracked_bills(text, bigint, text[])
  to authenticated, service_role;

commit;
