-- ============================================================
-- COMPREHENSIVE chat fix — run this SINGLE file in Supabase SQL Editor.
-- It (re)creates every function the chat system needs.
-- Safe to run multiple times (all CREATE OR REPLACE).
-- ============================================================

-- 1) Helper: team IDs the calling user belongs to (bypasses RLS)
create or replace function public.get_my_team_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from public.teams where created_by = auth.uid()
  union
  select team_id from public.team_members
    where user_id = auth.uid() and status = 'active';
$$;

-- 2) Cleanup: delete messages older than 2.5 weeks
create or replace function public.cleanup_old_chat_messages()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.team_chat_messages
  where created_at < now() - interval '17 days 12 hours';
$$;

-- 3) Read messages (SECURITY DEFINER — bypasses all RLS)
create or replace function public.get_team_chat_messages(p_team_id uuid)
returns table (
  id           uuid,
  team_id      uuid,
  user_id      uuid,
  message      text,
  created_at   timestamptz,
  sender_name  text,
  sender_email text
)
language sql
security definer
stable
set search_path = public
as $$
  select
    m.id,
    m.team_id,
    m.user_id,
    m.message,
    m.created_at,
    p.name  as sender_name,
    p.email as sender_email
  from public.team_chat_messages m
  left join public.profiles p on p.id = m.user_id
  where m.team_id = p_team_id
    and p_team_id in (select public.get_my_team_ids())
  order by m.created_at asc
  limit 200;
$$;

-- 4) Send a message (SECURITY DEFINER — bypasses INSERT RLS)
create or replace function public.send_team_chat_message(
  p_team_id uuid,
  p_message text
)
returns table (
  id           uuid,
  team_id      uuid,
  user_id      uuid,
  message      text,
  created_at   timestamptz,
  sender_name  text,
  sender_email text
)
language sql
security definer
set search_path = public
as $$
  with inserted as (
    insert into public.team_chat_messages (team_id, user_id, message)
    select p_team_id, auth.uid(), trim(p_message)
    where p_team_id in (select public.get_my_team_ids())
    returning
      team_chat_messages.id,
      team_chat_messages.team_id,
      team_chat_messages.user_id,
      team_chat_messages.message,
      team_chat_messages.created_at
  )
  select
    ins.id,
    ins.team_id,
    ins.user_id,
    ins.message,
    ins.created_at,
    pr.name  as sender_name,
    pr.email as sender_email
  from inserted ins
  left join public.profiles pr on pr.id = ins.user_id;
$$;

-- 5) Fetch team member profiles (for realtime enrichment)
create or replace function public.get_team_member_profiles(p_team_id uuid)
returns table (id uuid, name text, email text)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.name, p.email
  from public.profiles p
  where p.id in (
    select tm.user_id from public.team_members tm
    where tm.team_id = p_team_id
      and tm.status  = 'active'
      and tm.user_id is not null
    union
    select t.created_by from public.teams t
    where t.id = p_team_id
  )
  and p_team_id in (select public.get_my_team_ids());
$$;
