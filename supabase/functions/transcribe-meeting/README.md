# transcribe-meeting — server-side STT for Meeting Intelligence

This Edge Function transcribes one audio chunk and writes a transcript segment
into the database (keeping the STT provider key off the browser). It's the
**unattended / live** path. There is also an **attended** path that already
works today with no backend (see "Two paths" below).

## Two paths to a transcript

| Path | Where it runs | Works today? | Notes |
|------|---------------|--------------|-------|
| **Attended capture** | Browser (`src/services/transcribe.js`) | ✅ Yes | User opens the meeting tab, shares "tab audio", browser records 20s windows → OpenAI Whisper → segments. No backend, no new infra. |
| **Unattended live** | This Edge Function + a worker | ⚠️ Needs setup | A worker pulls the meeting's live audio, chunks it, and POSTs chunks here. Runs without anyone watching. |

The app is fully usable on the attended path while you stand up the unattended one.

## The one genuinely unsolved piece: the audio source

The meeting "video" on legis.ga.gov is a **Vimeo embed** (`isVimeo` /
`livestreamUrl` in `src/services/legisGa.js`). There is **no public, pullable
audio/HLS URL** exposed, and scraping Vimeo's internal stream is against their
ToS. So before unattended live transcription can work you must resolve a
**legitimate** audio source, e.g.:

- An official GA/Vimeo livestream/API URL if your org has access/permission.
- A re-broadcast/HLS feed you're authorized to consume.
- Post-meeting: the archived recording (download once, chunk, POST here).

Wire that into the worker's `resolveAudioStream(meeting)` step. Everything
downstream (chunk → STT → segment → realtime UI → tracked-bill alerts) is built.

## Why a worker, not a long-running function

Supabase Edge Functions have a wall-clock execution limit, so they can't sit on
a multi-hour stream. This function is the **stateless transcription step**; an
always-on **worker** (a small Node/Deno process or container — Fly.io, Railway,
a VM, etc.) is the driver that pulls audio and calls this function per chunk.

## Deploy

```bash
# from the repo root
supabase functions deploy transcribe-meeting

# secrets (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically)
supabase secrets set STT_PROVIDER=openai
supabase secrets set OPENAI_API_KEY=sk-...
# or:
supabase secrets set STT_PROVIDER=deepgram
supabase secrets set DEEPGRAM_API_KEY=...

# optional: require a shared secret on every call
supabase secrets set TRANSCRIBE_SHARED_SECRET=$(openssl rand -hex 24)
```

## Request shape

```http
POST /functions/v1/transcribe-meeting
Content-Type: application/json
x-transcribe-secret: <TRANSCRIBE_SHARED_SECRET if set>

{
  "transcript_id": "uuid-of-meeting_transcripts-row",
  "seq": 12,
  "audio_base64": "<base64 audio chunk>",
  "mime": "audio/webm",
  "start_ms": 240000,
  "end_ms": 260000
}
```

Create the `meeting_transcripts` row first (the app does this via
`api.meetingIntel.transcripts.ensureForMeeting`, or insert directly).

## Minimal worker sketch

```js
// pseudo-worker — runs wherever you can keep a process alive
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(URL, SERVICE_ROLE_KEY);

async function monitor(meeting) {
  const { data: t } = await supabase
    .from("meeting_transcripts")
    .upsert({ meeting_id: meeting.id, title: meeting.title, status: "live" },
            { onConflict: "meeting_id" })
    .select().single();

  const stream = await resolveAudioStream(meeting); // ← you implement this
  let seq = 0;
  for await (const chunk of chunkAudio(stream, { seconds: 20 })) {
    seq++;
    await fetch(`${URL}/functions/v1/transcribe-meeting`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-transcribe-secret": SHARED_SECRET,
      },
      body: JSON.stringify({
        transcript_id: t.id,
        seq,
        mime: "audio/webm",
        audio_base64: Buffer.from(chunk).toString("base64"),
      }),
    });
  }
  await supabase.from("meeting_transcripts")
    .update({ status: "completed" }).eq("id", t.id);
}
```

The app's `analyzeTranscript` (summary + amendment/mention detection → tracked-bill
alerts) runs on the accumulated `transcript_text` and can be triggered from the UI
or on an interval.
