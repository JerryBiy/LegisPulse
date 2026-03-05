-- Add account settings fields to user profiles.
alter table public.profiles
  add column if not exists username text,
  add column if not exists avatar_url text,
  add column if not exists phone_number text,
  add column if not exists job_title text,
  add column if not exists organization text,
  add column if not exists timezone text,
  add column if not exists bio text,
  add column if not exists twitter_notifications_enabled boolean default true,
  add column if not exists phone_notifications_enabled boolean default true,
  add column if not exists email_notifications_enabled boolean default true,
  add column if not exists notification_phone text,
  add column if not exists notification_preferences jsonb default '{"email_updates": true, "bill_status_changes": true, "new_bills": true}'::jsonb;

create unique index if not exists profiles_username_unique_idx
  on public.profiles (lower(username))
  where username is not null and btrim(username) <> '';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_username_format_check'
  ) then
    alter table public.profiles
      add constraint profiles_username_format_check
      check (username is null or username ~ '^[a-zA-Z0-9_]{3,30}$');
  end if;
end $$;
