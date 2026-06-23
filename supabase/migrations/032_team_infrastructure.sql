-- ============================================================
-- 023: Full team infrastructure rebuild
--
-- Problems this fixes:
--   1. Infinite recursion in team RLS: policies on team_members
--      referenced teams, which referenced team_members, looping
--      forever. Fixed by routing all membership checks through
--      SECURITY DEFINER functions that bypass RLS.
--   2. "Team owners can manage members" policy was never updated
--      to use the get_my_team_ids() helper, leaving a live
--      recursive path even after migration 022.
--   3. Three RPCs called by the client were never created:
--      get_my_pending_invites, remove_team_member,
--      decline_my_team_invite.
--   4. createTeam() in the client does direct table inserts,
--      triggering RLS on both tables in sequence. The new
--      create_team() RPC handles both atomically under
--      SECURITY DEFINER, bypassing RLS entirely.
-- ============================================================


-- ─── Helper functions ────────────────────────────────────────

-- Returns every team ID the current user owns OR is an active member of.
-- SECURITY DEFINER means it reads teams/team_members as the function
-- owner (postgres), bypassing RLS — this is what breaks the recursion.
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

-- Returns only team IDs the current user owns.
-- Used in write policies for team_members so ownership is checked
-- without touching team_members itself (which would be recursive).
create or replace function public.get_my_owned_team_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from public.teams where created_by = auth.uid();
$$;


-- ─── teams RLS ───────────────────────────────────────────────

drop policy if exists "Team owner full access"           on public.teams;
drop policy if exists "Team members can read their team" on public.teams;

-- Owner gets full CRUD; using + with check prevents ownership transfer.
create policy "Team owner full access"
  on public.teams for all
  using     (created_by = auth.uid())
  with check (created_by = auth.uid());

-- Active members can read teams they belong to.
create policy "Team members can read their team"
  on public.teams for select
  using (id in (select public.get_my_team_ids()));


-- ─── team_members RLS ────────────────────────────────────────

drop policy if exists "Team participants can read members"  on public.team_members;
drop policy if exists "Team owners can manage members"      on public.team_members;
drop policy if exists "Users can activate their own invite" on public.team_members;

-- All members of a team can see who else is in it.
create policy "Team participants can read members"
  on public.team_members for select
  using (team_id in (select public.get_my_team_ids()));

-- Owners can insert / update / delete member rows in their teams.
-- Uses get_my_owned_team_ids() — reads only teams (no team_members),
-- so there is no possible recursion path.
create policy "Team owners can manage members"
  on public.team_members for all
  using     (team_id in (select public.get_my_owned_team_ids()))
  with check (team_id in (select public.get_my_owned_team_ids()));

-- Invited users can flip their own row from pending → active.
create policy "Users can activate their own invite"
  on public.team_members for update
  using     (email = (select email from auth.users where id = auth.uid()))
  with check (email = (select email from auth.users where id = auth.uid()));


-- ─── team_bills RLS ──────────────────────────────────────────

drop policy if exists "Team members can manage team bills" on public.team_bills;

create policy "Team members can manage team bills"
  on public.team_bills for all
  using     (team_id in (select public.get_my_team_ids()))
  with check (team_id in (select public.get_my_team_ids()));


-- ─── create_team RPC ─────────────────────────────────────────
-- Atomically creates a team and adds the caller as owner.
-- SECURITY DEFINER bypasses RLS on both inserts so the recursive
-- policy chain is never entered at all.

create or replace function public.create_team(p_name text)
returns table (
  id         uuid,
  name       text,
  created_by uuid,
  team_code  text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email   text;
  v_team_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated.';
  end if;

  if trim(p_name) = '' then
    raise exception 'Team name cannot be empty.';
  end if;

  select u.email into v_email
  from auth.users u
  where u.id = v_user_id;

  -- Insert team; the trg_set_team_code trigger assigns team_code.
  insert into public.teams (name, created_by)
  values (trim(p_name), v_user_id)
  returning teams.id into v_team_id;

  -- Insert the creator as owner.
  insert into public.team_members (team_id, user_id, email, role, status)
  values (v_team_id, v_user_id, v_email, 'owner', 'active');

  return query
    select t.id, t.name, t.created_by, t.team_code, t.created_at
    from public.teams t
    where t.id = v_team_id;
end;
$$;


-- ─── get_my_pending_invites RPC ──────────────────────────────
-- Returns pending invite rows addressed to the caller's email.
-- Referenced by getAll(), getOrCreate(), getTeamNotifications()
-- in apiClient.js but was never defined in any migration.

create or replace function public.get_my_pending_invites()
returns table (
  id           uuid,
  team_id      uuid,
  invite_email text,
  role         text,
  status       text,
  team_name    text
)
language sql
security definer
stable
set search_path = public
as $$
  select
    tm.id,
    tm.team_id,
    tm.email   as invite_email,
    tm.role,
    tm.status,
    t.name     as team_name
  from public.team_members tm
  join public.teams t on t.id = tm.team_id
  where tm.status = 'pending'
    and lower(tm.email) = lower(
      (select u.email from auth.users u where u.id = auth.uid())
    );
$$;


-- ─── remove_team_member RPC ──────────────────────────────────
-- Owner removes any member from their team.
-- Referenced by removeMember() in apiClient.js but never defined.

create or replace function public.remove_team_member(member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
begin
  select team_id into v_team_id
  from public.team_members
  where id = member_id;

  if v_team_id is null then
    raise exception 'Member not found.';
  end if;

  if not exists (
    select 1 from public.teams
    where id = v_team_id and created_by = auth.uid()
  ) then
    raise exception 'Only the team owner can remove members.';
  end if;

  delete from public.team_members where id = member_id;
end;
$$;


-- ─── decline_my_team_invite RPC ──────────────────────────────
-- Caller declines (deletes) a pending invite addressed to them.
-- Referenced by declineInvite() in apiClient.js but never defined.

create or replace function public.decline_my_team_invite(invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  select u.email into v_email
  from auth.users u
  where u.id = auth.uid();

  if not exists (
    select 1 from public.team_members
    where id = invite_id
      and lower(email) = lower(v_email)
      and status = 'pending'
  ) then
    raise exception 'Invite not found or does not belong to you.';
  end if;

  delete from public.team_members where id = invite_id;
end;
$$;
