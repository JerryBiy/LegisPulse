-- ============================================================
-- Fix team_chat_messages RLS + expose team member profiles
-- Run this in the Supabase SQL Editor for your project.
-- ============================================================

-- ─── Helper: returns team IDs the current user belongs to ────
-- SECURITY DEFINER bypasses RLS on team_members/teams so the
-- subquery doesn't get caught in recursive RLS evaluation.
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

-- ─── Recreate team_chat_messages RLS using the helper ────────
drop policy if exists "Team members can read chat messages"  on public.team_chat_messages;
drop policy if exists "Team members can send chat messages"  on public.team_chat_messages;
drop policy if exists "Users can delete own chat messages"   on public.team_chat_messages;

create policy "Team members can read chat messages"
  on public.team_chat_messages for select
  using ( team_id in (select public.get_my_team_ids()) );

create policy "Team members can send chat messages"
  on public.team_chat_messages for insert
  with check (
    user_id = auth.uid()
    and team_id in (select public.get_my_team_ids())
  );

create policy "Users can delete own chat messages"
  on public.team_chat_messages for delete
  using (user_id = auth.uid());

-- ─── RPC: fetch profiles for all members of a team ───────────
-- Returns name + email for every active member so the chat UI
-- can display sender names without hitting profiles RLS.
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
    select user_id from public.team_members
    where team_id = p_team_id
      and status  = 'active'
      and user_id is not null
    union
    select created_by from public.teams
    where id = p_team_id
  )
  -- caller must actually be a member of the team
  and p_team_id in (select public.get_my_team_ids());
$$;
