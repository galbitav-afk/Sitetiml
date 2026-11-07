/**
 * Splits an uploaded audio/video file into small 16kHz mono WAV chunks in the
 * browser, so each request stays under serverless body limits (~4.5MB) and the
 * transcription can run chunk-by-chunk with visible progress.
 */

const TARGET_RATE = 16_000;
export const UPLOAD_CHUNK_SECONDS = 120; // 120s * 16kHz * 2 bytes ≈ 3.8MB

export interface PcmChunk {
  blob: Blob;
  startSec: number;
  durationSec: number;
}

export async function splitAudioFile(
  file: File,
  onProgress?: (p: number) => void,
): Promise<{ chunks: PcmChunk[]; durationSec: number }> {
  const buf = await file.arrayBuffer();
  onProgress?.(0.1);
  // decodeAudioData on an OfflineAudioContext resamples to the context's rate.
  const ctx = new OfflineAudioContext(1, 1, TARGET_RATE);
  const audio = await ctx.decodeAudioData(buf);
  onProgress?.(0.5);

  const mono = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const ch = audio.getChannelData(c);
    for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / audio.numberOfChannels;
  }

  const per = UPLOAD_CHUNK_SECONDS * audio.sampleRate;
  const chunks: PcmChunk[] = [];
  for (let start = 0; start < mono.length; start += per) {
    const slice = mono.subarray(start, Math.min(start + per, mono.length));
    chunks.push({
      blob: encodeWav(slice, audio.sampleRate),
      startSec: start / audio.sampleRate,
      durationSec: slice.length / audio.sampleRate,
    });
    onProgress?.(0.5 + (0.5 * start) / mono.length);
  }
  onProgress?.(1);
  return { chunks, durationSec: audio.duration };
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (o: number, s: string) =>
    [...s].forEach((ch, i) => view.setUint8(o + i, ch.charCodeAt(0)));
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}
