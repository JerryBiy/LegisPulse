-- ============================================================
-- SECURITY DEFINER RPC for reading team chat messages.
-- Bypasses table-level RLS entirely — permission check is
-- done inside the function using get_my_team_ids().
-- Run in Supabase SQL Editor.
-- ============================================================

create or replace function public.get_team_chat_messages(p_team_id uuid)
returns table (
  id         uuid,
  team_id    uuid,
  user_id    uuid,
  message    text,
  created_at timestamptz,
  sender_name  text,
  sender_email text
)
language sql
security definer
stable
set search_path = public
as $$
  -- Abort if the caller is not a member of this team
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
