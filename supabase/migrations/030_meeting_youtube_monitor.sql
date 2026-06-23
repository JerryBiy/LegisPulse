-- Unattended live monitoring: let the UI request transcription of a meeting
-- from a YouTube live URL, and let the worker claim it.
--
-- Flow:
--   1. UI sets youtube_url + status='requested' on a meeting_transcripts row.
--   2. The worker polls for status='requested' with a non-null youtube_url,
--      claims it (status='live'), streams audio → STT → segments, then sets
--      status='completed' (or 'failed').

alter table public.meeting_transcripts
  add column if not exists youtube_url text;

-- Helps the worker's claim query.
create index if not exists idx_meeting_transcripts_requested
  on public.meeting_transcripts (status)
  where status = 'requested';
