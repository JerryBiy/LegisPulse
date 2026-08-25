-- ============================================================
-- Remove unresolved pre-session data
-- ============================================================
-- Migration 034 deliberately preserved ambiguous legacy rows under the
-- sentinel session_id = 0. A bill number is not enough to determine which
-- General Assembly session it belongs to, so those records must not be
-- guessed into a live session. This migration deletes the stale queue and
-- makes a positive LegiScan session_id mandatory for all session-owned data.
-- ============================================================

begin;

-- Alerts reference transcripts. Delete explicit child rows first; the
-- transcript cascade also removes any related keyword/favorite records.
delete from public.meeting_alerts where session_id = 0;
delete from public.meeting_transcripts where session_id = 0;

delete from public.tracked_bill_ids where session_id = 0;
delete from public.team_bills where session_id = 0;
delete from public.user_bill_metadata where session_id = 0;
delete from public.bill_lc_tracking where session_id = 0;
delete from public.bill_lc_history where session_id = 0;
delete from public.notifications where session_id = 0;
delete from public.legislative_events where session_id = 0;
delete from public.ga_meetings_cache where session_id = 0;
delete from public.calendar_events where session_id = 0;
delete from public.tweets where session_id = 0;
delete from public.bills where session_id = 0;

-- The obsolete profile array cannot safely be assigned to a session either.
update public.profiles
set tracked_bill_ids = '[]'::jsonb
where tracked_bill_ids is distinct from '[]'::jsonb;

drop function if exists public.import_legacy_tracked_bills(
  text,
  bigint,
  text[]
);

do $migration$
declare
  table_name text;
  constraint_name text;
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
    constraint_name := table_name || '_positive_session_id_check';
    execute format(
      'alter table public.%I alter column session_id drop default',
      table_name
    );
    execute format(
      'alter table public.%I drop constraint if exists %I',
      table_name,
      constraint_name
    );
    execute format(
      'alter table public.%I add constraint %I check (session_id > 0)',
      table_name,
      constraint_name
    );
    execute format(
      'comment on column public.%I.session_id is %L',
      table_name,
      'Positive LegiScan session_id; unresolved or provider-specific session IDs are not allowed.'
    );
  end loop;
end
$migration$;

commit;
