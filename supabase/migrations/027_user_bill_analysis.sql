-- Detailed per-user analysis for tracked bills.
-- Stores the structured "tracked bill detail page" content (AI-drafted,
-- human-editable): short summary, arguments for/against, committee
-- questions, current law, what the bill does, proposed modifications,
-- and miscellaneous notes. Kept as a single JSON blob so the shape can
-- evolve without further migrations.
--
-- This migration is self-contained and idempotent: it (re)creates the
-- user_bill_metadata table from migration 013 if it is missing, then adds
-- the analysis column. Safe to run on a fresh database or an existing one.

-- 1) Ensure the base table exists (mirrors 013_user_bill_metadata.sql).
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

drop policy if exists "Users manage their own bill metadata"
  on public.user_bill_metadata;
create policy "Users manage their own bill metadata"
  on public.user_bill_metadata for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 2) Add the detailed analysis column.
alter table public.user_bill_metadata
  add column if not exists analysis jsonb not null default '{}'::jsonb;
