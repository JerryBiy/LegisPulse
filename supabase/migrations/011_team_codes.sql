-- ============================================================
-- Team codes: 5-char alphanumeric (e.g. "A3K7P")
-- Users can join a team by entering its code.
-- Run in Supabase SQL Editor.
-- ============================================================

-- 1) Add team_code column
alter table public.teams
  add column if not exists team_code text unique;

-- 2) Helper: generate a unique 5-char alphanumeric code
--    Uses chars that avoid 0/O/1/I to reduce visual confusion.
create or replace function public.generate_unique_team_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code  text;
  v_exists boolean;
begin
  loop
    v_code := '';
    for i in 1..5 loop
      v_code := v_code || substr(v_chars, floor(random() * length(v_chars) + 1)::int, 1);
    end loop;
    select exists(select 1 from public.teams where team_code = v_code) into v_exists;
    exit when not v_exists;
  end loop;
  return v_code;
end;
$$;

-- 3) Trigger: auto-assign a code on every new team insert
create or replace function public.trg_assign_team_code()
returns trigger
language plpgsql
as $$
begin
  if new.team_code is null or new.team_code = '' then
    new.team_code := public.generate_unique_team_code();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_team_code on public.teams;
create trigger trg_set_team_code
  before insert on public.teams
  for each row execute function public.trg_assign_team_code();

-- 4) Backfill existing teams that have no code yet
update public.teams
set team_code = public.generate_unique_team_code()
where team_code is null;

-- 5) RPC: join a team by its 5-char code
--    Immediately makes the caller an active member.
--    The caller must not already be in a team.
create or replace function public.join_team_by_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_email   text;
  v_existing_team uuid;
begin
  -- Find the team (case-insensitive)
  select id into v_team_id
  from public.teams
  where upper(team_code) = upper(trim(p_code));

  if v_team_id is null then
    raise exception 'No team found with that code.';
  end if;

  -- Check if caller is already in any team
  select team_id into v_existing_team
  from public.team_members
  where user_id = auth.uid()
    and status  = 'active'
  limit 1;

  if v_existing_team is not null then
    if v_existing_team = v_team_id then
      raise exception 'You are already a member of this team.';
    else
      raise exception 'You are already in another team. Leave it before joining a new one.';
    end if;
  end if;

  -- Get the user's email
  select email into v_email from auth.users where id = auth.uid();

  -- Insert as active member
  insert into public.team_members (team_id, user_id, email, role, status)
  values (v_team_id, auth.uid(), v_email, 'member', 'active');

  return v_team_id;
end;
$$;
