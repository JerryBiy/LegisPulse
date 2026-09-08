-- ============================================================
-- 039: Committee meeting workspaces and human notes
--
-- A working agenda belongs to one user and never mutates the official
-- agenda snapshot. Notes are private unless the author explicitly shares
-- them with a team they currently belong to.
-- ============================================================

begin;

create table if not exists public.user_committee_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  state text not null default 'GA' check (char_length(state) = 2),
  session_id bigint not null check (session_id > 0),
  committee_id text not null,
  committee_name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, state, session_id, committee_id)
);

create index if not exists user_committee_assignments_lookup_idx
  on public.user_committee_assignments (user_id, state, session_id);

alter table public.user_committee_assignments enable row level security;
drop policy if exists "Users manage their committee assignments" on public.user_committee_assignments;
create policy "Users manage their committee assignments"
  on public.user_committee_assignments for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table if not exists public.meeting_agenda_workspaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  state text not null default 'GA' check (char_length(state) = 2),
  session_id bigint not null check (session_id > 0),
  provider_session_id bigint,
  meeting_id text not null,
  committee_id text,
  committee_name text not null,
  meeting_title text not null,
  meeting_start timestamptz not null,
  location text,
  agenda_url text,
  official_agenda_bill_numbers text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, state, session_id, meeting_id)
);

create index if not exists meeting_agenda_workspaces_lookup_idx
  on public.meeting_agenda_workspaces (user_id, state, session_id, meeting_start);

alter table public.meeting_agenda_workspaces enable row level security;
drop policy if exists "Users manage their meeting workspaces" on public.meeting_agenda_workspaces;
create policy "Users manage their meeting workspaces"
  on public.meeting_agenda_workspaces for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table if not exists public.meeting_agenda_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.meeting_agenda_workspaces(id) on delete cascade,
  bill_number text not null,
  bill_id text,
  bill_title text,
  position integer not null default 0 check (position >= 0),
  source text not null default 'official' check (source in ('official', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, bill_number)
);

create index if not exists meeting_agenda_items_order_idx
  on public.meeting_agenda_items (workspace_id, position);

alter table public.meeting_agenda_items enable row level security;
drop policy if exists "Users read their working agenda" on public.meeting_agenda_items;
drop policy if exists "Users insert into their working agenda" on public.meeting_agenda_items;
drop policy if exists "Users update their working agenda" on public.meeting_agenda_items;
drop policy if exists "Users delete from their working agenda" on public.meeting_agenda_items;
create policy "Users read their working agenda"
  on public.meeting_agenda_items for select
  using (exists (
    select 1 from public.meeting_agenda_workspaces workspace
    where workspace.id = workspace_id and workspace.user_id = auth.uid()
  ));
create policy "Users insert into their working agenda"
  on public.meeting_agenda_items for insert
  with check (exists (
    select 1 from public.meeting_agenda_workspaces workspace
    where workspace.id = workspace_id and workspace.user_id = auth.uid()
  ));
create policy "Users update their working agenda"
  on public.meeting_agenda_items for update
  using (exists (
    select 1 from public.meeting_agenda_workspaces workspace
    where workspace.id = workspace_id and workspace.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.meeting_agenda_workspaces workspace
    where workspace.id = workspace_id and workspace.user_id = auth.uid()
  ));
create policy "Users delete from their working agenda"
  on public.meeting_agenda_items for delete
  using (exists (
    select 1 from public.meeting_agenda_workspaces workspace
    where workspace.id = workspace_id and workspace.user_id = auth.uid()
  ));

create table if not exists public.meeting_notes (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  author_name text not null default 'LegiPulse user',
  team_id uuid references public.teams(id) on delete cascade,
  visibility text not null default 'private' check (visibility in ('private', 'team')),
  state text not null default 'GA' check (char_length(state) = 2),
  session_id bigint not null check (session_id > 0),
  meeting_id text not null,
  meeting_title text not null,
  meeting_start timestamptz not null,
  committee_id text,
  committee_name text not null,
  bill_number text not null,
  bill_id text,
  bill_title text,
  body_html text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meeting_notes_visibility_team_check check (
    (visibility = 'private' and team_id is null)
    or (visibility = 'team' and team_id is not null)
  ),
  unique (author_id, state, session_id, meeting_id, bill_number)
);

create index if not exists meeting_notes_author_idx
  on public.meeting_notes (author_id, state, session_id, meeting_start desc);
create index if not exists meeting_notes_team_idx
  on public.meeting_notes (team_id, state, session_id, meeting_start desc)
  where visibility = 'team';

create or replace function public.set_meeting_workflow_metadata()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  profile_name text;
  account_email text;
begin
  new.updated_at = now();
  if tg_table_name = 'meeting_notes' then
    new.author_id = auth.uid();
    select nullif(trim(p.name), '') into profile_name
      from public.profiles p where p.id = auth.uid();
    select u.email into account_email from auth.users u where u.id = auth.uid();
    new.author_name = coalesce(profile_name, split_part(account_email, '@', 1), 'LegiPulse user');
  end if;
  return new;
end;
$$;

drop trigger if exists set_meeting_agenda_workspaces_metadata on public.meeting_agenda_workspaces;
create trigger set_meeting_agenda_workspaces_metadata
  before update on public.meeting_agenda_workspaces
  for each row execute procedure public.set_meeting_workflow_metadata();
drop trigger if exists set_meeting_agenda_items_metadata on public.meeting_agenda_items;
create trigger set_meeting_agenda_items_metadata
  before update on public.meeting_agenda_items
  for each row execute procedure public.set_meeting_workflow_metadata();
drop trigger if exists set_meeting_notes_metadata on public.meeting_notes;
create trigger set_meeting_notes_metadata
  before insert or update on public.meeting_notes
  for each row execute procedure public.set_meeting_workflow_metadata();

alter table public.meeting_notes enable row level security;
drop policy if exists "Authors and teams read meeting notes" on public.meeting_notes;
drop policy if exists "Authors create meeting notes" on public.meeting_notes;
drop policy if exists "Authors update meeting notes" on public.meeting_notes;
drop policy if exists "Authors delete meeting notes" on public.meeting_notes;
create policy "Authors and teams read meeting notes"
  on public.meeting_notes for select
  using (
    author_id = auth.uid()
    or (visibility = 'team' and team_id in (select public.get_my_team_ids()))
  );
create policy "Authors create meeting notes"
  on public.meeting_notes for insert
  with check (
    author_id = auth.uid()
    and (
      (visibility = 'private' and team_id is null)
      or (visibility = 'team' and team_id in (select public.get_my_team_ids()))
    )
  );
create policy "Authors update meeting notes"
  on public.meeting_notes for update
  using (author_id = auth.uid())
  with check (
    author_id = auth.uid()
    and (
      (visibility = 'private' and team_id is null)
      or (visibility = 'team' and team_id in (select public.get_my_team_ids()))
    )
  );
create policy "Authors delete meeting notes"
  on public.meeting_notes for delete
  using (author_id = auth.uid());

create or replace function public.can_read_meeting_note(p_note_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.meeting_notes note
    where note.id = p_note_id
      and (
        note.author_id = auth.uid()
        or (note.visibility = 'team' and note.team_id in (select public.get_my_team_ids()))
      )
  );
$$;

create or replace function public.can_comment_on_meeting_note(p_note_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.meeting_notes note
    where note.id = p_note_id
      and note.visibility = 'team'
      and note.team_id in (select public.get_my_team_ids())
  );
$$;

create table if not exists public.meeting_note_comments (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.meeting_notes(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  author_name text not null default 'LegiPulse user',
  body text not null check (char_length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meeting_note_comments_note_idx
  on public.meeting_note_comments (note_id, created_at);

create or replace function public.set_meeting_note_comment_metadata()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  profile_name text;
  account_email text;
begin
  new.updated_at = now();
  new.author_id = auth.uid();
  select nullif(trim(p.name), '') into profile_name
    from public.profiles p where p.id = auth.uid();
  select u.email into account_email from auth.users u where u.id = auth.uid();
  new.author_name = coalesce(profile_name, split_part(account_email, '@', 1), 'LegiPulse user');
  return new;
end;
$$;

drop trigger if exists set_meeting_note_comments_metadata on public.meeting_note_comments;
create trigger set_meeting_note_comments_metadata
  before insert or update on public.meeting_note_comments
  for each row execute procedure public.set_meeting_note_comment_metadata();

alter table public.meeting_note_comments enable row level security;
drop policy if exists "Readers see meeting note comments" on public.meeting_note_comments;
drop policy if exists "Team members add meeting note comments" on public.meeting_note_comments;
drop policy if exists "Authors update their meeting note comments" on public.meeting_note_comments;
drop policy if exists "Authors delete their meeting note comments" on public.meeting_note_comments;
create policy "Readers see meeting note comments"
  on public.meeting_note_comments for select
  using (public.can_read_meeting_note(note_id));
create policy "Team members add meeting note comments"
  on public.meeting_note_comments for insert
  with check (author_id = auth.uid() and public.can_comment_on_meeting_note(note_id));
create policy "Authors update their meeting note comments"
  on public.meeting_note_comments for update
  using (author_id = auth.uid())
  with check (author_id = auth.uid() and public.can_comment_on_meeting_note(note_id));
create policy "Authors delete their meeting note comments"
  on public.meeting_note_comments for delete
  using (author_id = auth.uid());

grant execute on function public.can_read_meeting_note(uuid) to authenticated;
grant execute on function public.can_comment_on_meeting_note(uuid) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.meeting_notes;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.meeting_note_comments;
exception
  when duplicate_object then null;
end $$;

commit;
