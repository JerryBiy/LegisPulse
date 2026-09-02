-- ============================================================
-- Shared X feed and session-aware bill-movement early alerts
-- ============================================================
-- X is an early signal only. These tables do not update public.bills or the
-- shared LegiScan archive; official legislative data remains authoritative.
-- ============================================================

begin;

create table if not exists public.x_posts (
  state                 text not null default 'GA',
  session_id            bigint not null check (session_id > 0),
  post_id               text not null,
  account_id            text,
  account_name          text,
  account_handle        text not null,
  content               text not null,
  posted_at             timestamptz not null,
  post_url              text not null,
  related_bill_numbers  text[] not null default '{}',
  media_urls            text[] not null default '{}',
  engagement            jsonb,
  raw                    jsonb,
  ingested_at            timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  primary key (state, session_id, post_id)
);

create index if not exists x_posts_session_posted_idx
  on public.x_posts (state, session_id, posted_at desc);

-- Keep ambiguous posts out of every session feed until they can be resolved.
-- The collector retries these rows on later runs instead of guessing and
-- mixing a regular-session bill with a same-numbered special-session bill.
create table if not exists public.x_unmatched_posts (
  state                 text not null default 'GA',
  post_id               text not null,
  account_id            text,
  account_name          text,
  account_handle        text not null,
  content               text not null,
  posted_at             timestamptz not null,
  post_url              text not null,
  related_bill_numbers  text[] not null default '{}',
  media_urls            text[] not null default '{}',
  engagement            jsonb,
  raw                    jsonb,
  unresolved_reason     text not null,
  first_seen_at         timestamptz not null default now(),
  last_attempt_at       timestamptz not null default now(),
  primary key (state, post_id)
);

create table if not exists public.x_bill_movements (
  state          text not null default 'GA',
  session_id     bigint not null check (session_id > 0),
  post_id        text not null,
  bill_type      text not null check (bill_type in ('HB', 'HR', 'SB', 'SR')),
  bill_number    integer not null check (bill_number > 0),
  bill_ref       text generated always as (bill_type || bill_number::text) stored,
  movement_type  text not null check (
    movement_type in (
      'introduced',
      'assigned_to_committee',
      'committee_hearing',
      'passed_committee',
      'passed_by_substitute',
      'amended',
      'passed_house',
      'passed_senate',
      'failed',
      'sent_to_governor',
      'signed',
      'vetoed'
    )
  ),
  confidence     numeric(4, 3) not null default 0.750
                   check (confidence >= 0 and confidence <= 1),
  evidence       text,
  detected_at    timestamptz not null default now(),
  primary key (
    state,
    session_id,
    post_id,
    bill_type,
    bill_number,
    movement_type
  ),
  foreign key (state, session_id, post_id)
    references public.x_posts (state, session_id, post_id)
    on delete cascade
);

create index if not exists x_bill_movements_bill_idx
  on public.x_bill_movements (
    state,
    session_id,
    bill_type,
    bill_number,
    detected_at desc
  );

create table if not exists public.x_feed_sync_state (
  state              text primary key default 'GA',
  monitored_handles  text[] not null default '{}',
  last_post_id       text,
  last_attempt_at    timestamptz,
  last_success_at    timestamptz,
  last_error         text,
  fetched_count      integer not null default 0,
  matched_count      integer not null default 0,
  notified_count     integer not null default 0,
  updated_at         timestamptz not null default now()
);

alter table public.x_posts enable row level security;
alter table public.x_unmatched_posts enable row level security;
alter table public.x_bill_movements enable row level security;
alter table public.x_feed_sync_state enable row level security;

drop policy if exists "Authenticated users can read X posts"
  on public.x_posts;
create policy "Authenticated users can read X posts"
  on public.x_posts for select
  using (auth.uid() is not null);

drop policy if exists "Authenticated users can read X bill movements"
  on public.x_bill_movements;
create policy "Authenticated users can read X bill movements"
  on public.x_bill_movements for select
  using (auth.uid() is not null);

drop policy if exists "Authenticated users can read X sync state"
  on public.x_feed_sync_state;
create policy "Authenticated users can read X sync state"
  on public.x_feed_sync_state for select
  using (auth.uid() is not null);

revoke all on public.x_posts from anon, authenticated;
revoke all on public.x_unmatched_posts from anon, authenticated;
revoke all on public.x_bill_movements from anon, authenticated;
revoke all on public.x_feed_sync_state from anon, authenticated;
grant select on public.x_posts to authenticated;
grant select on public.x_bill_movements to authenticated;
grant select on public.x_feed_sync_state to authenticated;
grant all on public.x_posts to service_role;
grant all on public.x_unmatched_posts to service_role;
grant all on public.x_bill_movements to service_role;
grant all on public.x_feed_sync_state to service_role;

-- One notification per recipient/post/bill. Personal tracking and every
-- active team membership are combined with UNION, so overlap never creates a
-- duplicate notification. The positive session_id and split type/number are
-- part of every match.
create or replace function public.record_x_bill_early_alert(
  p_state text,
  p_session_id bigint,
  p_post_id text,
  p_bill_type text,
  p_bill_number integer,
  p_movements jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_state text := upper(btrim(p_state));
  v_bill_type text := upper(btrim(p_bill_type));
  v_bill_ref text;
  v_post public.x_posts%rowtype;
  v_legiscan_id text;
  v_movement_labels text;
  v_notification_count integer := 0;
begin
  if v_state is null or v_state = '' then
    raise exception 'A state is required.';
  end if;
  if p_session_id is null or p_session_id <= 0 then
    raise exception 'A positive LegiScan session_id is required.';
  end if;
  if v_bill_type is null or
     v_bill_type not in ('HB', 'HR', 'SB', 'SR') or
     p_bill_number is null or p_bill_number <= 0 then
    raise exception 'A supported bill type and positive bill number are required.';
  end if;
  if jsonb_typeof(coalesce(p_movements, '[]'::jsonb)) <> 'array' then
    raise exception 'p_movements must be a JSON array.';
  end if;

  select post_row.*
  into v_post
  from public.x_posts as post_row
  where post_row.state = v_state
    and post_row.session_id = p_session_id
    and post_row.post_id = p_post_id;

  if not found then
    raise exception 'The session-scoped X post must be stored before alerting.';
  end if;

  v_bill_ref := v_bill_type || p_bill_number::text;

  insert into public.x_bill_movements (
    state,
    session_id,
    post_id,
    bill_type,
    bill_number,
    movement_type,
    confidence,
    evidence
  )
  select
    v_state,
    p_session_id,
    p_post_id,
    v_bill_type,
    p_bill_number,
    movement_item.value ->> 'type',
    least(
      1,
      greatest(
        0,
        coalesce((movement_item.value ->> 'confidence')::numeric, 0.750)
      )
    ),
    nullif(btrim(movement_item.value ->> 'evidence'), '')
  from jsonb_array_elements(coalesce(p_movements, '[]'::jsonb))
    as movement_item(value)
  where movement_item.value ->> 'type' in (
    'introduced',
    'assigned_to_committee',
    'committee_hearing',
    'passed_committee',
    'passed_by_substitute',
    'amended',
    'passed_house',
    'passed_senate',
    'failed',
    'sent_to_governor',
    'signed',
    'vetoed'
  )
  on conflict do nothing;

  select string_agg(
    distinct initcap(replace(movement_item.value ->> 'type', '_', ' ')),
    ', '
  )
  into v_movement_labels
  from jsonb_array_elements(coalesce(p_movements, '[]'::jsonb))
    as movement_item(value)
  where movement_item.value ->> 'type' in (
    'introduced',
    'assigned_to_committee',
    'committee_hearing',
    'passed_committee',
    'passed_by_substitute',
    'amended',
    'passed_house',
    'passed_senate',
    'failed',
    'sent_to_governor',
    'signed',
    'vetoed'
  );

  -- A mention without a classified movement remains visible in X Feed but
  -- does not generate a potentially misleading notification.
  if v_movement_labels is null then
    return 0;
  end if;

  select cache_row.legiscan_id
  into v_legiscan_id
  from public.legislative_bill_cache as cache_row
  where cache_row.state = v_state
    and cache_row.session_id = p_session_id
    and cache_row.bill_number = v_bill_ref
  limit 1;

  with recipients as (
    select tracked_row.user_id
    from public.tracked_bill_ids as tracked_row
    where tracked_row.state = v_state
      and tracked_row.session_id = p_session_id
      and tracked_row.bill_number = v_bill_ref

    union

    select membership_row.user_id
    from public.team_bills as team_bill_row
    join public.team_members as membership_row
      on membership_row.team_id = team_bill_row.team_id
     and membership_row.status = 'active'
     and membership_row.user_id is not null
    where team_bill_row.state = v_state
      and team_bill_row.session_id = p_session_id
      and team_bill_row.bill_number = v_bill_ref
  ),
  eligible_recipients as (
    select recipient_row.user_id
    from recipients as recipient_row
    left join public.profiles as profile_row
      on profile_row.id = recipient_row.user_id
    where coalesce(profile_row.twitter_notifications_enabled, true)
  ),
  inserted_notifications as (
    insert into public.notifications (
      id,
      user_id,
      state,
      session_id,
      legiscan_id,
      type,
      title,
      message,
      bill_id,
      read,
      created_date,
      extra
    )
    select
      'x-' || md5(
        v_state || ':' || p_session_id::text || ':' || p_post_id || ':' ||
        v_bill_ref || ':' || recipient_row.user_id::text
      ),
      recipient_row.user_id,
      v_state,
      p_session_id,
      v_legiscan_id,
      'x_early_alert',
      v_bill_ref || ': ' || v_movement_labels || ' (X early alert)',
      v_post.content,
      v_bill_ref,
      false,
      now(),
      jsonb_build_object(
        'priority', 'high',
        'source', 'x',
        'source_of_truth', 'early_alert_only',
        'requires_official_confirmation', true,
        'x_post_id', p_post_id,
        'x_post_url', v_post.post_url,
        'account_handle', v_post.account_handle,
        'bill_type', v_bill_type,
        'bill_number', p_bill_number,
        'movements', p_movements
      )
    from eligible_recipients as recipient_row
    on conflict (id) do nothing
    returning 1
  )
  select count(*)::integer
  into v_notification_count
  from inserted_notifications;

  return v_notification_count;
end
$function$;

revoke all on function public.record_x_bill_early_alert(
  text,
  bigint,
  text,
  text,
  integer,
  jsonb
) from public, anon, authenticated;
grant execute on function public.record_x_bill_early_alert(
  text,
  bigint,
  text,
  text,
  integer,
  jsonb
) to service_role;

comment on table public.x_posts is
  'Shared official X posts classified into one verified LegiScan session; early signal only.';
comment on table public.x_bill_movements is
  'Deterministic movement signals keyed by session + bill type + bill number.';
comment on function public.record_x_bill_early_alert(
  text,
  bigint,
  text,
  text,
  integer,
  jsonb
) is
  'Creates idempotent early-alert notifications for personal and active team followers without changing official bill status.';

commit;
