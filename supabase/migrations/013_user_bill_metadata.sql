-- Personal bill metadata for tracked bills (flag + notes)
-- Separate from team_bills so each user has their own annotations.

create table if not exists public.user_bill_metadata (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  bill_number         text not null,
  flag                text,                     -- 'low' | 'high' | null
  bill_summary_notes  text default '',
  created_at          timestamptz default now() not null,
  updated_at          timestamptz default now() not null,
  unique (user_id, bill_number)
);

alter table public.user_bill_metadata enable row level security;

create policy "Users manage their own bill metadata"
  on public.user_bill_metadata for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
