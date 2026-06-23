// ─── Attended transcription (browser tab-audio → Whisper) ────────────────────
// This is the no-backend path: while the user watches a meeting, the browser
// captures the audio of a shared tab and transcribes it in fixed windows via
// OpenAI Whisper. Each window is recorded as a self-contained WebM/Opus blob so
// it can be transcribed independently.
//
// The unattended/live server path lives in supabase/functions/transcribe-meeting
// and writes the same segment rows; this client path is the fallback that works
// before that Edge Function is deployed and the stream source is resolved.

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
const OPENAI_BASE_URL =
  import.meta.env.VITE_OPENAI_BASE_URL || "https://api.openai.com/v1";
const OPENAI_TRANSCRIBE_MODEL =
  import.meta.env.VITE_OPENAI_TRANSCRIBE_MODEL || "whisper-1";

export const isTabAudioCaptureSupported = () =>
  typeof navigator !== "undefined" &&
  !!navigator.mediaDevices?.getDisplayMedia &&
  typeof MediaRecorder !== "undefined";

/** Transcribe a single audio blob via Whisper. Returns plain text. */
export async function transcribeAudioBlob(blob, { language } = {}) {
  if (!OPENAI_API_KEY) {
    throw new Error(
      "Transcription is not configured. Add VITE_OPENAI_API_KEY to your .env.",
    );
  }
  if (!blob || blob.size < 2000) return ""; // near-silent / empty window

  const form = new FormData();
  form.append("file", blob, "chunk.webm");
  form.append("model", OPENAI_TRANSCRIBE_MODEL);
  if (language) form.append("language", language);

  const res = await fetch(`${OPENAI_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Transcription failed (${res.status}): ${text.slice(0, 200)}`,
    );
  }
  const data = await res.json();
  return String(data?.text || "").trim();
}

/** Record one fixed-length window from a MediaStream → a standalone WebM blob. */
function recordWindow(stream, ms) {
  return new Promise((resolve, reject) => {
    let recorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    } catch (err) {
      // Some browsers need no mimeType hint.
      try {
        recorder = new MediaRecorder(stream);
      } catch (e) {
        return reject(e);
      }
    }
    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onerror = (e) => reject(e.error || e);
    recorder.onstop = () =>
      resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
    recorder.start();
    setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, ms);
  });
}

/**
 * Start attended transcription of a shared tab's audio.
 *
 * @param {object} opts
 * @param {(text:string)=>void} opts.onSegment  called with each window's text
 * @param {(err:Error)=>void}  [opts.onError]
 * @param {()=>void}           [opts.onStop]    called when capture ends
 * @param {number}             [opts.windowMs]  window length (default 20s)
 * @returns {Promise<{stop:()=>void}>}
 */
export async function startTabAudioTranscription({
  onSegment,
  onError,
  onStop,
  windowMs = 20000,
}) {
  if (!isTabAudioCaptureSupported()) {
    throw new Error(
      "Tab-audio capture isn't supported in this browser. Use a recent desktop Chrome/Edge.",
    );
  }

  const display = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true,
  });

  const audioTracks = display.getAudioTracks();
  if (audioTracks.length === 0) {
    display.getTracks().forEach((t) => t.stop());
    throw new Error(
      'No audio was shared. When prompted, pick the meeting tab and enable "Share tab audio".',
    );
  }

  // We only need the audio for transcription; keep video track alive so the
  // browser keeps the share active, but we won't read frames.
  const audioStream = new MediaStream(audioTracks);

  let stopped = false;

  const cleanup = () => {
    stopped = true;
    display.getTracks().forEach((t) => t.stop());
    onStop?.();
  };

  // If the user clicks the browser's native "Stop sharing", end gracefully.
  audioTracks[0].addEventListener("ended", cleanup);

  (async () => {
    while (!stopped) {
      try {
        const blob = await recordWindow(audioStream, windowMs);
        if (stopped) break;
        const text = await transcribeAudioBlob(blob);
        if (text) onSegment?.(text);
      } catch (err) {
        if (stopped) break;
        onError?.(err instanceof Error ? err : new Error(String(err)));
        // brief pause before retrying so a transient error doesn't hot-loop
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  })();

  return { stop: cleanup };
}
