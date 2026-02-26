-- ============================================================
-- LegisPulse — Initial Schema
-- Run this in the Supabase SQL Editor for your project.
-- ============================================================

-- ─── Profiles ────────────────────────────────────────────────
-- One row per authenticated user, extends auth.users.
create table if not exists public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  name             text,
  email            text,
  tracked_bill_ids jsonb default '[]'::jsonb,
  created_at       timestamptz default now() not null
);

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create a profile row when a new user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ─── Bills ───────────────────────────────────────────────────
create table if not exists public.bills (
  id                  text primary key,
  user_id             uuid not null references auth.users(id) on delete cascade,
  bill_number         text,
  title               text,
  description         text,
  bill_type           text,
  chamber             text,
  sponsor             text,
  sponsors            jsonb,
  co_sponsors         jsonb,
  session_year        integer,
  status              text,
  last_action         text,
  last_action_date    text,
  primary_sponsor     text,
  current_committee   text,
  session             text,
  classification      text,
  summary             text,
  changes_analysis    text,
  ai_analysis         jsonb,
  tracked             boolean default false,
  is_tracked          boolean default false,
  pdf_url             text,
  tags                jsonb default '[]'::jsonb,
  legiscan_id         text,
  url                 text,
  state_link          text,
  texts               jsonb,
  votes               jsonb,
  history             jsonb,
  created_date        timestamptz default now() not null,
  extra               jsonb
);

alter table public.bills enable row level security;

create policy "Users manage their own bills"
  on public.bills for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── Tracked Bill IDs (lightweight list) ─────────────────────
-- Separate from full bill rows so users can track bill IDs
-- without needing to import the full bill object first.
create table if not exists public.tracked_bill_ids (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  bill_id     text not null,
  created_at  timestamptz default now() not null,
  unique (user_id, bill_id)
);

alter table public.tracked_bill_ids enable row level security;

create policy "Users manage their own tracked bill ids"
  on public.tracked_bill_ids for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── Email Lists ─────────────────────────────────────────────
create table if not exists public.email_lists (
  id            text primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text,
  description   text,
  recipients    jsonb,
  created_date  timestamptz default now() not null,
  extra         jsonb
);

alter table public.email_lists enable row level security;

create policy "Users manage their own email lists"
  on public.email_lists for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── Notifications ────────────────────────────────────────────
create table if not exists public.notifications (
  id            text primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  type          text,
  title         text,
  message       text,
  bill_id       text,
  read          boolean default false,
  created_date  timestamptz default now() not null,
  extra         jsonb
);

alter table public.notifications enable row level security;

create policy "Users manage their own notifications"
  on public.notifications for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── Tweets ───────────────────────────────────────────────────
create table if not exists public.tweets (
  id          text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  content     text,
  author      text,
  posted_at   timestamptz,
  url         text,
  extra       jsonb
);

alter table public.tweets enable row level security;

create policy "Users manage their own tweets"
  on public.tweets for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
