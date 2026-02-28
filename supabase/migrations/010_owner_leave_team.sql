-- ============================================================
-- Allow team owners to leave their team.
-- Ownership is transferred to the next active member
-- (earliest joined_at). If no other members exist the team
-- is deleted entirely.
-- Run in Supabase SQL Editor.
-- ============================================================

create or replace function public.leave_my_team(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role          text;
  v_next_user_id  uuid;
  v_next_member_id uuid;
begin
  -- Verify caller is in this team
  select role into v_role
  from public.team_members
  where team_id = p_team_id
    and user_id  = auth.uid()
    and status   = 'active';

  if v_role is null then
    raise exception 'You are not an active member of this team.';
  end if;

  if v_role = 'member' then
    -- Simple case: just remove themselves
    delete from public.team_members
    where team_id = p_team_id
      and user_id  = auth.uid();
    return;
  end if;

  -- Owner path: find the next active member to promote
  select id, user_id
  into v_next_member_id, v_next_user_id
  from public.team_members
  where team_id = p_team_id
    and user_id <> auth.uid()
    and status   = 'active'
    and role     = 'member'
  order by joined_at asc
  limit 1;

  if v_next_user_id is null then
    -- No other members — delete the whole team (cascade handles everything)
    delete from public.teams where id = p_team_id;
    return;
  end if;

  -- Transfer ownership
  update public.teams
  set created_by = v_next_user_id
  where id = p_team_id;

  -- Promote the new owner's member row
  update public.team_members
  set role = 'owner'
  where id = v_next_member_id;

  -- Remove the old owner
  delete from public.team_members
  where team_id = p_team_id
    and user_id  = auth.uid();
end;
$$;
