# Meeting Intelligence — live worker

Always-on process that turns a **requested** meeting into a live transcript by
streaming its **YouTube live** audio through `yt-dlp` → `ffmpeg` → the
`transcribe-meeting` Edge Function (which runs STT and writes segments the UI
subscribes to via realtime).

```
YouTube live ──yt-dlp──▶ ffmpeg (20s webm/opus chunks) ──HTTP──▶ Edge Function ──▶ DB segments ──▶ UI
```

## Prerequisites (done once)

1. Run migrations `029` and `030`.
2. Deploy the Edge Function and set its STT secrets:
   ```bash
   supabase functions deploy transcribe-meeting
   supabase secrets set STT_PROVIDER=deepgram DEEPGRAM_API_KEY=...
   # or: supabase secrets set STT_PROVIDER=openai OPENAI_API_KEY=sk-...
   # optional shared secret (set the SAME value on the worker):
   supabase secrets set TRANSCRIBE_SHARED_SECRET=$(openssl rand -hex 24)
   ```
   > For long live meetings, **Deepgram is cheaper/faster** than Whisper. Either works.

## Environment for the worker

| Var | Required | Notes |
|-----|----------|-------|
| `SUPABASE_URL` | ✅ | your project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | service role (server-only secret) |
| `EDGE_FUNCTION_URL` | – | defaults to `${SUPABASE_URL}/functions/v1/transcribe-meeting` |
| `TRANSCRIBE_SHARED_SECRET` | – | must match the Edge Function secret if you set one |
| `SEGMENT_SECONDS` | – | chunk length, default `20` |
| `POLL_INTERVAL_MS` | – | how often to look for requested meetings, default `15000` |

## Run it

### Local (quickest test)
Needs `ffmpeg` and `yt-dlp` installed locally.
```bash
cd worker
npm install
SUPABASE_URL=https://xxxx.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=eyJ... \
TRANSCRIBE_SHARED_SECRET=... \
npm start
```

### Docker
```bash
cd worker
docker build -t legistrack-worker .
docker run --rm \
  -e SUPABASE_URL=https://xxxx.supabase.co \
  -e SUPABASE_SERVICE_ROLE_KEY=eyJ... \
  -e TRANSCRIBE_SHARED_SECRET=... \
  legistrack-worker
```

### Fly.io (always-on)
```bash
cd worker
fly launch --no-deploy            # generates fly.toml; pick a name/region
fly secrets set \
  SUPABASE_URL=https://xxxx.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=eyJ... \
  TRANSCRIBE_SHARED_SECRET=...
fly deploy
# keep exactly one instance running:
fly scale count 1
```

### Railway / Render
Point the service at the `worker/` directory (it has the Dockerfile), add the
same env vars, and deploy as a **worker/background** service (no public port).

## How a meeting gets transcribed

1. In the app: open the meeting → **Transcription** card → paste the meeting's
   **YouTube live URL** → **Start live monitoring**. This sets `youtube_url` and
   `status='requested'` on the `meeting_transcripts` row.
2. The worker polls, claims it (`status='live'`), and streams chunks.
3. Segments stream into the transcript live. When the broadcast ends, the worker
   sets `status='completed'`.
4. Click **Analyze & summarize** (or wire a periodic job) to produce the AI
   summary and fire tracked-bill / amendment alerts.

## Notes & limits

- **One worker is enough** for several simultaneous rooms — it runs a pipeline
  per claimed meeting concurrently. Run a single instance (`fly scale count 1`)
  so meetings aren't double-claimed; the claim is atomic (`requested → live`),
  so multiple instances are *safe* but unnecessary.
- **Finding the YouTube URL** is manual in v1 (paste it per meeting). GA streams
  to House/Senate YouTube channels; auto-resolving the live video per committee
  room is a future enhancement.
- **ToS:** `yt-dlp` against YouTube is technically against YouTube's ToS. GA
  proceedings are public record; decide whether that's acceptable for your use.
