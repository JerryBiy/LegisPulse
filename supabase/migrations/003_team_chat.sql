-- ============================================================
-- Team Chat Messages
-- Messages are automatically purged after 2.5 weeks (17 days 12 hours).
-- Run this in the Supabase SQL Editor for your project.
-- ============================================================

-- ─── Table ───────────────────────────────────────────────────
create table if not exists public.team_chat_messages (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  message    text not null,
  created_at timestamptz default now() not null
);

alter table public.team_chat_messages enable row level security;

-- ─── RLS Policies ────────────────────────────────────────────

-- Active team members can read messages in their team
create policy "Team members can read chat messages"
  on public.team_chat_messages for select
  using (
    team_id in (
      select id from public.teams where created_by = auth.uid()
      union
      select team_id from public.team_members
        where user_id = auth.uid() and status = 'active'
    )
  );

-- Active team members can send messages
create policy "Team members can send chat messages"
  on public.team_chat_messages for insert
  with check (
    user_id = auth.uid()
    and team_id in (
      select id from public.teams where created_by = auth.uid()
      union
      select team_id from public.team_members
        where user_id = auth.uid() and status = 'active'
    )
  );

-- Users can delete their own messages
create policy "Users can delete own chat messages"
  on public.team_chat_messages for delete
  using (user_id = auth.uid());

-- ─── Cleanup Function ────────────────────────────────────────
-- Call this function to remove messages older than 2.5 weeks (17 days 12 hours).
-- It is called automatically on every message fetch from the client.
create or replace function public.cleanup_old_chat_messages()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.team_chat_messages
  where created_at < now() - interval '17 days 12 hours';
$$;

-- Optional: Enable pg_cron for fully automatic cleanup.
-- First enable the pg_cron extension in Supabase Dashboard → Database → Extensions,
-- then run this separately:
-- select cron.schedule('cleanup-chat', '0 */6 * * *', 'select cleanup_old_chat_messages()');

-- ─── Realtime ────────────────────────────────────────────────
-- Enable Supabase Realtime for instant message delivery.
-- Run the following in the Supabase Dashboard → Database → Replication,
-- or execute it here:
alter publication supabase_realtime add table public.team_chat_messages;
