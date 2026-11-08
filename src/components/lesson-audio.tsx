"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { lessonChunks } from "@/lib/local-db";
import { signedAudioUrl, useSegments } from "@/lib/data";
import { formatClock } from "@/lib/format";

interface Source {
  idx: number;
  startSec: number;
  durationSec: number;
  url: () => Promise<string>;
}

/**
 * Plays a lesson's original audio, seamlessly across its 3-5 minute chunks.
 * Uses the copy on this computer when there is one, otherwise the cloud backup,
 * so a lesson recorded on the laptop can be replayed on the phone.
 */
export function useLessonAudio(lessonId: string) {
  const local = useLiveQuery(() => lessonChunks(lessonId), [lessonId]);
  const { data: segments } = useSegments(lessonId);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const currentRef = useRef<Source | null>(null);
  const sourcesRef = useRef<Source[]>([]);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState<number | null>(null);

  const localSources: Source[] = (local ?? [])
    .filter((c) => c.blob && c.blob.size > 0)
    .map((c) => ({ idx: c.idx, startSec: c.startSec, durationSec: c.durationSec, url: async () => URL.createObjectURL(c.blob) }));
  const localIdx = new Set(localSources.map((s) => s.idx));
  const cloudSources: Source[] = (segments ?? [])
    .filter((s) => s.audio_path && !localIdx.has(s.idx))
    .map((s) => ({ idx: s.idx, startSec: s.start_sec, durationSec: s.duration_sec, url: () => signedAudioUrl(s.audio_path!) }));
  const sources = [...localSources, ...cloudSources].sort((a, b) => a.idx - b.idx);
  sourcesRef.current = sources;

  useEffect(() => {
    const a = new Audio();
    audioRef.current = a;
    a.ontimeupdate = () => currentRef.current && setTime(currentRef.current.startSec + a.currentTime);
    a.onplay = () => setPlaying(true);
    a.onpause = () => setPlaying(false);
    return () => {
      a.pause();
      if (urlRef.current?.startsWith("blob:")) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  const load = useCallback(async (src: Source, offset: number) => {
    const a = audioRef.current;
    if (!a) return;
    if (urlRef.current?.startsWith("blob:")) URL.revokeObjectURL(urlRef.current);
    const url = await src.url();
    urlRef.current = url;
    currentRef.current = src;
    a.src = url;
    a.onloadedmetadata = () => {
      a.currentTime = Math.max(0, offset);
      void a.play().catch(() => {});
    };
    a.onended = () => {
      const next = sourcesRef.current.find((x) => x.idx === src.idx + 1);
      if (next) void load(next, 0);
      else setPlaying(false);
    };
    setTime(src.startSec + offset);
  }, []);

  const playAt = useCallback(
    (t: number) => {
      const list = sourcesRef.current;
      const src = list.find((x) => t >= x.startSec && t < x.startSec + Math.max(x.durationSec, 1)) ?? list.find((x) => x.startSec >= t);
      if (src) void load(src, Math.max(0, t - src.startSec));
    },
    [load],
  );

  const toggle = () => {
    const a = audioRef.current;
    if (!a || !currentRef.current) return playAt(0);
    if (a.paused) void a.play();
    else a.pause();
  };

  const close = () => {
    audioRef.current?.pause();
    currentRef.current = null;
    setTime(null);
  };

  return {
    available: sources.length > 0,
    fromCloud: localSources.length === 0 && cloudSources.length > 0,
    playing,
    time,
    playAt,
    toggle,
    close,
    skip: (d: number) => time != null && playAt(Math.max(0, time + d)),
  };
}

export type LessonAudio = ReturnType<typeof useLessonAudio>;

export function AudioBar({ audio }: { audio: LessonAudio }) {
  if (audio.time == null) return null;
  return (
    <div className="fixed bottom-20 lg:bottom-6 inset-x-0 z-40 flex justify-center px-4 no-print">
      <div className="card px-3 py-2 flex items-center gap-2 shadow-xl rise">
        <button className="btn btn-quiet btn-sm" onClick={() => audio.skip(-15)} aria-label="אחורה 15 שניות">↻15</button>
        <button className="btn btn-primary btn-sm w-10" onClick={audio.toggle} aria-label={audio.playing ? "השהיה" : "ניגון"}>
          {audio.playing ? "⏸" : "▶"}
        </button>
        <button className="btn btn-quiet btn-sm" onClick={() => audio.skip(15)} aria-label="קדימה 15 שניות">15↺</button>
        <span className="ltr tabular-nums text-sm font-semibold w-16 text-center">{formatClock(audio.time)}</span>
        {audio.fromCloud && <span className="chip bg-royal-soft text-royal">☁️</span>}
        <button className="btn btn-quiet btn-sm" onClick={audio.close} aria-label="סגירת הנגן">✕</button>
      </div>
    </div>
  );
}
