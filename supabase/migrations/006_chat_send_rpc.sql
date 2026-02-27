-- ============================================================
-- Security-definer RPC for inserting team chat messages.
-- Bypasses INSERT RLS so any verified team member can post.
-- Run in Supabase SQL Editor.
-- ============================================================

create or replace function public.send_team_chat_message(
  p_team_id uuid,
  p_message  text
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
