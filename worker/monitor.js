// ─── Meeting Intelligence live worker ────────────────────────────────────────
// Always-on process that turns requested meetings into live transcripts.
//
// Loop:
//   1. Poll meeting_transcripts for status='requested' rows with a youtube_url.
//   2. Claim each (status -> 'live') and start an audio pipeline:
//        yt-dlp (YouTube live audio) | ffmpeg (chunk into N-second webm/opus)
//   3. POST each finished chunk to the transcribe-meeting Edge Function, which
//      runs STT and writes a transcript segment (UI updates via realtime).
//   4. When the stream ends, set status -> 'completed'.
//
// Requires `yt-dlp` and `ffmpeg` on PATH (see Dockerfile). Node 18+ (global fetch).

import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  TRANSCRIBE_SHARED_SECRET = "",
  YTDLP_PATH = "yt-dlp",
  FFMPEG_PATH = "ffmpeg",
} = process.env;

const EDGE_FUNCTION_URL =
  process.env.EDGE_FUNCTION_URL ||
  (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/transcribe-meeting` : "");
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 15000);
const SEGMENT_SECONDS = Number(process.env.SEGMENT_SECONDS || 20);
const SEGMENT_SCAN_MS = 2000;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !EDGE_FUNCTION_URL) {
  console.error(
    "Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (EDGE_FUNCTION_URL optional).",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  realtime: {
    transport: WebSocket,
  },
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const active = new Map(); // transcript_id -> { stop }

const log = (...a) => console.log(new Date().toISOString(), ...a);

// Parse the numeric index from a segment filename "seg_00007.webm" -> 7.
const segIndex = (name) => {
  const m = name.match(/seg_(\d+)\.webm$/);
  return m ? parseInt(m[1], 10) : -1;
};

async function postChunk(transcriptId, seq, bytes) {
  const res = await fetch(EDGE_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(TRANSCRIBE_SHARED_SECRET
        ? { "x-transcribe-secret": TRANSCRIBE_SHARED_SECRET }
        : {}),
      // Edge functions require an apikey/Authorization; service role works.
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
    },
    body: JSON.stringify({
      transcript_id: transcriptId,
      seq,
      mime: "audio/webm",
      audio_base64: Buffer.from(bytes).toString("base64"),
    }),
  });
  if (!res.ok) {
    throw new Error(`edge ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

async function monitor(row) {
  const transcriptId = row.id;
  const url = row.youtube_url;
  log(`▶ monitoring ${transcriptId} — ${row.title} — ${url}`);

  // Continue seq numbering after any existing segments.
  const { count } = await supabase
    .from("meeting_transcript_segments")
    .select("id", { count: "exact", head: true })
    .eq("transcript_id", transcriptId);
  const baseSeq = count ?? 0;

  const dir = mkdtempSync(join(tmpdir(), `mtg-${transcriptId}-`));
  let stopped = false;
  const processed = new Set();

  // yt-dlp streams the live audio to stdout; ffmpeg chunks it into webm/opus.
  const ydl = spawn(YTDLP_PATH, [
    "-f",
    "bestaudio/best",
    "--no-part",
    "--quiet",
    "--no-warnings",
    "-o",
    "-",
    url,
  ]);
  const ff = spawn(FFMPEG_PATH, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    "pipe:0",
    "-vn",
    "-ac",
    "1",
    "-c:a",
    "libopus",
    "-f",
    "segment",
    "-segment_time",
    String(SEGMENT_SECONDS),
    "-reset_timestamps",
    "1",
    join(dir, "seg_%05d.webm"),
  ]);
  ydl.stdout.pipe(ff.stdin);
  ydl.stderr.on("data", (d) =>
    log(`[yt-dlp ${transcriptId}]`, d.toString().trim()),
  );
  ff.stderr.on("data", (d) =>
    log(`[ffmpeg ${transcriptId}]`, d.toString().trim()),
  );

  // Scan the temp dir for COMPLETE segments. A segment file is complete once a
  // higher-indexed file exists (ffmpeg has moved on). The final file is flushed
  // after ffmpeg exits.
  const scan = async (flushLast = false) => {
    let files;
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".webm"));
    } catch {
      return;
    }
    const indices = files
      .map(segIndex)
      .filter((i) => i >= 0)
      .sort((a, b) => a - b);
    if (indices.length === 0) return;
    const maxIdx = indices[indices.length - 1];
    for (const idx of indices) {
      if (processed.has(idx)) continue;
      if (!flushLast && idx === maxIdx) continue; // still being written
      processed.add(idx);
      const file = join(dir, `seg_${String(idx).padStart(5, "0")}.webm`);
      try {
        const bytes = readFileSync(file);
        if (bytes.length > 2000) {
          await postChunk(transcriptId, baseSeq + idx, bytes);
        }
        rmSync(file, { force: true });
      } catch (err) {
        log(`✗ chunk ${idx} for ${transcriptId}:`, err.message);
      }
    }
  };

  const scanTimer = setInterval(() => {
    scan(false).catch(() => {});
  }, SEGMENT_SCAN_MS);

  const finish = async (status) => {
    if (stopped) return;
    stopped = true;
    clearInterval(scanTimer);
    try {
      await scan(true); // flush the last segment
    } catch {
      /* noop */
    }
    try {
      ydl.kill("SIGTERM");
    } catch {
      /* noop */
    }
    try {
      ff.kill("SIGTERM");
    } catch {
      /* noop */
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* noop */
    }
    await supabase
      .from("meeting_transcripts")
      .update({ status })
      .eq("id", transcriptId);
    active.delete(transcriptId);
    log(`■ finished ${transcriptId} (${status})`);
  };

  ff.on("close", () => finish("completed"));
  ydl.on("close", (code) => {
    if (code && code !== 0) log(`yt-dlp exited ${code} for ${transcriptId}`);
    // Give ffmpeg a moment to flush, then ensure cleanup.
    setTimeout(() => finish("completed"), 4000);
  });
  ydl.on("error", (err) => {
    log(`yt-dlp error ${transcriptId}:`, err.message);
    finish("failed");
  });
  ff.on("error", (err) => {
    log(`ffmpeg error ${transcriptId}:`, err.message);
    finish("failed");
  });

  active.set(transcriptId, { stop: () => finish("completed") });
}

async function poll() {
  const { data, error } = await supabase
    .from("meeting_transcripts")
    .select("id, title, youtube_url, status")
    .eq("status", "requested")
    .not("youtube_url", "is", null)
    .limit(10);
  if (error) {
    log("poll error:", error.message);
    return;
  }
  for (const row of data ?? []) {
    if (active.has(row.id)) continue;
    // Optimistic claim: only proceed if we flip it from 'requested' -> 'live'.
    const { data: claimed } = await supabase
      .from("meeting_transcripts")
      .update({ status: "live" })
      .eq("id", row.id)
      .eq("status", "requested")
      .select()
      .maybeSingle();
    if (claimed)
      monitor(claimed).catch((e) => log("monitor crash:", e.message));
  }
}

log(`Worker up. Polling every ${POLL_INTERVAL_MS}ms → ${EDGE_FUNCTION_URL}`);
poll().catch(() => {});
setInterval(() => poll().catch(() => {}), POLL_INTERVAL_MS);

const shutdown = () => {
  log("shutting down…");
  for (const { stop } of active.values()) stop();
  setTimeout(() => process.exit(0), 2000);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
