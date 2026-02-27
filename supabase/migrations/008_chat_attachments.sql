-- ============================================================
-- Chat attachments support + storage bucket
-- Run in Supabase SQL Editor.
-- ============================================================

-- 1) Add attachment columns to team_chat_messages
alter table public.team_chat_messages
  add column if not exists attachment_url  text,
  add column if not exists attachment_name text,
  add column if not exists attachment_type text,
  add column if not exists attachment_size bigint;

-- 2) Create storage bucket for chat files (if not exists)
insert into storage.buckets (id, name, public)
values ('team-chat-files', 'team-chat-files', true)
on conflict (id) do nothing;

-- 3) Storage policies — team members can upload/read/delete their own files
create policy "Team members can upload chat files"
  on storage.objects for insert
  with check (
    bucket_id = 'team-chat-files'
    and auth.uid() is not null
  );

create policy "Anyone can read chat files"
  on storage.objects for select
  using (bucket_id = 'team-chat-files');

create policy "Users can delete own chat files"
  on storage.objects for delete
  using (
    bucket_id = 'team-chat-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 4) Update the get_team_chat_messages RPC to include attachment columns
drop function if exists public.get_team_chat_messages(uuid);
create or replace function public.get_team_chat_messages(p_team_id uuid)
returns table (
  id              uuid,
  team_id         uuid,
  user_id         uuid,
  message         text,
  created_at      timestamptz,
  sender_name     text,
  sender_email    text,
  attachment_url  text,
  attachment_name text,
  attachment_type text,
  attachment_size bigint
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
    p.email as sender_email,
    m.attachment_url,
    m.attachment_name,
    m.attachment_type,
    m.attachment_size
  from public.team_chat_messages m
  left join public.profiles p on p.id = m.user_id
  where m.team_id = p_team_id
    and p_team_id in (select public.get_my_team_ids())
  order by m.created_at asc
  limit 200;
$$;

-- 5) Update the send_team_chat_message RPC to accept attachment fields
drop function if exists public.send_team_chat_message(uuid, text);
drop function if exists public.send_team_chat_message(uuid, text, text, text, text, bigint);
create or replace function public.send_team_chat_message(
  p_team_id         uuid,
  p_message         text,
  p_attachment_url  text default null,
  p_attachment_name text default null,
  p_attachment_type text default null,
  p_attachment_size bigint default null
)
returns table (
  id              uuid,
  team_id         uuid,
  user_id         uuid,
  message         text,
  created_at      timestamptz,
  sender_name     text,
  sender_email    text,
  attachment_url  text,
  attachment_name text,
  attachment_type text,
  attachment_size bigint
)
language sql
security definer
set search_path = public
as $$
  with inserted as (
    insert into public.team_chat_messages
      (team_id, user_id, message, attachment_url, attachment_name, attachment_type, attachment_size)
    select
      p_team_id, auth.uid(), trim(p_message),
      p_attachment_url, p_attachment_name, p_attachment_type, p_attachment_size
    where p_team_id in (select public.get_my_team_ids())
    returning
      team_chat_messages.id,
      team_chat_messages.team_id,
      team_chat_messages.user_id,
      team_chat_messages.message,
      team_chat_messages.created_at,
      team_chat_messages.attachment_url,
      team_chat_messages.attachment_name,
      team_chat_messages.attachment_type,
      team_chat_messages.attachment_size
  )
  select
    ins.id, ins.team_id, ins.user_id, ins.message, ins.created_at,
    pr.name  as sender_name,
    pr.email as sender_email,
    ins.attachment_url, ins.attachment_name, ins.attachment_type, ins.attachment_size
  from inserted ins
  left join public.profiles pr on pr.id = ins.user_id;
$$;
