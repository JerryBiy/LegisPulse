-- Meeting Intelligence: live/recorded committee & floor meeting transcription,
-- AI summaries, agenda → tracked-bill matching, amendment alerts, favorites,
-- and historical transcript storage.
--
-- Transcripts cover PUBLIC legislative meetings, so the transcript + segment
-- tables are shared (any authenticated user can read; authed users can write),
-- mirroring the ga_meetings_cache pattern (migration 023). Favorites and alerts
-- are per-user.

-- ── Transcripts ──────────────────────────────────────────────────────────────
create table if not exists public.meeting_transcripts (
  id              uuid primary key default gen_random_uuid(),
  meeting_id      text unique,                 -- ga_meetings_cache.id, e.g. "legis-12345"
  title           text not null default 'Legislative Meeting',
  chamber         integer,                     -- 1=House, 2=Senate, 3=Joint
  committee       text,
  start_time      timestamptz,
  status          text not null default 'scheduled',
                  -- 'scheduled' | 'live' | 'processing' | 'completed' | 'failed'
  video_url       text,
  agenda_url      text,
  agenda_bills    text[] default '{}',         -- bill numbers parsed from the agenda PDF
  mentioned_bills text[] default '{}',         -- bill numbers detected in the transcript
  transcript_text text default '',             -- full running transcript (denormalized)
  summary         text default '',             -- AI meeting summary
  meta            jsonb not null default '{}'::jsonb,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_meeting_transcripts_start
  on public.meeting_transcripts (start_time desc);
create index if not exists idx_meeting_transcripts_status
  on public.meeting_transcripts (status);

alter table public.meeting_transcripts enable row level security;

drop policy if exists "Authed users read transcripts" on public.meeting_transcripts;
create policy "Authed users read transcripts"
  on public.meeting_transcripts for select
  using (auth.role() = 'authenticated');

drop policy if exists "Authed users insert transcripts" on public.meeting_transcripts;
create policy "Authed users insert transcripts"
  on public.meeting_transcripts for insert
  with check (auth.role() = 'authenticated');

drop policy if exists "Authed users update transcripts" on public.meeting_transcripts;
create policy "Authed users update transcripts"
  on public.meeting_transcripts for update
  using (auth.role() = 'authenticated');

-- ── Transcript segments (live, incremental) ──────────────────────────────────
create table if not exists public.meeting_transcript_segments (
  id            uuid primary key default gen_random_uuid(),
  transcript_id uuid not null references public.meeting_transcripts(id) on delete cascade,
  seq           integer not null default 0,
  start_ms      integer,
  end_ms        integer,
  speaker       text,                          -- null in v1 (no speaker ID)
  text          text not null default '',
  created_at    timestamptz not null default now()
);

create index if not exists idx_transcript_segments_tid_seq
  on public.meeting_transcript_segments (transcript_id, seq);

alter table public.meeting_transcript_segments enable row level security;

drop policy if exists "Authed users read segments" on public.meeting_transcript_segments;
create policy "Authed users read segments"
  on public.meeting_transcript_segments for select
  using (auth.role() = 'authenticated');

drop policy if exists "Authed users insert segments" on public.meeting_transcript_segments;
create policy "Authed users insert segments"
  on public.meeting_transcript_segments for insert
  with check (auth.role() = 'authenticated');

-- ── Favorites (per-user) ─────────────────────────────────────────────────────
create table if not exists public.meeting_favorites (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  transcript_id uuid not null references public.meeting_transcripts(id) on delete cascade,
  created_at    timestamptz not null default now(),
  unique (user_id, transcript_id)
);

alter table public.meeting_favorites enable row level security;

drop policy if exists "Users manage their own meeting favorites" on public.meeting_favorites;
create policy "Users manage their own meeting favorites"
  on public.meeting_favorites for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── Alerts (per-user; tracked-bill events surfaced from meetings) ─────────────
create table if not exists public.meeting_alerts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  transcript_id uuid references public.meeting_transcripts(id) on delete cascade,
  bill_number   text not null,
  alert_type    text not null default 'mentioned',
                -- 'agenda' | 'mentioned' | 'amendment'
  message       text not null default '',
  seen          boolean not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists idx_meeting_alerts_user_unseen
  on public.meeting_alerts (user_id, seen);

alter table public.meeting_alerts enable row level security;

drop policy if exists "Users manage their own meeting alerts" on public.meeting_alerts;
create policy "Users manage their own meeting alerts"
  on public.meeting_alerts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── updated_at trigger for transcripts ───────────────────────────────────────
create or replace function public.update_meeting_transcript_timestamp()
  returns trigger
  language plpgsql
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

drop trigger if exists trg_meeting_transcript_updated on public.meeting_transcripts;
create trigger trg_meeting_transcript_updated
  before update on public.meeting_transcripts
  for each row execute function public.update_meeting_transcript_timestamp();

-- Optional: add the live tables to the realtime publication so the UI can
-- subscribe to incremental segments. Ignore errors if already a member.
do $$
begin
  begin
    alter publication supabase_realtime add table public.meeting_transcript_segments;
  exception when others then null;
  end;
  begin
    alter publication supabase_realtime add table public.meeting_transcripts;
  exception when others then null;
  end;
end$$;
