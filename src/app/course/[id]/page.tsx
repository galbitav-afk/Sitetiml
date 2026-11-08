"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  createLesson,
  deleteCourse,
  insertAttempt,
  updateCourse,
  useAttempts,
  useCourse,
  useDigest,
  useFlashcards,
  useLessons,
  nextLessonTitle,
} from "@/lib/data";
import { chunkId, localDb } from "@/lib/local-db";
import { pipeline } from "@/lib/pipeline";
import { splitRecording } from "@/lib/upload";
import { runTaskWithRetry } from "@/lib/ai-client";
import { courseDigestText, lessonDigestText } from "@/lib/context";
import { buildNotebook, notebookMarkdown } from "@/lib/notebook";
import { collectMistakes, isDue, sanitizeQuestions, scoreOf, shuffleQuestion, topicStats, weakTopics } from "@/lib/study";
import { currentUserId } from "@/lib/supabase";
import { daysUntil, formatDate, formatDuration, todayISO } from "@/lib/format";
import type { Course, Notebook, Question } from "@/lib/types";
import { CourseForm } from "@/components/course-form";
import Markdown from "@/components/markdown";
import SummaryView from "@/components/summary-view";
import QuizRunner from "@/components/quiz-runner";
import FlashcardDeck from "@/components/flashcard-deck";
import ChatPanel from "@/components/chat-panel";
import { EmptyState, Modal, PageLoader, Progress, Spinner, StatusBadge, Tabs, useToast } from "@/components/ui";

type Tab = "lessons" | "notebook" | "cards" | "exams" | "chat" | "plan" | "settings";

export default function CoursePage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <CourseView />
    </Suspense>
  );
}

function CourseView() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const { data: course, isLoading } = useCourse(id);
  const [tab, setTabState] = useState<Tab>((params.get("tab") as Tab) || "lessons");
  const setTab = (t: Tab) => {
    setTabState(t);
    router.replace(`/course/${id}?tab=${t}`, { scroll: false });
  };
  const { data: cards } = useFlashcards(id);
  const due = (cards ?? []).filter(isDue).length;

  if (isLoading) return <PageLoader />;
  if (!course) return <EmptyState icon="🔍" title="הקורס לא נמצא" action={<Link href="/" className="btn btn-primary">לממלכה</Link>} />;
  const d = course.exam_date ? daysUntil(course.exam_date) : null;

  return (
    <div className="space-y-5">
      <header className="card p-5 sm:p-6 relative overflow-hidden no-print">
        <span className="absolute inset-y-0 right-0 w-2" style={{ background: course.color }} />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-muted">קורס</p>
            <h1 className="font-display text-3xl font-bold leading-tight">{course.name}</h1>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {d !== null && d >= 0 && <span className="chip bg-gold-soft text-ink">📅 מבחן בעוד {d} ימים ({formatDate(course.exam_date!)})</span>}
              {d !== null && d < 0 && <span className="chip bg-line text-muted">המבחן היה ב-{formatDate(course.exam_date!)}</span>}
              {due > 0 && <span className="chip bg-royal-soft text-royal">🃏 {due} כרטיסיות לחזרה</span>}
            </div>
          </div>
          <Link href={`/record?course=${course.id}`} className="btn btn-record shrink-0">🎙️ הקלטת שיעור</Link>
        </div>
      </header>

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "lessons", label: "📚 שיעורים" },
          { id: "notebook", label: "📓 מחברת" },
          { id: "cards", label: "🃏 כרטיסיות", badge: due ? `(${due})` : undefined },
          { id: "exams", label: "🎯 מבחנים" },
          { id: "chat", label: "💬 שאל את הקורס" },
          { id: "plan", label: "🗓️ תוכנית לימוד" },
          { id: "settings", label: "⚙️ הגדרות" },
        ]}
      />

      <div key={tab} className="rise">
        {tab === "lessons" && <LessonsTab course={course} autoUpload={params.get("upload") === "1"} />}
        {tab === "notebook" && <NotebookTab course={course} />}
        {tab === "cards" && <CardsTab course={course} />}
        {tab === "exams" && <ExamsTab course={course} />}
        {tab === "chat" && <CourseChat course={course} />}
        {tab === "plan" && <PlanTab course={course} />}
        {tab === "settings" && <SettingsTab course={course} />}
      </div>
    </div>
  );
}

/* ---------------- Lessons ---------------- */

function LessonsTab({ course, autoUpload }: { course: Course; autoUpload: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const { data: lessons, isLoading } = useLessons(course.id);
  const { data: attempts } = useAttempts(course.id);
  const fileRef = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<{ stage: string; ratio: number } | null>(null);

  const best = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of attempts ?? []) if (a.lesson_id && a.kind === "lesson") m.set(a.lesson_id, Math.max(m.get(a.lesson_id) ?? 0, a.score));
    return m;
  }, [attempts]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUpload({ stage: "מתחיל…", ratio: 0 });
    try {
      const { chunks, durationSec } = await splitRecording(file, (stage, ratio) => setUpload({ stage, ratio }));
      const userId = await currentUserId();
      if (!userId) throw new Error("נדרשת התחברות");
      const baseName = file.name.replace(/\.[^.]+$/, "");
      const lesson = await createLesson({
        course_id: course.id,
        title: baseName || (await nextLessonTitle(course.id)),
        source: "upload",
        status: "transcribing",
        input_done: true,
        duration_sec: durationSec,
        segment_count: chunks.length,
      });
      await localDb.chunks.bulkPut(
        chunks.map((c, i) => ({
          id: chunkId(lesson.id, i),
          userId,
          lessonId: lesson.id,
          idx: i,
          startSec: c.startSec,
          durationSec: c.durationSec,
          blob: c.blob,
          mime: c.mime,
          status: "pending" as const,
          silent: false,
          attempts: 0,
          nextAttemptAt: 0,
        })),
      );
      await pipeline.addJob(lesson.id);
      pipeline.notify(lesson.id);
      setUpload(null);
      router.push(`/lesson/${lesson.id}`);
    } catch (err) {
      setUpload(null);
      toast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  if (isLoading) return <PageLoader />;
  const list = [...(lessons ?? [])];

  return (
    <div className="space-y-4">
      <div className={`card p-4 flex flex-col sm:flex-row sm:items-center gap-3 ${autoUpload ? "ring-2 ring-gold" : ""}`}>
        <div className="flex-1">
          <div className="font-semibold">יש לך הקלטה מוכנה?</div>
          <div className="text-sm text-muted">אודיו או וידאו בכל אורך (גם 3 שעות): MP3, M4A, WAV, MP4, WEBM…</div>
        </div>
        <button className="btn btn-ghost" onClick={() => fileRef.current?.click()} disabled={!!upload}>⬆️ העלאת קובץ</button>
        <input ref={fileRef} type="file" accept="audio/*,video/*,.m4a,.mp3,.wav,.mp4,.webm,.ogg,.aac,.flac,.mkv,.mov" className="hidden" onChange={onFile} />
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon="🎙️"
          title="עוד אין שיעורים בקורס"
          text="הקלט את השיעור הבא או העלה הקלטה קיימת."
          action={<Link href={`/record?course=${course.id}`} className="btn btn-record">🎙️ הקלטת שיעור</Link>}
        />
      ) : (
        <ol className="space-y-2.5">
          {list.map((l, i) => (
            <li key={l.id}>
              <Link href={`/lesson/${l.id}`} className="card p-4 flex items-center gap-4 hover:-translate-y-0.5 hover:shadow-lg transition">
                <span className="grid place-items-center w-11 h-11 rounded-xl bg-royal-soft text-royal font-bold shrink-0">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold truncate">{l.title}</span>
                  <span className="block text-xs text-muted mt-0.5">
                    {formatDate(l.created_at)}
                    {l.duration_sec > 0 && ` · ${formatDuration(l.duration_sec)}`}
                    {best.has(l.id) && ` · שיא במבחן: ${best.get(l.id)}%`}
                  </span>
                </span>
                <StatusBadge status={l.status} />
              </Link>
            </li>
          ))}
        </ol>
      )}

      <Modal open={!!upload} onClose={() => {}} title="מכין את ההקלטה">
        <div className="space-y-3">
          <p className="text-muted">{upload?.stage}</p>
          <Progress value={upload?.ratio ?? 0} />
          <p className="text-xs text-muted">העיבוד נעשה במחשב שלך. בקובץ של 3 שעות זה עשוי לקחת כמה דקות. לא לסגור את הלשונית.</p>
        </div>
      </Modal>
    </div>
  );
}

/* ---------------- Notebook ---------------- */

function NotebookTab({ course }: { course: Course }) {
  const { data: digest, isLoading } = useDigest(course.id);
  const toast = useToast();
  const [view, setView] = useState<"merged" | "lessons">(course.notebook ? "merged" : "lessons");
  const [progress, setProgress] = useState<{ text: string; ratio: number } | null>(null);
  const nb = course.notebook;
  const lessons = digest ?? [];
  const missing = lessons.filter((l) => !course.notebook_lesson_ids.includes(l.id)).length;

  async function build() {
    setProgress({ text: "מתחיל…", ratio: 0 });
    try {
      await buildNotebook(course, lessons, (text, ratio) => setProgress({ text, ratio }));
      setView("merged");
      toast("המחברת מוכנה 📓", "success");
    } catch (e) {
      toast(`בניית המחברת נכשלה: ${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setProgress(null);
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([notebookMarkdown(course, nb, lessons)], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${course.name} - מחברת.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (isLoading) return <PageLoader />;
  if (!lessons.length) return <EmptyState icon="📓" title="המחברת תיבנה מהשיעורים המסוכמים" text="אחרי שיעור מסוכם אחד לפחות אפשר לבנות מחברת קורס." />;

  return (
    <div className="space-y-4">
      <div className="card p-4 sm:p-5 flex flex-col md:flex-row md:items-center gap-3 no-print">
        <div className="flex-1">
          <div className="font-semibold">{nb ? nb.title : "מחברת הקורס"}</div>
          <div className="text-sm text-muted">
            {lessons.length} שיעורים מסוכמים
            {course.notebook_updated_at && ` · המחברת המאוחדת עודכנה ${formatDate(course.notebook_updated_at)}`}
          </div>
          {nb && missing > 0 && <div className="text-sm text-warning mt-1">נוספו {missing} שיעורים מאז העדכון האחרון.</div>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-gold" onClick={build} disabled={!!progress}>
            {progress ? <Spinner className="w-4 h-4" /> : "✨"} {nb ? "עדכון המחברת" : "בניית מחברת מאוחדת"}
          </button>
          <button className="btn btn-ghost" onClick={() => window.print()}>🖨️ PDF</button>
          <button className="btn btn-ghost" onClick={download}>⬇️ Markdown</button>
        </div>
      </div>
      {progress && (
        <div className="card p-4 space-y-2 no-print">
          <div className="text-sm font-medium">{progress.text}</div>
          <Progress value={progress.ratio} />
        </div>
      )}

      <Tabs<"merged" | "lessons">
        value={view}
        onChange={setView}
        tabs={[
          { id: "merged", label: "מחברת מאוחדת לפי נושאים" },
          { id: "lessons", label: "סיכומים לפי שיעור" },
        ]}
      />

      {view === "merged" ? (
        nb ? (
          <NotebookView nb={nb} courseName={course.name} />
        ) : (
          <EmptyState icon="✨" title="עוד לא נבנתה מחברת מאוחדת" text="המחברת המאוחדת מארגנת את כל החומר לפי נושאים, עם מילון מושגים ודף הכנה למבחן." />
        )
      ) : (
        <div className="space-y-10">
          {lessons.map((l, i) => (
            <section key={l.id} className={i ? "print-break" : ""}>
              <h2 className="font-display text-2xl font-bold mb-3">
                <span className="text-muted">שיעור {i + 1} · </span>
                <Link href={`/lesson/${l.id}`} className="hover:text-royal">{l.title}</Link>
              </h2>
              <SummaryView summary={l.summary!} idPrefix={l.id} />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function NotebookView({ nb, courseName }: { nb: Notebook; courseName: string }) {
  return (
    <article className="space-y-5">
      <div className="hidden print:block text-center mb-8">
        <div className="text-sm">הממלכה של גל · {courseName}</div>
        <h1 className="font-display text-4xl font-bold mt-2">{nb.title}</h1>
      </div>
      <nav className="card p-5 no-print">
        <h2 className="font-display font-bold mb-2">תוכן עניינים</h2>
        <ol className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 list-decimal ps-5 marker:text-muted">
          {nb.chapters.map((c, i) => <li key={i}><a href={`#ch-${i}`} className="text-royal hover:underline">{c.title}</a></li>)}
          <li><a href="#glossary" className="text-royal hover:underline">מילון מושגים</a></li>
          <li><a href="#exam-prep" className="text-royal hover:underline">הכנה למבחן</a></li>
        </ol>
      </nav>
      <section className="card p-5 sm:p-6"><Markdown>{nb.introduction}</Markdown></section>
      {nb.chapters.map((c, i) => (
        <section key={i} id={`ch-${i}`} className="card p-5 sm:p-6 scroll-mt-24 print-break">
          <h2 className="font-display text-2xl font-bold mb-1"><span className="text-muted">פרק {i + 1}: </span>{c.title}</h2>
          {c.lessonNumbers.length > 0 && <p className="text-xs text-muted mb-3">מתוך שיעורים {c.lessonNumbers.join(", ")}</p>}
          <Markdown>{c.content}</Markdown>
        </section>
      ))}
      <section id="glossary" className="card p-5 sm:p-6 scroll-mt-24 print-break">
        <h2 className="font-display text-2xl font-bold mb-3">📚 מילון מושגים</h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          {nb.glossary.map((g, i) => (
            <div key={i} className="rounded-xl border border-line p-3">
              <dt className="font-bold">{g.term}</dt>
              <dd className="text-sm text-muted mt-1">{g.definition}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section id="exam-prep" className="card p-5 sm:p-6 scroll-mt-24 print-break bg-gradient-to-l from-gold-soft to-card">
        <h2 className="font-display text-2xl font-bold mb-3">🎯 הכנה למבחן</h2>
        <Markdown>{nb.examPrep}</Markdown>
      </section>
    </article>
  );
}

/* ---------------- Flashcards ---------------- */

function CardsTab({ course }: { course: Course }) {
  const { data: cards, isLoading } = useFlashcards(course.id);
  const [session, setSession] = useState<"due" | "all" | null>(null);
  const [key, setKey] = useState(0);
  if (isLoading) return <PageLoader />;
  const all = cards ?? [];
  const due = all.filter(isDue);
  if (session) {
    return (
      <div className="space-y-4">
        <button className="btn btn-quiet btn-sm" onClick={() => setSession(null)}>→ חזרה</button>
        <FlashcardDeck key={key} cards={session === "due" ? due : all} />
      </div>
    );
  }
  const boxes = [1, 2, 3, 4, 5].map((b) => all.filter((c) => c.box === b).length);
  return (
    <div className="space-y-4">
      <div className="card p-6 text-center space-y-4">
        <div className="text-5xl" aria-hidden>🃏</div>
        <h2 className="font-display text-2xl font-bold">{due.length} כרטיסיות מחכות לחזרה</h2>
        <p className="text-muted">חזרה מרווחת: כרטיסייה שידעת חוזרת אחרי יום, 3 ימים, שבוע, שבועיים וחודש. כך החומר נשאר בזיכרון לטווח ארוך.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <button className="btn btn-primary btn-lg" disabled={!due.length} onClick={() => { setKey(Date.now()); setSession("due"); }}>▶ חזרה יומית</button>
          <button className="btn btn-ghost" disabled={!all.length} onClick={() => { setKey(Date.now()); setSession("all"); }}>תרגול כל הכרטיסיות ({all.length})</button>
        </div>
      </div>
      {all.length > 0 && (
        <div className="card p-5">
          <h3 className="font-display font-bold mb-3">רמת שליטה</h3>
          <div className="grid grid-cols-5 gap-2 text-center">
            {boxes.map((n, i) => (
              <div key={i} className="rounded-xl p-3" style={{ background: `color-mix(in srgb, var(--royal) ${8 + i * 12}%, var(--card))` }}>
                <div className="text-2xl font-bold">{n}</div>
                <div className="text-[11px] text-muted">{["חדש", "מתחיל", "בינוני", "טוב", "שולט"][i]}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Exams ---------------- */

function ExamsTab({ course }: { course: Course }) {
  const toast = useToast();
  const { data: digest } = useDigest(course.id);
  const { data: attempts } = useAttempts(course.id);
  const lessons = digest ?? [];
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [count, setCount] = useState(20);
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [minutes, setMinutes] = useState(0);
  const [focusWeak, setFocusWeak] = useState(true);
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<{ questions: Question[]; kind: "exam" | "mistakes"; timer?: number; key: number } | null>(null);

  const sel = selected ?? new Set(lessons.map((l) => l.id));
  const stats = topicStats(attempts ?? []);
  const weak = weakTopics(stats);
  const mistakes = collectMistakes(attempts ?? []);

  async function generate() {
    const chosen = lessons.filter((l) => sel.has(l.id));
    if (!chosen.length) return toast("בחר לפחות שיעור אחד", "error");
    setBusy(true);
    try {
      const r = await runTaskWithRetry("exam", {
        courseName: course.name,
        material: chosen.map((l) => lessonDigestText(l, lessons.indexOf(l) + 1)).join("\n\n---\n\n"),
        count,
        difficulty,
        focusTopics: focusWeak ? weak : [],
      });
      const qs = sanitizeQuestions(r.questions);
      if (!qs.length) throw new Error("לא התקבלו שאלות");
      setRun({ questions: qs, kind: "exam", timer: minutes ? minutes * 60 : undefined, key: Date.now() });
    } catch (e) {
      toast(`יצירת המבחן נכשלה: ${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setBusy(false);
    }
  }

  if (run) {
    return (
      <div className="space-y-4">
        <button className="btn btn-quiet btn-sm" onClick={() => setRun(null)}>→ חזרה למבחנים</button>
        <QuizRunner
          key={run.key}
          questions={run.questions}
          mode={run.kind === "exam" ? "exam" : "practice"}
          timeLimitSec={run.timer}
          onFinish={async (answers, duration) => {
            await insertAttempt({
              course_id: course.id,
              lesson_id: null,
              kind: run.kind,
              score: scoreOf(run.questions, answers),
              questions: run.questions,
              answers,
              duration_sec: duration,
            }).catch(() => toast("שמירת התוצאה נכשלה", "error"));
          }}
          onRetryMistakes={(wrong) => setRun({ questions: wrong.map(shuffleQuestion), kind: "mistakes", key: Date.now() })}
        />
      </div>
    );
  }

  if (!lessons.length) return <EmptyState icon="🎯" title="סימולציות מבחן ייפתחו אחרי השיעור המסוכם הראשון" />;

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <section className="card p-5 sm:p-6 space-y-5 lg:col-span-3">
        <h2 className="font-display text-xl font-bold">🎯 סימולציית מבחן</h2>
        <div>
          <div className="flex justify-between items-center mb-2">
            <span className="label mb-0">על אילו שיעורים?</span>
            <button className="text-xs text-royal" onClick={() => setSelected(sel.size === lessons.length ? new Set() : new Set(lessons.map((l) => l.id)))}>
              {sel.size === lessons.length ? "נקה הכל" : "בחר הכל"}
            </button>
          </div>
          <div className="grid sm:grid-cols-2 gap-1.5 max-h-56 overflow-y-auto">
            {lessons.map((l, i) => (
              <label key={l.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-royal-soft/50 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  className="accent-[var(--royal)] w-4 h-4"
                  checked={sel.has(l.id)}
                  onChange={(e) => {
                    const next = new Set(sel);
                    if (e.target.checked) next.add(l.id);
                    else next.delete(l.id);
                    setSelected(next);
                  }}
                />
                <span className="truncate">{i + 1}. {l.title}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <label className="label" htmlFor="ex-count">מספר שאלות</label>
            <select id="ex-count" className="select" value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {[10, 20, 30, 40].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ex-diff">רמת קושי</label>
            <select id="ex-diff" className="select" value={difficulty} onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}>
              <option value="easy">קל</option>
              <option value="medium">בינוני</option>
              <option value="hard">קשה (כמו במבחן אמיתי)</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ex-time">זמן</label>
            <select id="ex-time" className="select" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              <option value={0}>בלי שעון</option>
              {[15, 30, 60, 90, 120, 180].map((m) => <option key={m} value={m}>{m} דקות</option>)}
            </select>
          </div>
        </div>
        {weak.length > 0 && (
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" className="accent-[var(--royal)] w-4 h-4" checked={focusWeak} onChange={(e) => setFocusWeak(e.target.checked)} />
            תן משקל גבוה לנושאים החלשים שלי ({weak.slice(0, 3).join(", ")}{weak.length > 3 ? "…" : ""})
          </label>
        )}
        <button className="btn btn-primary btn-lg" disabled={busy || !sel.size} onClick={generate}>
          {busy ? <><Spinner className="w-5 h-5" /> מכין מבחן…</> : "צור מבחן"}
        </button>
      </section>

      <aside className="space-y-4 lg:col-span-2">
        {mistakes.length > 0 && (
          <div className="card p-5 space-y-2">
            <h3 className="font-display font-bold">🔁 בנק הטעויות</h3>
            <p className="text-sm text-muted">{mistakes.length} שאלות שטעית בהן לאחרונה. תרגול ממוקד הוא הדרך המהירה ביותר להשתפר.</p>
            <button className="btn btn-gold w-full" onClick={() => setRun({ questions: mistakes.map(shuffleQuestion), kind: "mistakes", key: Date.now() })}>תרגל את הטעויות</button>
          </div>
        )}
        {stats.length > 0 && (
          <div className="card p-5">
            <h3 className="font-display font-bold mb-3">📊 חוזקות וחולשות</h3>
            <div className="space-y-2.5">
              {stats.slice(0, 10).map((s) => (
                <div key={s.topic} className="text-sm">
                  <div className="flex justify-between mb-1">
                    <span className="truncate">{s.topic}</span>
                    <span className={`font-semibold tabular-nums ${s.pct < 60 ? "text-danger" : s.pct < 80 ? "text-warning" : "text-success"}`}>{s.pct}%</span>
                  </div>
                  <Progress value={s.pct / 100} />
                </div>
              ))}
            </div>
          </div>
        )}
        {(attempts?.length ?? 0) > 0 && (
          <div className="card p-5">
            <h3 className="font-display font-bold mb-2">היסטוריה</h3>
            <ul className="divide-y divide-line text-sm">
              {attempts!.slice(0, 8).map((a) => (
                <li key={a.id} className="py-2 flex justify-between gap-2">
                  <span className="text-muted">{formatDate(a.created_at)} · {a.kind === "exam" ? "סימולציה" : a.kind === "mistakes" ? "טעויות" : "מבחן שיעור"} · {a.questions.length} שאלות</span>
                  <span className="font-semibold tabular-nums">{a.score}%</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}

/* ---------------- Chat ---------------- */

function CourseChat({ course }: { course: Course }) {
  const { data: digest, isLoading } = useDigest(course.id);
  if (isLoading) return <PageLoader />;
  if (!digest?.length) return <EmptyState icon="💬" title="הצ'אט יתעורר אחרי השיעור המסוכם הראשון" />;
  return (
    <ChatPanel
      storageKey={`chat:course:${course.id}`}
      courseName={course.name}
      buildContext={async () => courseDigestText(digest)}
      intro={`שאל כל שאלה על החומר של ${course.name}. התשובות מבוססות על הסיכומים של כל ${digest.length} השיעורים, עם הפניה לשיעור ולזמן.`}
      suggestions={["מה הנושאים הכי חשובים למבחן?", "תסביר לי את הקשר בין הנושאים", "בחן אותי בשאלה פתוחה", "סכם לי את הקורס בעמוד אחד"]}
    />
  );
}

/* ---------------- Study plan ---------------- */

function PlanTab({ course }: { course: Course }) {
  const toast = useToast();
  const { data: digest } = useDigest(course.id);
  const { data: attempts } = useAttempts(course.id);
  const { data: cards } = useFlashcards(course.id);
  const [examDate, setExamDate] = useState(course.exam_date ?? "");
  const [hours, setHours] = useState(2);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set(course.study_plan_done));
  const plan = course.study_plan;
  const today = todayISO();

  useEffect(() => setDone(new Set(course.study_plan_done)), [course.study_plan_done]);

  async function generate() {
    if (!examDate) return toast("בחר תאריך מבחן", "error");
    if (examDate < today) return toast("תאריך המבחן כבר עבר", "error");
    setBusy(true);
    try {
      if (examDate !== course.exam_date) await updateCourse(course.id, { exam_date: examDate });
      const r = await runTaskWithRetry("study-plan", {
        courseName: course.name,
        today,
        examDate,
        hoursPerDay: hours,
        lessons: courseDigestText(digest ?? [], { full: false }) || "(עוד אין שיעורים מסוכמים)",
        weakTopics: weakTopics(topicStats(attempts ?? [])),
        dueCards: (cards ?? []).filter(isDue).length,
      });
      await updateCourse(course.id, {
        study_plan: {
          generatedAt: new Date().toISOString(),
          examDate,
          tips: r.tips,
          days: r.days.map((d) => ({ ...d, tasks: d.tasks.map((t, i) => ({ ...t, id: `${d.date}:${i}` })) })),
        },
        study_plan_done: [],
      });
      toast("תוכנית הלימוד מוכנה 🗓️", "success");
    } catch (e) {
      toast(`יצירת התוכנית נכשלה: ${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(taskId: string) {
    const next = new Set(done);
    if (next.has(taskId)) next.delete(taskId);
    else next.add(taskId);
    setDone(next);
    await updateCourse(course.id, { study_plan_done: [...next] }).catch(() => toast("השמירה נכשלה", "error"));
  }

  const totalTasks = plan?.days.reduce((s, d) => s + d.tasks.length, 0) ?? 0;
  const KIND_ICON: Record<string, string> = { review: "📖", flashcards: "🃏", quiz: "✅", exam: "🎯", read: "📓", rest: "🌿" };

  return (
    <div className="space-y-4">
      <div className="card p-5 sm:p-6 space-y-4">
        <h2 className="font-display text-xl font-bold">🗓️ תוכנית לימוד עד המבחן</h2>
        <div className="grid sm:grid-cols-3 gap-3 items-end">
          <div>
            <label className="label" htmlFor="plan-date">תאריך המבחן</label>
            <input id="plan-date" type="date" className="input" min={today} value={examDate} onChange={(e) => setExamDate(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="plan-hours">שעות לימוד ביום</label>
            <select id="plan-hours" className="select" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
              {[0.5, 1, 1.5, 2, 3, 4, 5, 6].map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" onClick={generate} disabled={busy || !examDate}>
            {busy ? <Spinner className="w-4 h-4" /> : "✨"} {plan ? "בנה תוכנית מחדש" : "בנה לי תוכנית"}
          </button>
        </div>
        <p className="hint">התוכנית מתחשבת בנושאים של כל השיעורים, בנושאים החלשים לפי המבחנים, ובכרטיסיות שממתינות לחזרה.</p>
      </div>

      {plan ? (
        <>
          <div className="card p-4 flex items-center gap-4">
            <div className="flex-1"><Progress value={totalTasks ? done.size / totalTasks : 0} /></div>
            <span className="text-sm text-muted tabular-nums">{done.size}/{totalTasks} משימות</span>
          </div>
          {plan.tips.length > 0 && (
            <div className="rounded-xl bg-gold-soft p-4 text-sm space-y-1">
              {plan.tips.map((t, i) => <p key={i}>💡 {t}</p>)}
            </div>
          )}
          <ol className="space-y-3">
            {plan.days.map((d) => {
              const isToday = d.date === today;
              const past = d.date < today;
              return (
                <li key={d.date} className={`card p-4 sm:p-5 ${isToday ? "ring-2 ring-royal" : ""} ${past ? "opacity-70" : ""}`}>
                  <div className="flex items-baseline justify-between gap-2 mb-2">
                    <h3 className="font-semibold">
                      {new Date(d.date + "T00:00:00").toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "short" })}
                      {isToday && <span className="chip bg-royal text-white ms-2">היום</span>}
                    </h3>
                    <span className="text-sm text-muted">{d.focus}</span>
                  </div>
                  <ul className="space-y-1.5">
                    {d.tasks.map((t) => (
                      <li key={t.id}>
                        <label className="flex items-start gap-3 cursor-pointer rounded-lg px-2 py-1.5 hover:bg-royal-soft/40">
                          <input type="checkbox" className="accent-[var(--royal)] w-4 h-4 mt-1" checked={done.has(t.id)} onChange={() => toggle(t.id)} />
                          <span className={done.has(t.id) ? "line-through text-muted" : ""}>
                            <span aria-hidden>{KIND_ICON[t.kind] ?? "•"} </span>
                            <b className="font-semibold">{t.title}</b>
                            {t.detail && <span className="block text-sm text-muted">{t.detail}</span>}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        <EmptyState icon="🗓️" title="עוד אין תוכנית" text="בחר תאריך מבחן ושעות ביום, ותקבל תוכנית יומית מותאמת." />
      )}
    </div>
  );
}

/* ---------------- Settings ---------------- */

function SettingsTab({ course }: { course: Course }) {
  const router = useRouter();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="card p-5 sm:p-6 lg:col-span-2">
        <h2 className="font-display text-xl font-bold mb-4">פרטי הקורס</h2>
        <CourseForm course={course} onDone={() => toast("נשמר ✓", "success")} />
      </section>
      <section className="card p-5 sm:p-6 space-y-3 border-rose-200 self-start">
        <h2 className="font-display text-lg font-bold text-danger">אזור מסוכן</h2>
        <p className="text-sm text-muted">מחיקת הקורס מוחקת את כל השיעורים, הסיכומים, המבחנים והכרטיסיות שלו.</p>
        <button className="btn btn-danger" onClick={() => setConfirm(true)}>מחיקת הקורס</button>
      </section>
      <Modal open={confirm} onClose={() => setConfirm(false)} title={`למחוק את "${course.name}"?`}>
        <p className="text-muted mb-5">הפעולה סופית ואי אפשר לשחזר.</p>
        <div className="flex gap-2">
          <button
            className="btn btn-danger"
            onClick={async () => {
              await deleteCourse(course.id);
              router.push("/");
            }}
          >
            כן, למחוק
          </button>
          <button className="btn btn-ghost" onClick={() => setConfirm(false)}>ביטול</button>
        </div>
      </Modal>
    </div>
  );
}
