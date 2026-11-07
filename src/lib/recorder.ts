/**
 * Records from the microphone in self-contained segments (each one a playable
 * file on its own), so every segment can be stored and transcribed as soon as
 * it ends — long before the lesson is over — and nothing is lost if the tab
 * crashes mid-lesson.
 */

export const SEGMENT_SECONDS = 180;
const BITRATE = 32_000; // speech-optimised; ~720KB per 3-minute segment

export interface Segment {
  blob: Blob;
  mime: string;
  index: number;
  startSec: number;
  durationSec: number;
}

function pickMime(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  if (typeof MediaRecorder === "undefined") return "";
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

export class SegmentedRecorder {
  private stream?: MediaStream;
  private recorder?: MediaRecorder;
  private parts: Blob[] = [];
  private index = 0;
  private segmentStart = 0; // elapsed seconds at which the current segment began
  private elapsedBefore = 0; // accumulated seconds before the current run
  private runStartedAt = 0; // performance.now() of the current run
  private timer?: ReturnType<typeof setInterval>;
  private wakeLock?: WakeLockSentinel;
  private audioCtx?: AudioContext;
  private analyser?: AnalyserNode;
  private mime = "";
  private stopping?: () => void;
  private segmentEnds = new WeakMap<MediaRecorder, number>();
  state: "idle" | "recording" | "paused" = "idle";

  constructor(
    private onSegment: (s: Segment) => void | Promise<void>,
    startIndex = 0,
    startElapsed = 0,
  ) {
    this.index = startIndex;
    this.elapsedBefore = startElapsed;
    this.segmentStart = startElapsed;
  }

  static isSupported() {
    return (
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== "undefined"
    );
  }

  get elapsed() {
    if (this.state !== "recording") return this.elapsedBefore;
    return this.elapsedBefore + (performance.now() - this.runStartedAt) / 1000;
  }

  /** 0..1 input level for the visualiser. */
  level(): number {
    if (!this.analyser) return 0;
    const data = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += ((v - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(sum / data.length) * 3);
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    this.mime = pickMime();
    try {
      this.audioCtx = new AudioContext();
      const src = this.audioCtx.createMediaStreamSource(this.stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 1024;
      src.connect(this.analyser);
    } catch {
      /* visualiser is optional */
    }
    await this.acquireWakeLock();
    document.addEventListener("visibilitychange", this.onVisibility);
    this.state = "recording";
    this.runStartedAt = performance.now();
    this.startSegment();
    this.timer = setInterval(() => {
      if (
        this.state === "recording" &&
        this.elapsed - this.segmentStart >= SEGMENT_SECONDS
      ) {
        this.rotate();
      }
    }, 1000);
  }

  pause() {
    if (this.state !== "recording" || !this.recorder) return;
    this.elapsedBefore = this.elapsed;
    this.recorder.pause();
    this.state = "paused";
  }

  resume() {
    if (this.state !== "paused" || !this.recorder) return;
    this.runStartedAt = performance.now();
    this.recorder.resume();
    this.state = "recording";
  }

  /** Stops recording; resolves after the final segment has been emitted. */
  async stop() {
    if (this.state === "idle") return;
    if (this.state === "recording") this.elapsedBefore = this.elapsed;
    this.state = "idle";
    clearInterval(this.timer);
    await new Promise<void>((resolve) => {
      this.stopping = resolve;
      if (this.recorder && this.recorder.state !== "inactive") {
        this.segmentEnds.set(this.recorder, this.elapsedBefore);
        this.recorder.stop();
      } else {
        resolve();
      }
    });
    this.stream?.getTracks().forEach((t) => t.stop());
    this.audioCtx?.close().catch(() => {});
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.wakeLock?.release().catch(() => {});
  }

  private startSegment() {
    if (!this.stream) return;
    const rec = new MediaRecorder(this.stream, {
      ...(this.mime ? { mimeType: this.mime } : {}),
      audioBitsPerSecond: BITRATE,
    });
    this.parts = [];
    const parts = this.parts;
    const index = this.index++;
    const startSec = this.segmentStart;
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) parts.push(e.data);
    };
    rec.onstop = async () => {
      const end = this.segmentEnds.get(rec) ?? this.elapsed;
      const mime = rec.mimeType || this.mime || "audio/webm";
      if (parts.length) {
        await this.onSegment({
          blob: new Blob(parts, { type: mime }),
          mime,
          index,
          startSec,
          durationSec: Math.max(0, end - startSec),
        });
      }
      if (this.state === "idle" && rec === this.recorder) this.stopping?.();
    };
    rec.start(10_000); // flush data every 10s so a crash loses at most that much
    this.recorder = rec;
  }

  /** Close the current segment and immediately open a new one. */
  private rotate() {
    const old = this.recorder;
    const boundary = this.elapsed;
    this.elapsedBefore = boundary;
    this.runStartedAt = performance.now();
    this.segmentStart = boundary;
    if (old) {
      this.segmentEnds.set(old, boundary);
      old.stop();
    }
    this.startSegment();
  }

  private onVisibility = () => {
    if (document.visibilityState === "visible" && this.state !== "idle") {
      void this.acquireWakeLock();
    }
  };

  private async acquireWakeLock() {
    try {
      this.wakeLock = await navigator.wakeLock?.request("screen");
    } catch {
      /* not supported / denied — recording still works */
    }
  }
}

/* ---------- Live captions via the browser's built-in speech recognition ---------- */

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

export class LiveCaptions {
  private rec?: SpeechRecognitionLike;
  private active = false;

  constructor(
    private onUpdate: (finalText: string, interim: string) => void,
    private lang = "he-IL",
  ) {}

  static isSupported() {
    if (typeof window === "undefined") return false;
    const w = window as unknown as Record<string, unknown>;
    return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
  }

  start() {
    if (!LiveCaptions.isSupported()) return;
    const w = window as unknown as Record<string, new () => SpeechRecognitionLike>;
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    this.active = true;
    const rec = new Ctor();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let finalText = "";
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript + " ";
        else interim += r[0].transcript;
      }
      this.onUpdate(finalText, interim);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        this.active = false;
      }
    };
    // Browsers end recognition after silence; keep it alive while recording.
    rec.onend = () => {
      if (this.active) {
        try {
          rec.start();
        } catch {
          /* already started */
        }
      }
    };
    this.rec = rec;
    try {
      rec.start();
    } catch {
      /* ignore */
    }
  }

  stop() {
    this.active = false;
    try {
      this.rec?.stop();
    } catch {
      /* ignore */
    }
  }
}
