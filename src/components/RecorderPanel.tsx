"use client";

import { useEffect, useRef, useState } from "react";
import { db, uid, type Chunk, type Lesson } from "@/lib/db";
import { LiveCaptions, SegmentedRecorder, SEGMENT_SECONDS, type Segment } from "@/lib/recorder";
import { pipeline } from "@/lib/pipeline";
import { formatClock } from "@/lib/format";

/**
 * Live recording screen: big record button, timer, level meter, bookmarks,
 * notes, a free live caption draft, and the accurate transcript filling in
 * every few minutes as each segment is transcribed.
 */
export default function RecorderPanel({ lesson, chunks }: { lesson: Lesson; chunks: Chunk[] }) {
  const recRef = useRef<SegmentedRecorder | null>(null);
  const capRef = useRef<LiveCaptions | null>(null);
  const [state, setState] = useState<"idle" | "recording" | "paused" | "stopping">("idle");
  const [elapsed, setElapsed] = useState(lesson.durationSec);
  const [level, setLevel] = useState(0);
  const [live, setLive] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState(lesson.notes);
  const liveBoxRef = useRef<HTMLDivElement>(null);
  const resumed = chunks.length > 0;

  // UI ticker
  useEffect(() => {
    if (state !== "recording" && state !== "paused") return;
    const t = setInterval(() => {
      const r = recRef.current;
      if (!r) return;
      setElapsed(r.elapsed);
      setLevel(r.state === "recording" ? r.level() : 0);
    }, 150);
    return () => clearInterval(t);
  }, [state]);

  // Warn before closing the tab mid-recording.
  useEffect(() => {
    if (state !== "recording" && state !== "paused") return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [state]);

  // Stop everything if the component unmounts while recording.
  useEffect(
    () => () => {
      capRef.current?.stop();
      void recRef.current?.stop();
    },
    [],
  );

  useEffect(() => {
    liveBoxRef.current?.scrollTo({ top: liveBoxRef.current.scrollHeight, behavior: "smooth" });
  }, [live, interim, chunks.length]);

  // Persist notes (debounced).
  useEffect(() => {
    const t = setTimeout(() => {
      if (notes !== lesson.notes) void db.lessons.update(lesson.id, { notes });
    }, 600);
    return () => clearTimeout(t);
  }, [notes, lesson.id, lesson.notes]);

  async function onSegment(s: Segment) {
    await db.chunks.add({
      id: uid(),
      lessonId: lesson.id,
      index: s.index,
      startSec: s.startSec,
      durationSec: s.durationSec,
      blob: s.blob,
      mime: s.mime,
      status: "pending",
      attempts: 0,
    });
    await db.lessons.update(lesson.id, { durationSec: s.startSec + s.durationSec });
    pipeline.kick();
  }

  async function start() {
    setError(null);
    if (!SegmentedRecorder.isSupported()) {
      setError("הדפדפן הזה לא תומך בהקלטה. נסה Chrome, Edge או Safari עדכני.");
      return;
    }
    const rec = new SegmentedRecorder(onSegment, chunks.length, lastEnd);
    try {
      await rec.start();
    } catch {
      setError("אין גישה למיקרופון. אשר הרשאת מיקרופון בדפדפן ונסה שוב.");
      return;
    }
    recRef.current = rec;
    await db.lessons.update(lesson.id, { status: "recording" });
    setState("recording");
    if (LiveCaptions.isSupported()) {
      const cap = new LiveCaptions((finalText, interimText) => {
        if (finalText) setLive((p) => p + finalText);
        setInterim(interimText);
      });
      cap.start();
      capRef.current = cap;
    }
  }

  function togglePause() {
    const r = recRef.current;
    if (!r) return;
    if (r.state === "recording") {
      r.pause();
      capRef.current?.stop();
      setState("paused");
    } else {
      r.resume();
      capRef.current?.start();
      setState("recording");
    }
  }

  async function stop() {
    setState("stopping");
    capRef.current?.stop();
    await recRef.current?.stop();
    const duration = recRef.current?.elapsed ?? elapsed;
    recRef.current = null;
    await db.lessons.update(lesson.id, {
      inputDone: true,
      status: "transcribing",
      durationSec: duration,
      notes,
    });
    await pipeline.checkLesson(lesson.id);
  }

  /** Finish a lesson whose recording was interrupted (e.g. page reload). */
  async function finishWithoutRecording() {
    await db.lessons.update(lesson.id, { inputDone: true, status: "transcribing", notes });
    await pipeline.checkLesson(lesson.id);
  }

  async function bookmark() {
    const t = Math.floor(recRef.current?.elapsed ?? elapsed);
    await db.lessons.update(lesson.id, { bookmarks: [...lesson.bookmarks, t] });
  }

  const active = state === "recording" || state === "paused";
  const doneChunks = chunks.filter((c) => c.status === "done");
  const lastEnd = chunks.reduce((m, c) => Math.max(m, c.startSec + c.durationSec), 0);
  const nextIn = Math.max(0, SEGMENT_SECONDS - (elapsed - lastEnd));

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      {/* Controls */}
      <section className="card p-6 lg:col-span-2 flex flex-col items-center text-center gap-5 lg:sticky lg:top-20 self-start">
        <div className="text-5xl font-extrabold tabular-nums tracking-tight" dir="ltr">
          {formatClock(elapsed)}
        </div>

        {/* Level meter */}
        <div className="flex items-end gap-1 h-10" aria-hidden>
          {Array.from({ length: 16 }).map((_, i) => {
            const h = Math.max(0.12, Math.min(1, level * (0.6 + 0.8 * Math.abs(Math.sin(i * 1.7 + elapsed * 3)))));
            return (
              <span
                key={i}
                className="w-1.5 rounded-full transition-[height] duration-150"
                style={{ height: `${h * 100}%`, background: active ? "#dc2626" : "var(--border)" }}
              />
            );
          })}
        </div>

        {!active && state !== "stopping" && (
          <button
            onClick={start}
            className="w-28 h-28 rounded-full bg-red-600 hover:bg-red-700 text-white text-4xl shadow-xl grid place-items-center transition active:scale-95"
            aria-label="התחלת הקלטה"
          >
            🎙️
          </button>
        )}
        {active && (
          <div className="flex items-center gap-4">
            <button onClick={togglePause} className="w-16 h-16 rounded-full btn-ghost border border-soft text-2xl grid place-items-center" aria-label={state === "paused" ? "המשך" : "השהיה"}>
              {state === "paused" ? "▶️" : "⏸️"}
            </button>
            <button
              onClick={stop}
              className={`w-24 h-24 rounded-full bg-red-600 text-white grid place-items-center shadow-xl ${state === "recording" ? "recording-pulse" : ""}`}
              aria-label="סיום הקלטה"
            >
              <span className="w-8 h-8 rounded-md bg-white" />
            </button>
            <button onClick={bookmark} className="w-16 h-16 rounded-full btn-ghost border border-soft text-2xl grid place-items-center" aria-label="סימון רגע חשוב">
              ⭐
            </button>
          </div>
        )}
        {state === "stopping" && <p className="text-muted">שומר את המקטע האחרון…</p>}

        <p className="text-sm text-muted">
          {state === "idle" && !resumed && "לחץ כדי להתחיל להקליט. התמלול מתבצע תוך כדי השיעור."}
          {state === "idle" && resumed && "ההקלטה נקטעה. אפשר להמשיך להקליט או לסיים ולסכם את מה שנקלט."}
          {state === "recording" && `● מקליט · ⭐ לסימון רגע חשוב · המקטע הבא נשלח לתמלול בעוד ${formatClock(nextIn)}`}
          {state === "paused" && "ההקלטה מושהית"}
        </p>
        {state === "idle" && resumed && (
          <button className="btn btn-ghost" onClick={finishWithoutRecording}>
            סיום וסיכום ההקלטה הקיימת
          </button>
        )}
        {lesson.bookmarks.length > 0 && (
          <div className="flex flex-wrap gap-1.5 justify-center">
            {lesson.bookmarks.map((b, i) => (
              <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" dir="ltr">
                ⭐ {formatClock(b)}
              </span>
            ))}
          </div>
        )}
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <p className="text-xs text-muted">
          השאר את המסך פתוח במהלך ההקלטה. ההקלטה נשמרת במכשיר כל 10 שניות.
        </p>
      </section>

      {/* Transcript + notes */}
      <section className="lg:col-span-3 space-y-4">
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold">תמלול</h2>
            <span className="text-xs text-muted">
              {doneChunks.length}/{chunks.length} מקטעים תומללו
            </span>
          </div>
          <div ref={liveBoxRef} className="max-h-[45vh] min-h-40 overflow-y-auto space-y-3 leading-relaxed">
            {doneChunks.map((c) => (
              <p key={c.id}>
                <span className="text-xs text-muted me-2" dir="ltr">{formatClock(c.startSec)}</span>
                {c.text}
              </p>
            ))}
            {(live || interim) && (
              <div className="border-t border-soft pt-3">
                <div className="text-xs font-semibold text-muted mb-1">טיוטה חיה (תוחלף בתמלול מדויק)</div>
                <p className="text-muted">
                  {live.length > 600 ? "…" + live.slice(-600) : live}
                  <span className="opacity-60">{interim}</span>
                </p>
              </div>
            )}
            {!doneChunks.length && !live && !interim && (
              <p className="text-muted text-sm">
                {active
                  ? LiveCaptions.isSupported()
                    ? "מאזין…"
                    : "התמלול המדויק יופיע כאן כל כמה דקות."
                  : "התמלול יופיע כאן במהלך ההקלטה."}
              </p>
            )}
          </div>
        </div>
        <div className="card p-4">
          <h2 className="font-bold mb-2">ההערות שלי</h2>
          <textarea
            className="input min-h-28"
            placeholder="רשום כאן דברים שחשוב לך לזכור. ההערות ישולבו בסיכום."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </section>
    </div>
  );
}
