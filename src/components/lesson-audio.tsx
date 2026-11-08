"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { lessonChunks, type AudioChunk } from "@/lib/local-db";
import { formatClock } from "@/lib/format";

/**
 * Plays a lesson's original audio from this computer (audio is kept locally,
 * only text goes to the cloud). Seamlessly continues across 3-minute chunks.
 */
export function useLessonAudio(lessonId: string) {
  const chunks = useLiveQuery(() => lessonChunks(lessonId), [lessonId]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const currentRef = useRef<AudioChunk | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState<number | null>(null);

  const playable = (chunks ?? []).filter((c) => c.blob && c.blob.size > 0).sort((a, b) => a.idx - b.idx);

  useEffect(() => {
    const a = new Audio();
    audioRef.current = a;
    a.ontimeupdate = () => currentRef.current && setTime(currentRef.current.startSec + a.currentTime);
    a.onplay = () => setPlaying(true);
    a.onpause = () => setPlaying(false);
    return () => {
      a.pause();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  const loadChunk = useCallback((c: AudioChunk, offset: number, list: AudioChunk[]) => {
    const a = audioRef.current;
    if (!a) return;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = URL.createObjectURL(c.blob);
    currentRef.current = c;
    a.src = urlRef.current;
    a.onloadedmetadata = () => {
      a.currentTime = Math.max(0, offset);
      void a.play().catch(() => {});
    };
    a.onended = () => {
      const next = list.find((x) => x.idx === c.idx + 1);
      if (next) loadChunk(next, 0, list);
      else setPlaying(false);
    };
    setTime(c.startSec + offset);
  }, []);

  const playAt = useCallback(
    (t: number) => {
      const c = playable.find((x) => t >= x.startSec && t < x.startSec + Math.max(x.durationSec, 1)) ?? playable.find((x) => x.startSec >= t);
      if (c) loadChunk(c, Math.max(0, t - c.startSec), playable);
    },
    [playable, loadChunk],
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
    available: playable.length > 0,
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
        <button className="btn btn-quiet btn-sm" onClick={audio.close} aria-label="סגירת הנגן">✕</button>
      </div>
    </div>
  );
}
