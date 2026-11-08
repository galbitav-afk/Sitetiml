"use client";

/**
 * Splits an uploaded recording (audio OR video, any length — a 3-hour lecture
 * is fine) into small speech-optimised chunks entirely in the browser.
 *
 * Primary path: ffmpeg.wasm with the file mounted read-only (WORKERFS), so the
 * file is streamed from disk instead of loaded into memory. Output: 5-minute
 * 16kHz mono Opus chunks (~0.9MB each, well under API body limits).
 * Fallback for short files if ffmpeg can't load: Web Audio decode → WAV.
 */

export const UPLOAD_CHUNK_SECONDS = 300;

export interface UploadChunk {
  blob: Blob;
  mime: string;
  startSec: number;
  durationSec: number;
}

export type UploadProgress = (stage: string, ratio: number) => void;

export async function probeDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement(file.type.startsWith("video") ? "video" : "audio");
    el.preload = "metadata";
    const done = (d: number) => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(d) ? d : 0);
    };
    el.onloadedmetadata = () => done(el.duration);
    el.onerror = () => done(0);
    setTimeout(() => done(0), 15000);
    el.src = url;
  });
}

export async function splitRecording(
  file: File,
  onProgress: UploadProgress,
): Promise<{ chunks: UploadChunk[]; durationSec: number }> {
  const duration = await probeDuration(file);
  try {
    return await splitWithFfmpeg(file, duration, onProgress);
  } catch (e) {
    console.warn("ffmpeg split failed, falling back to Web Audio", e);
    // The Web Audio fallback decodes the whole file into memory: only safe for short files.
    if (file.size > 120 * 1024 * 1024 || duration > 75 * 60) {
      throw new Error("לא הצלחתי לפצל את הקובץ. נסה דפדפן Chrome או Edge עדכני, או קובץ בפורמט MP3/M4A.");
    }
    return splitWithWebAudio(file, onProgress);
  }
}

async function splitWithFfmpeg(file: File, duration: number, onProgress: UploadProgress) {
  onProgress("טוען את מנוע העיבוד…", 0.02);
  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const ffmpeg = new FFmpeg();
  const base = `${window.location.origin}/ffmpeg`;
  await ffmpeg.load({
    coreURL: `${base}/ffmpeg-core.js`,
    wasmURL: `${base}/ffmpeg-core.wasm`,
    // Served unbundled from /public: a bundled worker can't import the core by URL.
    classWorkerURL: `${base}/worker.js`,
  });

  const logs: string[] = [];
  ffmpeg.on("log", ({ message }) => {
    logs.push(message);
    if (logs.length > 50) logs.shift();
  });
  ffmpeg.on("progress", ({ time }) => {
    // `time` is in microseconds of processed media.
    if (duration > 0 && time > 0) onProgress("מעבד את ההקלטה…", Math.min(0.98, 0.05 + (time / 1e6 / duration) * 0.93));
  });

  await ffmpeg.createDir("/in");
  await ffmpeg.createDir("/out");
  // WORKERFS reads the file lazily from disk — no copy into wasm memory.
  await ffmpeg.mount("WORKERFS" as never, { files: [file] }, "/in");
  const code = await ffmpeg.exec([
    "-hide_banner",
    "-i",
    `/in/${file.name}`,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "libopus",
    "-b:a",
    "24k",
    "-f",
    "segment",
    "-segment_time",
    String(UPLOAD_CHUNK_SECONDS),
    "-reset_timestamps",
    "1",
    "/out/part%04d.ogg",
  ]);
  if (code !== 0) throw new Error(`ffmpeg exited with ${code}: ${logs.slice(-5).join(" | ")}`);

  const names = (await ffmpeg.listDir("/out"))
    .filter((n) => !n.isDir && n.name.endsWith(".ogg"))
    .map((n) => n.name)
    .sort();
  if (!names.length) throw new Error("ffmpeg produced no audio");
  const total = duration || names.length * UPLOAD_CHUNK_SECONDS;
  const chunks: UploadChunk[] = [];
  for (let i = 0; i < names.length; i++) {
    const data = (await ffmpeg.readFile(`/out/${names[i]}`)) as Uint8Array;
    const startSec = i * UPLOAD_CHUNK_SECONDS;
    await ffmpeg.deleteFile(`/out/${names[i]}`);
    // The segmenter can emit a near-empty tail chunk; it only invites transcription noise.
    if (i > 0 && i === names.length - 1 && (total - startSec < 2 || data.byteLength < 4096)) continue;
    chunks.push({
      blob: new Blob([data as BlobPart], { type: "audio/ogg" }),
      mime: "audio/ogg",
      startSec,
      durationSec: Math.max(1, Math.min(UPLOAD_CHUNK_SECONDS, total - startSec)),
    });
  }
  await ffmpeg.unmount("/in").catch(() => {});
  ffmpeg.terminate();
  onProgress("מוכן", 1);
  return { chunks, durationSec: total };
}

const WAV_CHUNK_SECONDS = 120; // 120s × 16kHz × 2 bytes ≈ 3.8MB (under serverless body limits)

async function splitWithWebAudio(file: File, onProgress: UploadProgress) {
  onProgress("מפענח את הקובץ…", 0.1);
  const rate = 16_000;
  const ctx = new OfflineAudioContext(1, 1, rate);
  const audio = await ctx.decodeAudioData(await file.arrayBuffer());
  const mono = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const ch = audio.getChannelData(c);
    for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / audio.numberOfChannels;
  }
  const per = WAV_CHUNK_SECONDS * audio.sampleRate;
  const chunks: UploadChunk[] = [];
  for (let start = 0; start < mono.length; start += per) {
    const slice = mono.subarray(start, Math.min(start + per, mono.length));
    chunks.push({
      blob: encodeWav(slice, audio.sampleRate),
      mime: "audio/wav",
      startSec: start / audio.sampleRate,
      durationSec: slice.length / audio.sampleRate,
    });
    onProgress("מפצל…", 0.5 + (0.5 * start) / mono.length);
  }
  return { chunks, durationSec: audio.duration };
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const w = (o: number, s: string) => [...s].forEach((ch, i) => view.setUint8(o + i, ch.charCodeAt(0)));
  w(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  w(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0, o = 44; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}
