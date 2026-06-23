// Supabase Edge Function: transcribe-meeting
// ─────────────────────────────────────────────────────────────────────────────
// Server-side speech-to-text endpoint for the Meeting Intelligence feature.
// It keeps the STT provider key OFF the client and writes transcript segments
// straight into the database (where the UI is subscribed via realtime).
//
// It transcribes ONE audio chunk per request and appends a segment. A separate
// long-running worker is responsible for:
//   1. Resolving a meeting's pullable audio/HLS URL  (see README — this is the
//      one genuinely unsolved piece: the meeting video is a Vimeo embed).
//   2. Pulling the live audio and slicing it into ~15-30s chunks.
//   3. POSTing each chunk here.
//
// Why a worker and not a long loop in this function: Supabase Edge Functions
// have a wall-clock limit, so they can't sit on a multi-hour stream. This
// function is the stateless, secret-holding transcription step; the worker is
// the always-on driver. See README.md.
//
// Request (POST, JSON):
//   {
//     "transcript_id": "uuid",      // existing meeting_transcripts row
//     "seq": 12,                     // monotonically increasing segment index
//     "audio_base64": "…",           // base64 audio chunk (webm/ogg/mp3/wav)
//     "mime": "audio/webm",          // optional, defaults to audio/webm
//     "start_ms": 240000,            // optional segment offset
//     "end_ms": 260000               // optional
//   }
//
// Env (set via `supabase secrets set`):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (provided automatically on deploy)
//   STT_PROVIDER          "openai" | "deepgram"   (default: openai)
//   OPENAI_API_KEY        required if STT_PROVIDER=openai
//   OPENAI_TRANSCRIBE_MODEL  default "whisper-1"
//   DEEPGRAM_API_KEY      required if STT_PROVIDER=deepgram
//   TRANSCRIBE_SHARED_SECRET  optional; if set, callers must send it as
//                             `x-transcribe-secret` header.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-transcribe-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function transcribeOpenAI(bytes: Uint8Array, mime: string): Promise<string> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  const model = Deno.env.get("OPENAI_TRANSCRIBE_MODEL") || "whisper-1";
  const baseUrl = Deno.env.get("OPENAI_BASE_URL") || "https://api.openai.com/v1";

  const form = new FormData();
  const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp3") ? "mp3" : "webm";
  form.append("file", new Blob([bytes], { type: mime }), `chunk.${ext}`);
  form.append("model", model);

  const res = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) throw new Error(`OpenAI STT ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return String(data?.text || "").trim();
}

async function transcribeDeepgram(bytes: Uint8Array, mime: string): Promise<string> {
  const key = Deno.env.get("DEEPGRAM_API_KEY");
  if (!key) throw new Error("DEEPGRAM_API_KEY is not set");
  const res = await fetch(
    "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true",
    {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": mime },
      body: bytes,
    },
  );
  if (!res.ok) throw new Error(`Deepgram STT ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return String(
    data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "",
  ).trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Optional shared-secret gate for the worker.
  const requiredSecret = Deno.env.get("TRANSCRIBE_SHARED_SECRET");
  if (requiredSecret && req.headers.get("x-transcribe-secret") !== requiredSecret) {
    return json({ error: "unauthorized" }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const transcriptId = payload.transcript_id as string;
  const audioB64 = payload.audio_base64 as string;
  const mime = (payload.mime as string) || "audio/webm";
  const seq = Number(payload.seq ?? 0);
  if (!transcriptId || !audioB64) {
    return json({ error: "transcript_id and audio_base64 are required" }, 400);
  }

  const provider = (Deno.env.get("STT_PROVIDER") || "openai").toLowerCase();
  let text = "";
  try {
    const bytes = base64ToBytes(audioB64);
    text =
      provider === "deepgram"
        ? await transcribeDeepgram(bytes, mime)
        : await transcribeOpenAI(bytes, mime);
  } catch (err) {
    return json({ error: `transcription failed: ${(err as Error).message}` }, 502);
  }

  if (!text) return json({ ok: true, text: "", skipped: "empty" });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Insert the segment.
  const { error: segErr } = await supabase
    .from("meeting_transcript_segments")
    .insert({
      transcript_id: transcriptId,
      seq,
      start_ms: payload.start_ms ?? null,
      end_ms: payload.end_ms ?? null,
      text,
    });
  if (segErr) return json({ error: `segment insert: ${segErr.message}` }, 500);

  // Append to the denormalized transcript_text + mark live.
  const { data: row } = await supabase
    .from("meeting_transcripts")
    .select("transcript_text")
    .eq("id", transcriptId)
    .maybeSingle();
  const merged = `${row?.transcript_text || ""} ${text}`.trim();
  await supabase
    .from("meeting_transcripts")
    .update({ transcript_text: merged, status: "live" })
    .eq("id", transcriptId);

  return json({ ok: true, text });
});
