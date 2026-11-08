"use client";

/**
 * Records long lessons (2-3h+) as self-contained segments. Each segment is a
 * playable file of its own, so it can be stored and transcribed as soon as it
 * ends. While a segment is open, its data so far is handed to `onPartial`
 * every 10s, so a crash loses at most ~10 seconds.
 *
 * Sources: microphone (pick the device), tab/screen audio (Zoom, Teams, a
 * recorded lecture playing in another tab), or both mixed together.
 */

export const SEGMENT_SECONDS = 180;
const BITRATE = 32_000; // speech-optimised: ~720KB per 3 minutes, ~43MB for 3h
const SILENT_PEAK = 0.006; // a segment whose loudest moment is below this is "digital silence"
const NO_SOUND_RMS = 0.0025;
export const NO_SOUND_WARN_SEC = 30;

export type SourceKind = "mic" | "tab" | "both";

export interface SegmentData {
  blob: Blob;
  mime: string;
  index: number;
  startSec: number;
  durationSec: number;
  /** True when nothing audible was captured (muted mic, total silence). */
  silent: boolean;
}

/** Input health, reported to the UI. Recording never stops by itself. */
export type InputStatus = "ok" | "mic-lost" | "tab-lost";

export interface RecorderCallbacks {
  onSegment: (s: SegmentData) => Promise<void>;
  onPartial?: (s: SegmentData) => Promise<void>;
  onInputStatus?: (status: InputStatus) => void;
}

export function pickMime(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
  ];
  if (typeof MediaRecorder === "undefined") return "";
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

export function recordingSupported() {
  return (
    typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined"
  );
}

export function tabAudioSupported() {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;
}

/** Microphone constraints tuned for a lecture hall rather than a phone call. */
export function micConstraints(deviceId?: string): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    echoCancellation: false, // built for calls; muffles a distant lecturer
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  };
}

export async function listMics(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "audioinput");
}

/** Acquire the input stream(s) for a source. Throws a Hebrew message on failure. */
export async function acquireStreams(source: SourceKind, deviceId?: string) {
  const streams: { mic?: MediaStream; tab?: MediaStream } = {};
  try {
    if (source === "tab" || source === "both") {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: true, // required by browsers; we drop it immediately
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      display.getVideoTracks().forEach((t) => t.stop());
      if (!display.getAudioTracks().length) {
        display.getTracks().forEach((t) => t.stop());
        throw new Error(
          'לא נבחר שמע. בחלון השיתוף בחר את הלשונית של השיעור (למשל זום בדפדפן) וסמן "שיתוף אודיו של הכרטיסייה".',
        );
      }
      streams.tab = new MediaStream(display.getAudioTracks());
    }
    if (source === "mic" || source === "both") {
      streams.mic = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(deviceId) });
    }
  } catch (e) {
    streams.mic?.getTracks().forEach((t) => t.stop());
    streams.tab?.getTracks().forEach((t) => t.stop());
    if (e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError")) {
      throw new Error(
        source === "mic"
          ? "אין הרשאה למיקרופון. לחץ על סמל המנעול בשורת הכתובת, אפשר מיקרופון, ונסה שוב."
          : "השיתוף בוטל או נחסם. נסה שוב ובחר לשונית עם שמע.",
      );
    }
    if (e instanceof DOMException && (e.name === "NotFoundError" || e.name === "OverconstrainedError")) {
      throw new Error("המיקרופון שנבחר לא נמצא. חבר מיקרופון או בחר מקור אחר.");
    }
    throw e instanceof Error ? e : new Error(String(e));
  }
  return streams;
}

export class LessonRecorder {
  private ctx?: AudioContext;
  private analyser?: AnalyserNode;
  private mixed?: MediaStream;
  private recorder?: MediaRecorder;
  private index: number;
  private segmentStart: number;
  private elapsedBefore: number;
  private runStartedAt = 0;
  private timer?: ReturnType<typeof setInterval>;
  private wakeLock?: WakeLockSentinel;
  private mime = "";
  private segPeak = 0;
  private quietSince = 0;
  private stopping?: () => void;
  private segmentEnds = new WeakMap<MediaRecorder, number>();
  private segmentPeaks = new WeakMap<MediaRecorder, number>();
  private pending = new Set<Promise<void>>();
  private dest?: MediaStreamAudioDestinationNode;
  private sources = new Map<"mic" | "tab", MediaStreamAudioSourceNode>();
  private reconnectTimer?: ReturnType<typeof setInterval>;
  /** Only trust "silence" when the level meter was really running for this segment. */
  private levelTrusted = false;
  private segLevelTrusted = new WeakMap<MediaRecorder, boolean>();
  inputStatus: InputStatus = "ok";
  state: "idle" | "recording" | "paused" = "idle";
  /** Current input level 0..1 for the meter. */
  level = 0;

  constructor(
    private streams: { mic?: MediaStream; tab?: MediaStream },
    private cb: RecorderCallbacks,
    startIndex = 0,
    startElapsed = 0,
    private deviceId?: string,
  ) {
    this.index = startIndex;
    this.elapsedBefore = startElapsed;
    this.segmentStart = startElapsed;
  }

  get elapsed() {
    if (this.state !== "recording") return this.elapsedBefore;
    return this.elapsedBefore + (performance.now() - this.runStartedAt) / 1000;
  }

  /** Seconds of continuous near-silence (to warn "no sound is coming in"). */
  get quietFor() {
    return this.state === "recording" && this.quietSince ? (performance.now() - this.quietSince) / 1000 : 0;
  }

  async start() {
    this.ctx = new AudioContext();
    await this.ctx.resume().catch(() => {});
    this.dest = this.ctx.createMediaStreamDestination();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    for (const kind of ["mic", "tab"] as const) {
      const s = this.streams[kind];
      if (s) this.attach(kind, s);
    }
    // Always record the mix: if an input disappears (Bluetooth drop, USB unplug, sharing
    // stopped) the recorder keeps running and the input is re-attached when it returns.
    this.mixed = this.dest.stream;
    this.mime = pickMime();
    navigator.mediaDevices.addEventListener?.("devicechange", this.onDeviceChange);

    await this.acquireWakeLock();
    document.addEventListener("visibilitychange", this.onVisibility);
    this.state = "recording";
    this.runStartedAt = performance.now();
    this.quietSince = performance.now();
    this.startSegment();
    this.timer = setInterval(() => this.tick(), 250);
  }

  private attach(kind: "mic" | "tab", stream: MediaStream) {
    if (!this.ctx || !this.dest || !this.analyser) return;
    this.sources.get(kind)?.disconnect();
    const src = this.ctx.createMediaStreamSource(stream);
    src.connect(this.dest);
    src.connect(this.analyser);
    this.sources.set(kind, src);
    this.streams[kind] = stream;
    stream.getAudioTracks().forEach((t) => (t.onended = () => this.onInputLost(kind)));
  }

  private onInputLost(kind: "mic" | "tab") {
    if (this.state === "idle") return;
    this.sources.get(kind)?.disconnect();
    this.sources.delete(kind);
    if (kind === "mic") {
      this.setInputStatus("mic-lost");
      this.startReconnect();
    } else {
      // Screen/tab sharing can only be restarted by a click: pause until the user re-shares
      // (when the mic is also recording, keep going with the mic alone).
      if (this.streams.mic && this.sources.has("mic")) {
        this.streams.tab = undefined;
      } else {
        this.pause();
        this.setInputStatus("tab-lost");
      }
    }
  }

  private setInputStatus(s: InputStatus) {
    this.inputStatus = s;
    this.cb.onInputStatus?.(s);
  }

  private startReconnect() {
    if (this.reconnectTimer) return;
    const attempt = async () => {
      if (this.state === "idle") return this.stopReconnect();
      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(this.deviceId) });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints() }); // any mic
        }
        if ((this.state as string) === "idle") return stream.getTracks().forEach((t) => t.stop());
        this.attach("mic", stream);
        this.stopReconnect();
        this.setInputStatus("ok");
      } catch {
        /* still no microphone — try again shortly */
      }
    };
    void attempt();
    this.reconnectTimer = setInterval(() => void attempt(), 3000);
  }

  private stopReconnect() {
    clearInterval(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private onDeviceChange = () => {
    if (this.inputStatus === "mic-lost") {
      this.stopReconnect();
      this.startReconnect();
    }
  };

  /** Re-share tab/screen audio after sharing was stopped (must be called from a click). */
  async reattachTab() {
    const display = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    display.getVideoTracks().forEach((t) => t.stop());
    if (!display.getAudioTracks().length) {
      display.getTracks().forEach((t) => t.stop());
      throw new Error('לא נבחר שמע. סמן "שיתוף אודיו של הכרטיסייה" בחלון השיתוף.');
    }
    this.attach("tab", new MediaStream(display.getAudioTracks()));
    this.setInputStatus("ok");
    this.resume();
  }

  private tick() {
    this.sampleLevel();
    if (this.state === "recording" && this.elapsed - this.segmentStart >= SEGMENT_SECONDS) this.rotate();
  }

  private sampleLevel() {
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
    if (!this.analyser || this.state !== "recording" || this.ctx?.state !== "running") {
      this.level = 0;
      return;
    }
    this.levelTrusted = true;
    const data = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);
    let sum = 0;
    let peak = 0;
    for (const v of data) {
      sum += v * v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    const rms = Math.sqrt(sum / data.length);
    this.level = Math.min(1, rms * 8);
    if (peak > this.segPeak) this.segPeak = peak;
    // While the mic is disconnected the reconnect banner speaks for itself.
    if (rms > NO_SOUND_RMS || this.inputStatus !== "ok") this.quietSince = 0;
    else if (!this.quietSince) this.quietSince = performance.now();
  }

  pause() {
    if (this.state !== "recording" || !this.recorder) return;
    this.elapsedBefore = this.elapsed;
    this.recorder.pause();
    this.state = "paused";
    this.level = 0;
  }

  resume() {
    if (this.state !== "paused" || !this.recorder) return;
    this.runStartedAt = performance.now();
    this.quietSince = performance.now();
    this.recorder.resume();
    this.state = "recording";
  }

  /** Stops; resolves once the final segment has been handed to onSegment and saved. */
  async stop() {
    if (this.state === "idle") return;
    if (this.state === "recording") this.elapsedBefore = this.elapsed;
    this.state = "idle";
    clearInterval(this.timer);
    await new Promise<void>((resolve) => {
      this.stopping = resolve;
      const rec = this.recorder;
      if (rec && rec.state !== "inactive") {
        this.segmentEnds.set(rec, this.elapsedBefore);
        this.segmentPeaks.set(rec, this.segPeak);
        this.segLevelTrusted.set(rec, this.levelTrusted);
        rec.stop();
      } else resolve();
    });
    await Promise.allSettled([...this.pending]);
    this.stopReconnect();
    navigator.mediaDevices.removeEventListener?.("devicechange", this.onDeviceChange);
    this.streams.mic?.getTracks().forEach((t) => t.stop());
    this.streams.tab?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close().catch(() => {});
    document.removeEventListener("visibilitychange", this.onVisibility);
    await this.wakeLock?.release().catch(() => {});
  }

  private startSegment() {
    if (!this.mixed) return;
    const rec = new MediaRecorder(this.mixed, {
      ...(this.mime ? { mimeType: this.mime } : {}),
      audioBitsPerSecond: BITRATE,
    });
    const parts: Blob[] = [];
    const index = this.index++;
    const startSec = this.segmentStart;
    this.segPeak = 0;
    this.levelTrusted = false;
    const mimeOf = () => rec.mimeType || this.mime || "audio/webm";

    rec.ondataavailable = (e) => {
      if (e.data.size === 0) return;
      parts.push(e.data);
      if (rec.state === "recording" || rec.state === "paused") {
        this.track(
          this.cb.onPartial?.({
            blob: new Blob(parts, { type: mimeOf() }),
            mime: mimeOf(),
            index,
            startSec,
            durationSec: Math.max(0, this.elapsed - startSec),
            silent: false,
          }),
        );
      }
    };
    rec.onstop = () => {
      const end = this.segmentEnds.get(rec) ?? this.elapsed;
      const peak = this.segmentPeaks.get(rec) ?? this.segPeak;
      const trusted = this.segLevelTrusted.get(rec) ?? this.levelTrusted;
      if (parts.length) {
        this.track(
          this.cb.onSegment({
            blob: new Blob(parts, { type: mimeOf() }),
            mime: mimeOf(),
            index,
            startSec,
            durationSec: Math.max(0, end - startSec),
            silent: trusted && peak < SILENT_PEAK,
          }),
        );
      }
      if (this.state === "idle" && rec === this.recorder) this.stopping?.();
    };
    rec.start(10_000);
    this.recorder = rec;
  }

  private track(p: Promise<void> | undefined) {
    if (!p) return;
    const tracked = p.catch(() => {});
    this.pending.add(tracked);
    void tracked.finally(() => this.pending.delete(tracked));
  }

  private rotate() {
    const old = this.recorder;
    const boundary = this.elapsed;
    this.elapsedBefore = boundary;
    this.runStartedAt = performance.now();
    if (old) {
      this.segmentEnds.set(old, boundary);
      this.segmentPeaks.set(old, this.segPeak);
      this.segLevelTrusted.set(old, this.levelTrusted);
    }
    this.segmentStart = boundary;
    old?.stop();
    this.startSegment();
  }

  private onVisibility = () => {
    if (document.visibilityState === "visible" && this.state !== "idle") void this.acquireWakeLock();
  };

  private async acquireWakeLock() {
    try {
      this.wakeLock = await navigator.wakeLock?.request("screen");
    } catch {
      /* unsupported or denied */
    }
  }
}

/* ---------- Free live caption draft (browser speech recognition, mic only) ---------- */

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult:
    | ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void)
    | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
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
      if (rec !== this.rec) return; // a previous instance still winding down
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
      if (e.error === "not-allowed" || e.error === "service-not-allowed") this.active = false;
    };
    rec.onend = () => {
      // Browsers end recognition after silence; keep the current instance alive.
      if (this.active && rec === this.rec) {
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
    const rec = this.rec;
    this.rec = undefined;
    try {
      rec?.stop();
    } catch {
      /* ignore */
    }
  }
}
