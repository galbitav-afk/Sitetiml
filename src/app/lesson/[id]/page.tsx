"use client";

import { Suspense, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import {
  deleteLesson,
  insertAttempt,
  updateLesson,
  useCourse,
  useFlashcards,
  useLesson,
  useSegments,
} from "@/lib/data";
import { pipeline, PART_SECONDS } from "@/lib/pipeline";
import { lessonChunks, localDb } from "@/lib/local-db";
import { runTaskWithRetry } from "@/lib/ai-client";
import { lessonChatContext } from "@/lib/context";
import { materialFromParts } from "@/lib/pipeline";
import { sanitizeQuestions, scoreOf, shuffleQuestion } from "@/lib/study";
import { formatClock, formatDate, formatDuration, textDir } from "@/lib/format";
import type { Lesson, Question } from "@/lib/types";
import { useRecorder } from "@/components/recorder-provider";
import { AudioBar, useLessonAudio } from "@/components/lesson-audio";
import SummaryView from "@/components/summary-view";
import QuizRunner from "@/components/quiz-runner";
import FlashcardDeck from "@/components/flashcard-deck";
import ChatPanel from "@/components/chat-panel";
import TranscriptView from "@/components/transcript-view";
import { EmptyState, Modal, PageLoader, Progress, Spinner, StatusBadge, Tabs, useToast } from "@/components/ui";

type Tab = "summary" | "quiz" | "cards" | "transcript" | "chat" | "notes";

export default function LessonPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <LessonView />
    </Suspense>
  );
}

function LessonView() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const { data: lesson, isLoading } = useLesson(id);
  const { data: course } = useCourse(lesson?.course_id);
  const live = !!lesson && lesson.status !== "ready" && lesson.status !== "error";
  const { data: segments } = useSegments(id, live);
  const audio = useLessonAudio(id);
  const [tab, setTabState] = useState<Tab>((params.get("tab") as Tab) || "summary");
  const setTab = (t: Tab) => {
    setTabState(t);
    router.replace(`/lesson/${id}?tab=${t}`, { scroll: false });
  };

  if (isLoading) return <PageLoader />;
  if (!lesson) return <EmptyState icon="🔍" title="השיעור לא נמצא" action={<Link href="/" className="btn btn-primary">לממלכה</Link>} />;

  return (
    <div className="space-y-5">
      <nav className="text-sm text-muted flex items-center gap-1.5 no-print" aria-label="פירורי לחם">
        <Link href="/" className="hover:text-royal">הממלכה</Link>
        <span>›</span>
        {course && <Link href={`/course/${course.id}`} className="hover:text-royal truncate">{course.name}</Link>}
      </nav>

      <LessonHeader lesson={lesson} courseColor={course?.color} />
      <StatusPanel lesson={lesson} segmentsCount={segments?.length ?? 0} />

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "summary", label: "📝 סיכום" },
          { id: "quiz", label: "✅ מבחן", badge: lesson.quiz?.length ? `(${lesson.quiz.length})` : undefined },
          { id: "cards", label: "🃏 כרטיסיות" },
          { id: "transcript", label: "🗒️ תמלול" },
          { id: "chat", label: "💬 שאל את השיעור" },
          { id: "notes", label: "✍️ פתקים" },
        ]}
      />

      <div className="rise" key={tab}>
        {tab === "summary" &&
          (lesson.summary ? (
            <SummaryView summary={lesson.summary} idPrefix={lesson.id} onSeek={audio.available ? audio.playAt : undefined} />
          ) : lesson.parts.length ? (
            <InterimParts lesson={lesson} />
          ) : (
            <EmptyState icon="⏳" title="הסיכום בדרך" text="הוא ייווצר אוטומטית ברגע שהתמלול יסתיים. סיכומי ביניים מופיעים כבר במהלך שיעור ארוך." />
          ))}
        {tab === "quiz" && <LessonQuiz lesson={lesson} />}
        {tab === "cards" && <LessonCards lesson={lesson} />}
        {tab === "transcript" && <TranscriptView segments={segments ?? []} bookmarks={lesson.bookmarks} audio={audio} title={lesson.title} />}
        {tab === "chat" && (
          <ChatPanel
            storageKey={`chat:lesson:${lesson.id}`}
            courseName={course?.name ?? ""}
            buildContext={async () => lessonChatContext(lesson, segments ?? [])}
            intro="שאל כל שאלה על השיעור הזה. התשובה מבוססת על התמלול המלא ועל הסיכום."
            suggestions={["תסביר לי שוב את הנושא המרכזי בפשטות", "מה המרצה אמר שיהיה במבחן?", "תן לי 3 שאלות פתוחות לתרגול", "מה ההבדל בין המושגים העיקריים?"]}
          />
        )}
        {tab === "notes" && <NotesTab lesson={lesson} />}
      </div>

      <AudioBar audio={audio} />
    </div>
  );
}

/* ---------- Header ---------- */

function LessonHeader({ lesson, courseColor }: { lesson: Lesson; courseColor?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function rename(title: string) {
    setEditing(false);
    if (!title.trim() || title.trim() === lesson.title) return;
    await updateLesson(lesson.id, { title: title.trim(), title_edited: true }).catch(() => toast("השינוי נכשל", "error"));
  }

  return (
    <header className="card p-5 sm:p-6 relative overflow-hidden">
      <span className="absolute inset-y-0 right-0 w-1.5" style={{ background: courseColor ?? "var(--royal)" }} />
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              className="input font-display text-2xl font-bold"
              autoFocus
              defaultValue={lesson.title}
              onBlur={(e) => rename(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setEditing(false);
              }}
            />
          ) : (
            <h1 className="font-display text-2xl sm:text-3xl font-bold leading-tight">
              <button className="text-start hover:text-royal transition" onClick={() => setEditing(true)} title="לחץ לשינוי השם">
                {lesson.title}
              </button>
            </h1>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-2 text-sm text-muted">
            <StatusBadge status={lesson.status} />
            <span>{formatDate(lesson.created_at)}</span>
            {lesson.duration_sec > 0 && <span>· {formatDuration(lesson.duration_sec)}</span>}
            {lesson.source === "upload" && <span>· הועלה מקובץ</span>}
            {lesson.bookmarks.length > 0 && <span>· ⭐ {lesson.bookmarks.length}</span>}
          </div>
        </div>
        <div className="flex gap-2 no-print relative">
          {lesson.summary && <button className="btn btn-ghost btn-sm" onClick={() => window.print()}>🖨️ PDF</button>}
          <button className="btn btn-ghost btn-sm" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-label="פעולות נוספות">⋯</button>
          {menu && (
            <div className="absolute top-11 left-0 z-20 card p-1.5 w-56 rise" onMouseLeave={() => setMenu(false)}>
              {lesson.input_done && lesson.status !== "summarizing" && (
                <button
                  className="w-full text-start rounded-lg px-3 py-2 hover:bg-royal-soft text-sm"
                  onClick={() => {
                    setMenu(false);
                    void pipeline.regenerate(lesson);
                    toast("מסכם מחדש. זה ייקח כמה דקות.");
                  }}
                >
                  🔄 יצירת סיכום מחדש
                </button>
              )}
              <button className="w-full text-start rounded-lg px-3 py-2 hover:bg-rose-50 dark:hover:bg-rose-950 text-danger text-sm" onClick={() => { setMenu(false); setConfirmDelete(true); }}>
                🗑 מחיקת השיעור
              </button>
            </div>
          )}
        </div>
      </div>
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="למחוק את השיעור?">
        <p className="text-muted mb-5">יימחקו התמלול, הסיכום, המבחן, הכרטיסיות וההקלטה מהמחשב. אי אפשר לשחזר.</p>
        <div className="flex gap-2">
          <button
            className="btn btn-danger"
            onClick={async () => {
              const courseId = lesson.course_id;
              await deleteLesson(lesson.id);
              router.push(`/course/${courseId}`);
            }}
          >
            מחיקה
          </button>
          <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>ביטול</button>
        </div>
      </Modal>
    </header>
  );
}

/* ---------- Processing / interrupted / error ---------- */

function StatusPanel({ lesson, segmentsCount }: { lesson: Lesson; segmentsCount: number }) {
  const rec = useRecorder();
  const toast = useToast();
  const activity = useSyncExternalStore(pipeline.subscribe, pipeline.getActivity, () => ({}) as Record<string, string>);
  const localChunks = useLiveQuery(() => lessonChunks(lesson.id), [lesson.id]);
  const localJob = useLiveQuery(() => localDb.jobs.get(lesson.id), [lesson.id]);
  const [busy, setBusy] = useState(false);
  const recordingHere = rec.lessonId === lesson.id && rec.status !== "idle";

  if (lesson.status === "recording" && !lesson.input_done) {
    if (recordingHere) {
      return (
        <div className="card p-4 flex items-center gap-3 border-red-300">
          <span className="w-3 h-3 rounded-full bg-red-600 blink" />
          <span className="font-semibold">השיעור מוקלט עכשיו</span>
          <span className="ltr tabular-nums text-muted">{formatClock(rec.elapsed)}</span>
          <Link href="/record" className="btn btn-primary btn-sm ms-auto">לאולפן ההקלטה</Link>
        </div>
      );
    }
    const haveLocal = (localChunks?.length ?? 0) > 0;
    const finish = async () => {
      setBusy(true);
      try {
        const chunks = localChunks ?? [];
        const count = haveLocal ? Math.max(...chunks.map((c) => c.idx)) + 1 : segmentsCount;
        const duration = haveLocal ? chunks.reduce((m, c) => Math.max(m, c.startSec + c.durationSec), 0) : lesson.duration_sec;
        await pipeline.addJob(lesson.id);
        await updateLesson(lesson.id, {
          input_done: true,
          segment_count: count,
          duration_sec: duration,
          status: count ? "transcribing" : "error",
          error: count ? null : "לא נקלט אודיו בהקלטה.",
        });
        pipeline.notify(lesson.id);
      } finally {
        setBusy(false);
      }
    };
    const resume = async (source: "mic" | "tab") => {
      setBusy(true);
      const ok = await rec.start({ lesson, source, resume: true });
      setBusy(false);
      if (!ok) toast(rec.error ?? "לא ניתן להמשיך את ההקלטה", "error");
    };
    return (
      <div className="card p-5 space-y-3 border-amber-300">
        <h2 className="font-display text-lg font-bold">⚠️ ההקלטה נקטעה</h2>
        <p className="text-muted text-sm">
          {haveLocal
            ? `נשמרו ${formatDuration(localChunks!.reduce((m, c) => Math.max(m, c.startSec + c.durationSec), 0))} של הקלטה במחשב הזה. אפשר להמשיך להקליט מאותה נקודה או לסיים ולסכם.`
            : "ההקלטה התחילה במכשיר אחר. אפשר לסיים ולסכם את מה שכבר תומלל."}
        </p>
        <div className="flex flex-wrap gap-2">
          {haveLocal && rec.status === "idle" && (
            <>
              <button className="btn btn-record" onClick={() => resume("mic")} disabled={busy}>⏺ המשך מהמיקרופון</button>
              <button className="btn btn-ghost" onClick={() => resume("tab")} disabled={busy}>💻 המשך משמע המחשב</button>
            </>
          )}
          <button className="btn btn-ghost" onClick={finish} disabled={busy}>{busy && <Spinner className="w-4 h-4" />} סיום וסיכום</button>
        </div>
      </div>
    );
  }

  if (lesson.status === "transcribing" || lesson.status === "summarizing") {
    const total = lesson.segment_count || segmentsCount;
    // No local job here and no progress for a few minutes = the processing device went away.
    // (Re-evaluated on every 4s poll of the lesson.)
    const stalled = localJob === undefined && Date.now() - new Date(lesson.updated_at).getTime() > 3 * 60_000;
    const transcribed = Math.min(segmentsCount, total);
    const expectedParts = Math.max(1, Math.ceil(lesson.duration_sec / PART_SECONDS));
    const pct =
      lesson.status === "summarizing"
        ? 0.9
        : total
          ? 0.75 * (transcribed / total) + 0.15 * Math.min(1, lesson.parts.length / expectedParts)
          : 0.05;
    return (
      <div className="card p-5 space-y-3" aria-live="polite">
        <div className="flex items-center justify-between gap-3">
          <div className="font-semibold flex items-center gap-2">
            <Spinner className="w-4 h-4 text-royal" />
            {activity[lesson.id] ??
              (lesson.status === "summarizing"
                ? "מאחד את הסיכום ובונה מבחן וכרטיסיות…"
                : transcribed < total
                  ? `מתמלל… ${transcribed}/${total} מקטעים`
                  : `מסכם חלקים (${lesson.parts.length}/${expectedParts})…`)}
          </div>
          <span className="text-sm text-muted tabular-nums">{Math.round(pct * 100)}%</span>
        </div>
        <Progress value={pct} />
        <p className="text-xs text-muted">
          אפשר לעזוב את הדף. העיבוד ממשיך כל עוד האתר פתוח באחת הלשוניות במחשב שבו ההקלטה נשמרה.
        </p>
        {stalled && (
          <div className="rounded-xl bg-gold-soft p-3 text-sm flex flex-col sm:flex-row sm:items-center gap-2">
            <span className="flex-1">
              {transcribed >= total
                ? "נראה שהעיבוד נעצר (אולי נסגר המחשב שבו התחיל). כל התמלול כבר בענן, אז אפשר להמשיך כאן."
                : "נראה שהעיבוד נעצר. התמלול ממשיך רק במחשב שבו ההקלטה נשמרה. פתח שם את האתר."}
            </span>
            {transcribed >= total && (
              <button
                className="btn btn-primary btn-sm"
                onClick={async () => {
                  await pipeline.addJob(lesson.id);
                  if (lesson.status === "summarizing") await updateLesson(lesson.id, { status: "transcribing" });
                  pipeline.notify(lesson.id);
                  toast("ממשיך את העיבוד במחשב הזה…");
                }}
              >
                המשך כאן
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  if (lesson.status === "error") {
    return (
      <div className="card p-5 space-y-3 border-rose-300">
        <p className="text-danger font-semibold">⚠️ {lesson.error ?? "אירעה שגיאה בעיבוד"}</p>
        <button
          className="btn btn-primary"
          onClick={async () => {
            await pipeline.retry(lesson);
            toast("מנסה שוב…");
          }}
        >
          נסה שוב
        </button>
      </div>
    );
  }
  return null;
}

function InterimParts({ lesson }: { lesson: Lesson }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-gold-soft p-3 text-sm">אלה סיכומי ביניים. הסיכום המלא, המבחן והכרטיסיות ייווצרו בסוף העיבוד.</div>
      <SummaryView
        idPrefix={`${lesson.id}-interim`}
        compact
        summary={{
          title: lesson.title,
          overview: `סוכמו ${lesson.parts.length} חלקים עד כה.`,
          sections: lesson.parts.flatMap((p) => p.sections),
          keyTerms: lesson.parts.flatMap((p) => p.keyTerms),
          takeaways: lesson.parts.flatMap((p) => p.takeaways),
          openQuestions: lesson.parts.flatMap((p) => p.openQuestions),
        }}
      />
    </div>
  );
}

/* ---------- Quiz ---------- */

function LessonQuiz({ lesson }: { lesson: Lesson }) {
  const toast = useToast();
  const [run, setRun] = useState<{ questions: Question[]; kind: "lesson" | "mistakes"; key: number } | null>(null);
  const [generating, setGenerating] = useState(false);
  const quiz = sanitizeQuestions(lesson.quiz);

  async function generate() {
    setGenerating(true);
    try {
      const r = await runTaskWithRetry("quiz", {
        courseName: "",
        lessonTitle: lesson.title,
        material: materialFromParts(lesson.parts),
        count: Math.max(8, Math.min(20, Math.round(lesson.duration_sec / 60 / 9))),
      });
      await updateLesson(lesson.id, { quiz: sanitizeQuestions(r.questions) });
      toast("נוצר מבחן חדש", "success");
    } catch (e) {
      toast(`יצירת המבחן נכשלה: ${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setGenerating(false);
    }
  }

  if (!quiz.length) {
    return lesson.parts.length && lesson.status === "ready" ? (
      <EmptyState icon="✅" title="אין עדיין מבחן לשיעור" action={<button className="btn btn-primary" disabled={generating} onClick={generate}>{generating && <Spinner className="w-4 h-4" />} צור מבחן</button>} />
    ) : (
      <EmptyState icon="✅" title="המבחן ייווצר יחד עם הסיכום" />
    );
  }

  if (!run) {
    return (
      <div className="card p-6 sm:p-8 text-center space-y-4">
        <div className="text-5xl" aria-hidden>✅</div>
        <h2 className="font-display text-2xl font-bold">מבחן הבנה · {quiz.length} שאלות</h2>
        <p className="text-muted">שאלה אחת בכל פעם, עם משוב והסבר מיד אחרי כל תשובה. מקלדת: 1-4 לבחירה, Enter להמשך.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <button className="btn btn-primary btn-lg" onClick={() => setRun({ questions: quiz.map(shuffleQuestion), kind: "lesson", key: Date.now() })}>התחל מבחן</button>
          <button className="btn btn-ghost" disabled={generating} onClick={generate}>{generating && <Spinner className="w-4 h-4" />} 🔄 שאלות חדשות</button>
        </div>
      </div>
    );
  }

  return (
    <QuizRunner
      key={run.key}
      questions={run.questions}
      mode="practice"
      onFinish={async (answers, duration) => {
        await insertAttempt({
          course_id: lesson.course_id,
          lesson_id: lesson.id,
          kind: run.kind,
          score: scoreOf(run.questions, answers),
          questions: run.questions,
          answers,
          duration_sec: duration,
        }).catch(() => toast("שמירת התוצאה נכשלה", "error"));
      }}
      onRestart={() => setRun({ questions: quiz.map(shuffleQuestion), kind: "lesson", key: Date.now() })}
      onRetryMistakes={(wrong) => setRun({ questions: wrong.map(shuffleQuestion), kind: "mistakes", key: Date.now() })}
    />
  );
}

/* ---------- Flashcards ---------- */

function LessonCards({ lesson }: { lesson: Lesson }) {
  const { data: cards, isLoading } = useFlashcards(lesson.course_id);
  const [session, setSession] = useState(0);
  const [mode, setMode] = useState<"browse" | "review">("browse");
  const mine = (cards ?? []).filter((c) => c.lesson_id === lesson.id);
  if (isLoading) return <PageLoader />;
  if (!mine.length) return <EmptyState icon="🃏" title="אין כרטיסיות לשיעור הזה" text="הכרטיסיות נוצרות אוטומטית יחד עם הסיכום." />;
  if (mode === "review") {
    return (
      <div className="space-y-4">
        <button className="btn btn-quiet btn-sm" onClick={() => setMode("browse")}>→ לכל הכרטיסיות</button>
        <FlashcardDeck key={session} cards={mine} />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted">{mine.length} כרטיסיות בשיעור הזה</p>
        <button className="btn btn-primary" onClick={() => { setSession(Date.now()); setMode("review"); }}>▶ תרגול כרטיסיות</button>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {mine.map((c) => (
          <div key={c.id} className="card p-4">
            <div className="font-semibold" dir={textDir(c.front)}>{c.front}</div>
            <div className="text-sm text-muted mt-2 leading-relaxed" dir={textDir(c.back)}>{c.back}</div>
            <div className="text-[11px] text-muted mt-2">קופסה {c.box}/5</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Notes ---------- */

function NotesTab({ lesson }: { lesson: Lesson }) {
  const toast = useToast();
  const [notes, setNotes] = useState(lesson.notes);
  const [saved, setSaved] = useState(true);

  useEffect(() => {
    if (notes === lesson.notes) return;
    setSaved(false);
    const t = setTimeout(async () => {
      try {
        await updateLesson(lesson.id, { notes });
        setSaved(true);
      } catch {
        toast("שמירת הפתקים נכשלה", "error");
      }
    }, 800);
    return () => clearTimeout(t);
  }, [notes, lesson.id, lesson.notes, toast]);

  async function removeBookmark(i: number) {
    await updateLesson(lesson.id, { bookmarks: lesson.bookmarks.filter((_, k) => k !== i) });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="card p-4 lg:col-span-2 space-y-2">
        <div className="flex justify-between items-center">
          <h2 className="font-display font-bold">הפתקים שלי</h2>
          <span className="text-xs text-muted">{saved ? "✓ נשמר" : "שומר…"}</span>
        </div>
        <textarea className="textarea min-h-72" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="כל מה שחשוב לך לזכור מהשיעור…" />
        <p className="hint">כדי לשלב פתקים חדשים בסיכום, בחר “יצירת סיכום מחדש” בתפריט ⋯.</p>
      </div>
      <div className="card p-4 space-y-3">
        <h2 className="font-display font-bold">⭐ סימניות ופתקים מהשיעור</h2>
        {lesson.bookmarks.length ? (
          <ul className="space-y-2">
            {lesson.bookmarks.map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-sm group">
                <span className="chip bg-gold-soft text-ink ltr shrink-0">{formatClock(b.t)}</span>
                <span className="flex-1">{b.note ?? "רגע חשוב"}</span>
                <button className="opacity-0 group-hover:opacity-100 text-muted hover:text-danger" onClick={() => removeBookmark(i)} aria-label="מחיקת סימנייה">✕</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">במהלך הקלטה אפשר ללחוץ ⭐ (או Ctrl+B) ולכתוב פתקים עם חותמת זמן.</p>
        )}
      </div>
    </div>
  );
}
