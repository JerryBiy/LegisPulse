-- ============================================================
-- Fix infinite recursion in team / team_members / team_bills RLS
--
-- Root cause: the SELECT policy on team_members subqueries
-- team_members itself (self-recursion) and mutually subqueries
-- teams, which in turn subqueries team_members (mutual recursion).
--
-- Fix: rewrite all three policies to use the existing
-- get_my_team_ids() SECURITY DEFINER function (migration 004),
-- which bypasses RLS so subqueries don't re-trigger policies.
-- ============================================================

-- ─── team_members ────────────────────────────────────────────
drop policy if exists "Team participants can read members" on public.team_members;

create policy "Team participants can read members"
  on public.team_members for select
  using ( team_id in (select public.get_my_team_ids()) );

-- ─── teams ───────────────────────────────────────────────────
drop policy if exists "Team members can read their team" on public.teams;

create policy "Team members can read their team"
  on public.teams for select
  using ( id in (select public.get_my_team_ids()) );

-- ─── team_bills ──────────────────────────────────────────────
drop policy if exists "Team members can manage team bills" on public.team_bills;

create policy "Team members can manage team bills"
  on public.team_bills for all
  using     ( team_id in (select public.get_my_team_ids()) )
  with check ( team_id in (select public.get_my_team_ids()) );
