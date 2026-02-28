-- ============================================================
-- When a user accepts an invite while already in a team,
-- automatically remove them from their current (member) team
-- before activating the new invite.
-- If the user OWNS a team:
--   - Blocked if the owned team still has other active members.
--   - Owned team is deleted (cascade) if they're the only member.
-- Run in Supabase SQL Editor.
-- ============================================================

create or replace function public.accept_my_team_invites()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owned_team_id   uuid;
  v_other_members   int;
begin
  -- Check if caller owns a team
  select id into v_owned_team_id
  from public.teams
  where created_by = auth.uid()
  limit 1;

  if v_owned_team_id is not null then
    -- Count active members OTHER than the owner
    select count(*) into v_other_members
    from public.team_members
    where team_id = v_owned_team_id
      and status  = 'active'
      and role    = 'member';

    if v_other_members > 0 then
      -- Transfer ownership to the next active member (earliest joined_at)
      declare
        v_next_member_id uuid;
        v_next_user_id   uuid;
      begin
        select id, user_id
        into v_next_member_id, v_next_user_id
        from public.team_members
        where team_id = v_owned_team_id
          and user_id <> auth.uid()
          and status  = 'active'
          and role    = 'member'
        order by joined_at asc
        limit 1;

        update public.teams
        set created_by = v_next_user_id
        where id = v_owned_team_id;

        update public.team_members
        set role = 'owner'
        where id = v_next_member_id;
      end;
    end if;

    -- Remove the owner's own member row from the old team
    delete from public.team_members
    where team_id = v_owned_team_id
      and user_id  = auth.uid();

    -- If the team is now empty, clean it up
    if v_other_members = 0 then
      delete from public.teams where id = v_owned_team_id;
    end if;
  end if;

  -- Drop any remaining active non-owner memberships (invited-member case)
  delete from public.team_members
  where user_id = auth.uid()
    and status  = 'active'
    and role    = 'member';

  -- Activate all pending invites for this email address
  update public.team_members
  set    user_id = auth.uid(),
         status  = 'active'
  where  lower(email) = lower(
           (select u.email from auth.users u where u.id = auth.uid())
         )
    and  status = 'pending';
end;
$$;
