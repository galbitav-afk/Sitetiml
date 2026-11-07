"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db, deleteLesson, getLessonChunks } from "@/lib/db";
import { pipeline } from "@/lib/pipeline";
import { formatDate, formatDuration } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import RecorderPanel from "@/components/RecorderPanel";
import SummaryView from "@/components/SummaryView";
import TranscriptView from "@/components/TranscriptView";
import QuizView from "@/components/QuizView";

type Tab = "summary" | "quiz" | "transcript" | "notes";

export default function LessonPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const lesson = useLiveQuery(() => db.lessons.get(id), [id]);
  const course = useLiveQuery(() => (lesson ? db.courses.get(lesson.courseId) : undefined), [lesson?.courseId]);
  const chunks = useLiveQuery(() => getLessonChunks(id), [id]);
  const [tab, setTab] = useState<Tab>("summary");
  const [editingTitle, setEditingTitle] = useState(false);

  if (lesson === undefined || chunks === undefined) return <p className="text-muted">טוען…</p>;
  if (lesson === null) return <p>השיעור לא נמצא. <Link href="/" className="text-brand-600">לדף הבית</Link></p>;

  const isRecording = lesson.status === "recording" && !lesson.inputDone;
  const done = chunks.filter((c) => c.status === "done").length;
  const progress = chunks.length ? done / chunks.length : 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm text-muted no-print">
        <Link href="/" className="hover:underline">הקורסים שלי</Link>
        <span>›</span>
        {course && <Link href={`/course/${course.id}`} className="hover:underline">{course.name}</Link>}
      </div>

      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          {editingTitle ? (
            <input
              className="input text-xl font-bold"
              autoFocus
              defaultValue={lesson.title}
              onBlur={async (e) => {
                const title = e.target.value.trim();
                if (title && title !== lesson.title) await db.lessons.update(id, { title, titleEdited: true });
                setEditingTitle(false);
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
          ) : (
            <h1 className="text-2xl sm:text-3xl font-extrabold cursor-text" onClick={() => setEditingTitle(true)} title="לחץ לשינוי השם">
              {lesson.title}
            </h1>
          )}
          <div className="flex items-center gap-2 mt-1 text-sm text-muted flex-wrap">
            <StatusBadge status={lesson.status} />
            <span>{formatDate(lesson.createdAt)}</span>
            {lesson.durationSec > 0 && <span>· {formatDuration(lesson.durationSec)}</span>}
          </div>
        </div>
        {!isRecording && (
          <div className="flex gap-2 no-print">
            {lesson.summary && (
              <button className="btn btn-ghost text-sm" onClick={() => window.print()}>🖨️ הדפסה / PDF</button>
            )}
          </div>
        )}
      </header>

      {isRecording ? (
        <RecorderPanel lesson={lesson} chunks={chunks} />
      ) : (
        <>
          {(lesson.status === "transcribing" || lesson.status === "summarizing") && (
            <div className="card p-5 space-y-3">
              <div className="flex justify-between text-sm font-semibold">
                <span>{lesson.status === "transcribing" ? `מתמלל… ${done}/${chunks.length} מקטעים` : "Claude מסכם את השיעור ויוצר מבחן…"}</span>
                <span>{lesson.status === "transcribing" ? `${Math.round(progress * 100)}%` : ""}</span>
              </div>
              <div className="h-2 rounded-full bg-[var(--border)] overflow-hidden">
                <div
                  className={`h-full bg-brand-600 transition-all ${lesson.status === "summarizing" ? "animate-pulse w-full" : ""}`}
                  style={lesson.status === "transcribing" ? { width: `${progress * 100}%` } : undefined}
                />
              </div>
              <p className="text-xs text-muted">אפשר לעזוב את הדף. העיבוד ממשיך כל עוד האתר פתוח באחת הלשוניות.</p>
            </div>
          )}

          {lesson.status === "error" && (
            <div className="card p-5 border-rose-300 space-y-3">
              <p className="text-rose-600 font-semibold">⚠️ {lesson.error ?? "אירעה שגיאה"}</p>
              <button className="btn btn-primary" onClick={() => pipeline.retry(id)}>נסה שוב</button>
            </div>
          )}

          <nav className="flex gap-1 p-1 card no-print overflow-x-auto">
            {(
              [
                ["summary", "📝 סיכום"],
                ["quiz", `✅ מבחן${lesson.summary ? ` (${lesson.summary.quiz.length})` : ""}`],
                ["transcript", "🗒️ תמלול"],
                ["notes", "✍️ הערות"],
              ] as [Tab, string][]
            ).map(([t, label]) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 px-3 py-2 rounded-lg font-semibold text-sm whitespace-nowrap transition ${
                  tab === t ? "bg-brand-600 text-white" : "hover:bg-[color-mix(in_srgb,var(--text)_6%,transparent)]"
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          {tab === "summary" &&
            (lesson.summary ? (
              <>
                <SummaryView summary={lesson.summary} />
                <div className="flex justify-center no-print">
                  <button
                    className="btn btn-ghost text-sm"
                    disabled={lesson.status === "summarizing"}
                    onClick={() => confirm("ליצור סיכום ומבחן מחדש?") && pipeline.regenerateSummary(id)}
                  >
                    🔄 יצירת סיכום מחדש
                  </button>
                </div>
              </>
            ) : (
              <p className="text-muted card p-6 text-center">הסיכום יופיע כאן כשהעיבוד יסתיים.</p>
            ))}

          {tab === "quiz" &&
            (lesson.summary?.quiz.length ? (
              <QuizView key={lesson.summary.title} lesson={lesson} quiz={lesson.summary.quiz} />
            ) : (
              <p className="text-muted card p-6 text-center">המבחן ייווצר יחד עם הסיכום.</p>
            ))}

          {tab === "transcript" && <TranscriptView chunks={chunks} bookmarks={lesson.bookmarks} />}

          {tab === "notes" && (
            <div className="card p-4">
              <textarea
                className="input min-h-60"
                defaultValue={lesson.notes}
                placeholder="ההערות שלך לשיעור הזה"
                onBlur={(e) => db.lessons.update(id, { notes: e.target.value })}
              />
              <p className="text-xs text-muted mt-2">נשמר אוטומטית. כדי לשלב הערות חדשות בסיכום, צור סיכום מחדש.</p>
            </div>
          )}

          <div className="pt-4 no-print">
            <button
              className="text-sm text-rose-600 hover:underline"
              onClick={async () => {
                if (confirm("למחוק את השיעור, כולל ההקלטה והסיכום?")) {
                  const courseId = lesson.courseId;
                  await deleteLesson(id);
                  router.push(`/course/${courseId}`);
                }
              }}
            >
              מחיקת השיעור
            </button>
          </div>
        </>
      )}
    </div>
  );
}
