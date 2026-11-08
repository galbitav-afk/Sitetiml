"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  acquireStreams,
  LessonRecorder,
  LiveCaptions,
  NO_SOUND_WARN_SEC,
  type InputStatus,
  type SegmentData,
  type SourceKind,
} from "@/lib/recorder";
import { chunkId, lessonChunks, localDb } from "@/lib/local-db";
import { fetchLesson, updateLesson } from "@/lib/data";
import { pipeline, recordingLockName } from "@/lib/pipeline";
import { currentUserId } from "@/lib/supabase";
import type { Bookmark, Lesson } from "@/lib/types";

/**
 * The recorder lives here, above every page, so a 3-hour recording keeps going
 * while the student browses other parts of the site. Only "stop" ends it.
 */

export interface RecorderState {
  status: "idle" | "starting" | "recording" | "paused" | "stopping";
  lessonId: string | null;
  courseId: string | null;
  lessonTitle: string;
  source: SourceKind;
  elapsed: number;
  level: number;
  noSound: boolean;
  liveText: string;
  liveInterim: string;
  bookmarks: Bookmark[];
  error: string | null;
  saveError: string | null;
  inputStatus: InputStatus;
}

interface RecorderApi extends RecorderState {
  start(opts: {
    lesson: Pick<Lesson, "id" | "course_id" | "title" | "bookmarks">;
    source: SourceKind;
    deviceId?: string;
    resume?: boolean;
  }): Promise<boolean>;
  pause(): void;
  resume(): void;
  stop(): Promise<void>;
  bookmark(note?: string): Promise<void>;
  reattachTab(): Promise<void>;
  clearError(): void;
}

const initial: RecorderState = {
  status: "idle",
  lessonId: null,
  courseId: null,
  lessonTitle: "",
  source: "mic",
  elapsed: 0,
  level: 0,
  noSound: false,
  liveText: "",
  liveInterim: "",
  bookmarks: [],
  error: null,
  saveError: null,
  inputStatus: "ok",
};

const Ctx = createContext<RecorderApi | null>(null);

export function useRecorder() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useRecorder outside provider");
  return c;
}

export function RecorderProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<RecorderState>(initial);
  const recRef = useRef<LessonRecorder | null>(null);
  const capRef = useRef<LiveCaptions | null>(null);
  const lockRelease = useRef<(() => void) | null>(null);
  const lessonRef = useRef<{ id: string; userId: string } | null>(null);

  const patch = useCallback((p: Partial<RecorderState>) => setState((s) => ({ ...s, ...p })), []);

  // UI ticker while recording.
  useEffect(() => {
    if (state.status !== "recording" && state.status !== "paused") return;
    const t = setInterval(() => {
      const r = recRef.current;
      if (!r) return;
      setState((s) => ({
        ...s,
        elapsed: r.elapsed,
        level: r.level,
        noSound: r.quietFor >= NO_SOUND_WARN_SEC,
      }));
    }, 200);
    return () => clearInterval(t);
  }, [state.status]);

  // Never lose a lesson to an accidental tab close.
  useEffect(() => {
    if (state.status !== "recording" && state.status !== "paused") return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [state.status]);

  const saveChunk = useCallback(
    async (s: SegmentData, status: "recording" | "pending") => {
      const lesson = lessonRef.current;
      if (!lesson) return;
      try {
        await localDb.chunks.put({
          id: chunkId(lesson.id, s.index),
          userId: lesson.userId,
          lessonId: lesson.id,
          idx: s.index,
          startSec: s.startSec,
          durationSec: s.durationSec,
          blob: s.blob,
          mime: s.mime,
          status,
          silent: status === "pending" ? s.silent : false,
          attempts: 0,
          nextAttemptAt: 0,
        });
        if (status === "pending") {
          patch({ saveError: null });
          pipeline.notify(lesson.id);
          void updateLesson(lesson.id, { duration_sec: s.startSec + s.durationSec }).catch(() => {});
        }
      } catch (e) {
        patch({
          saveError: `שמירת ההקלטה במחשב נכשלה (${e instanceof Error ? e.message : e}). בדוק שיש מקום פנוי בדיסק.`,
        });
      }
    },
    [patch],
  );

  const stopCaptions = () => {
    capRef.current?.stop();
    capRef.current = null;
  };

  const start: RecorderApi["start"] = useCallback(
    async ({ lesson, source, deviceId, resume }) => {
      if (recRef.current) return false;
      const userId = await currentUserId();
      if (!userId) return false;
      patch({ ...initial, status: "starting", lessonId: lesson.id, courseId: lesson.course_id, lessonTitle: lesson.title, source });
      try {
        const streams = await acquireStreams(source, deviceId);
        let startIndex = 0;
        let startElapsed = 0;
        if (resume) {
          const existing = await lessonChunks(lesson.id);
          startIndex = existing.length ? Math.max(...existing.map((c) => c.idx)) + 1 : 0;
          startElapsed = existing.reduce((m, c) => Math.max(m, c.startSec + c.durationSec), 0);
        }
        lessonRef.current = { id: lesson.id, userId };
        const rec = new LessonRecorder(
          streams,
          {
            onPartial: (s) => saveChunk(s, "recording"),
            onSegment: (s) => saveChunk(s, "pending"),
            onInputStatus: (inputStatus) => {
              setState((st) => ({ ...st, inputStatus, status: inputStatus === "tab-lost" ? "paused" : st.status }));
              if (inputStatus === "tab-lost") capRef.current?.stop();
            },
          },
          startIndex,
          startElapsed,
          deviceId,
        );
        await rec.start();
        recRef.current = rec;
        // Hold a lock while recording so crash recovery can tell a live recording from an orphan.
        void navigator.locks?.request(
          recordingLockName(lesson.id),
          () => new Promise<void>((res) => (lockRelease.current = res)),
        );
        await pipeline.addJob(lesson.id);
        await updateLesson(lesson.id, { status: "recording", input_done: false, error: null });
        if (source !== "tab" && LiveCaptions.isSupported()) {
          const cap = new LiveCaptions((finalText, interim) =>
            setState((s) => ({ ...s, liveText: finalText ? (s.liveText + finalText).slice(-4000) : s.liveText, liveInterim: interim })),
          );
          cap.start();
          capRef.current = cap;
        }
        const bookmarks = resume ? ((await fetchLesson(lesson.id).catch(() => null))?.bookmarks ?? []) : (lesson.bookmarks ?? []);
        patch({ status: "recording", elapsed: startElapsed, bookmarks });
        return true;
      } catch (e) {
        lessonRef.current = null;
        patch({ ...initial, error: e instanceof Error ? e.message : String(e) });
        return false;
      }
    },
    [patch, saveChunk],
  );

  const stop = useCallback(async () => {
    const rec = recRef.current;
    const lesson = lessonRef.current;
    if (!rec || !lesson) return;
    patch({ status: "stopping" });
    stopCaptions();
    await rec.stop();
    recRef.current = null;
    lockRelease.current?.();
    lockRelease.current = null;
    const chunks = await lessonChunks(lesson.id);
    // Partials that never got a final "stop" (shouldn't happen) still count.
    await localDb.chunks
      .where("lessonId")
      .equals(lesson.id)
      .filter((c) => c.status === "recording")
      .modify({ status: "pending" });
    const duration = chunks.reduce((m, c) => Math.max(m, c.startSec + c.durationSec), rec.elapsed);
    const segmentCount = chunks.length ? Math.max(...chunks.map((c) => c.idx)) + 1 : 0;
    try {
      await updateLesson(lesson.id, {
        input_done: true,
        status: segmentCount ? "transcribing" : "error",
        error: segmentCount ? null : "לא נקלט אודיו בהקלטה.",
        duration_sec: duration,
        segment_count: segmentCount,
      });
    } catch (e) {
      patch({ error: `עדכון השיעור בענן נכשל: ${e instanceof Error ? e.message : e}. ההקלטה שמורה במחשב.` });
    }
    lessonRef.current = null;
    pipeline.notify(lesson.id);
    setState((s) => ({ ...initial, error: s.error }));
  }, [patch]);

  const pause = useCallback(() => {
    recRef.current?.pause();
    stopCaptions();
    patch({ status: "paused", level: 0 });
  }, [patch]);

  const resume = useCallback(() => {
    recRef.current?.resume();
    if (state.source !== "tab" && LiveCaptions.isSupported()) {
      const cap = new LiveCaptions((finalText, interim) =>
        setState((s) => ({ ...s, liveText: finalText ? (s.liveText + finalText).slice(-4000) : s.liveText, liveInterim: interim })),
      );
      cap.start();
      capRef.current = cap;
    }
    patch({ status: "recording" });
  }, [patch, state.source]);

  const bookmark = useCallback(
    async (note?: string) => {
      const lesson = lessonRef.current;
      const rec = recRef.current;
      if (!lesson || !rec) return;
      const b: Bookmark = { t: Math.floor(rec.elapsed), ...(note ? { note } : {}) };
      setState((s) => ({ ...s, bookmarks: [...s.bookmarks, b] }));
      try {
        const fresh = await fetchLesson(lesson.id);
        await updateLesson(lesson.id, { bookmarks: [...(fresh?.bookmarks ?? []), b] });
      } catch {
        patch({ saveError: "שמירת הסימנייה נכשלה. נסה שוב." });
      }
    },
    [patch],
  );

  const reattachTab = useCallback(async () => {
    try {
      await recRef.current?.reattachTab();
      patch({ status: "recording", inputStatus: "ok", error: null });
    } catch (e) {
      patch({ error: e instanceof Error ? e.message : String(e) });
    }
  }, [patch]);

  const api: RecorderApi = {
    ...state,
    reattachTab,
    start,
    stop,
    pause,
    resume,
    bookmark,
    clearError: () => patch({ error: null }),
  };
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
