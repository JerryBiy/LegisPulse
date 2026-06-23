-- Schema diagnostic: reports which tables, functions (RPCs), and storage
-- buckets the LegisTrack app expects vs. what actually exists in this
-- database. Run this in the Supabase SQL editor. Rows marked "MISSING"
-- need their migration applied (or, for the three flagged RPCs, recreated
-- — they are called by the app but have no migration in the repo).
--
-- This is a read-only diagnostic, NOT a migration. It does not change anything.

with expected(name, kind, source) as (
  values
    -- ── Tables ──────────────────────────────────────────────────────────────
    ('profiles',             'table',    '001'),
    ('bills',                'table',    '001'),
    ('tracked_bill_ids',     'table',    '001'),
    ('email_lists',          'table',    '001'),
    ('notifications',        'table',    '001'),
    ('tweets',               'table',    '001'),
    ('teams',                'table',    '001'),
    ('team_members',         'table',    '001'),
    ('team_bills',           'table',    '001'),
    ('team_chat_messages',   'table',    '003'),
    ('user_bill_metadata',   'table',    '013 / 027'),
    ('calendar_events',      'table',    '016'),
    ('bill_lc_tracking',     'table',    '017'),
    ('ga_meetings_cache',    'table',    '023'),
    ('bill_lc_history',      'table',    '024'),
    -- ── Functions / RPCs ────────────────────────────────────────────────────
    ('handle_new_user',                   'function', '001'),
    ('get_my_team_ids',                   'function', '004 / 007'),
    ('get_team_member_profiles',          'function', '004 / 007 / 021'),
    ('get_team_chat_messages',            'function', '005 / 007 / 008 / 021'),
    ('send_team_chat_message',            'function', '006 / 007 / 008 / 021'),
    ('cleanup_old_chat_messages',         'function', '003 / 007'),
    ('leave_my_team',                     'function', '010'),
    ('generate_unique_team_code',         'function', '011'),
    ('join_team_by_code',                 'function', '011 / 014 / 015'),
    ('accept_my_team_invites',            'function', '009 / 014'),
    ('rename_team',                       'function', '014'),
    ('approve_join_request',              'function', '015'),
    ('decline_join_request',              'function', '015'),
    ('get_team_bills_data',               'function', '022'),
    ('update_calendar_event_timestamp',   'function', '016'),
    ('update_ga_meetings_cache_timestamp','function', '023'),
    ('update_bill_lc_history_timestamp',  'function', '024'),
    -- ⚠ Called by the app but NOT defined in any migration:
    ('get_my_pending_invites',  'function', '⚠ NOT IN REPO'),
    ('remove_team_member',      'function', '⚠ NOT IN REPO'),
    ('decline_my_team_invite',  'function', '⚠ NOT IN REPO'),
    -- ── Storage buckets ─────────────────────────────────────────────────────
    ('profile-avatars',  'bucket', '020'),
    ('team-chat-files',  'bucket', '008')
),
present as (
  select table_name as name, 'table' as kind
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  union all
  select p.proname, 'function'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  union all
  select id, 'bucket' from storage.buckets
)
select
  e.kind,
  e.name,
  e.source                                              as expected_from,
  case when pr.name is not null then '✅ present'
       else '❌ MISSING' end                            as status
from expected e
left join present pr
  on pr.name = e.name and pr.kind = e.kind
order by (pr.name is not null) asc,  -- missing rows first
         e.kind,
         e.name;
