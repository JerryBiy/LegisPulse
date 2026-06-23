-- Capture three team RPCs that previously existed only in the live database
-- (created via the Supabase dashboard and never committed). Without these,
-- a database rebuilt purely from migrations would have broken team invite
-- and member-removal flows. Definitions below are the exact live versions.
--
--   get_my_pending_invites()       — pending invites for the current user's email
--   decline_my_team_invite(uuid)   — decline one of my own pending invites
--   remove_team_member(uuid)       — owner removes a member from a team they own
--
-- All three are SECURITY DEFINER so they can read/modify team_members rows
-- across users, scoped by the auth.uid() checks in each body.

create or replace function public.get_my_pending_invites()
  returns table(
    id uuid,
    team_id uuid,
    invite_email text,
    role text,
    status text,
    team_name text
  )
  language plpgsql
  security definer
as $function$
begin
  return query
    select tm.id, tm.team_id, tm.email, tm.role, tm.status, t.name
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
    where lower(tm.email) = lower((select u.email from auth.users u where u.id = auth.uid()))
      and tm.status = 'pending';
end;
$function$;

create or replace function public.decline_my_team_invite(invite_id uuid)
  returns void
  language plpgsql
  security definer
as $function$
begin
  delete from public.team_members
  where id = invite_id
    and lower(email) = lower((select email from auth.users where id = auth.uid()))
    and status = 'pending';
end;
$function$;

create or replace function public.remove_team_member(member_id uuid)
  returns void
  language plpgsql
  security definer
as $function$
begin
  delete from public.team_members
  where id = member_id
    and team_id in (
      select id from public.teams where created_by = auth.uid()
    );
end;
$function$;

-- Allow the app's authenticated role to call these RPCs.
grant execute on function public.get_my_pending_invites() to authenticated;
grant execute on function public.decline_my_team_invite(uuid) to authenticated;
grant execute on function public.remove_team_member(uuid) to authenticated;
