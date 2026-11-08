"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers";
import { CourseModal } from "@/components/course-form";
import { EmptyState, PageLoader, Progress, Stat, StatusBadge } from "@/components/ui";
import { PROCESSING, useCourses, useFlashcards, useLessons } from "@/lib/data";
import { isDue } from "@/lib/study";
import { daysUntil, formatDate, greeting } from "@/lib/format";

export default function Dashboard() {
  const { displayName } = useAuth();
  const router = useRouter();
  const { data: courses, isLoading } = useCourses();
  const { data: lessons } = useLessons();
  const { data: cards } = useFlashcards();
  const [newCourse, setNewCourse] = useState(false);

  if (isLoading || !courses) return <PageLoader />;

  const hours = (lessons ?? []).reduce((s, l) => s + l.duration_sec, 0) / 3600;
  const due = (cards ?? []).filter(isDue);
  const ready = (lessons ?? []).filter((l) => l.status === "ready").length;
  const active = (lessons ?? []).filter((l) => PROCESSING.includes(l.status) || l.status === "error").reverse();
  const exams = courses
    .filter((c) => c.exam_date && daysUntil(c.exam_date) >= 0)
    .sort((a, b) => a.exam_date!.localeCompare(b.exam_date!));
  const courseName = (id: string) => courses.find((c) => c.id === id)?.name ?? "";

  return (
    <div className="space-y-8">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-muted">{greeting()},</p>
          <h1 className="font-display text-3xl sm:text-4xl font-bold">
            {displayName || "ברוכים הבאים"} <span aria-hidden>👑</span>
          </h1>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost" onClick={() => setNewCourse(true)}>＋ קורס חדש</button>
          <Link href="/record" className="btn btn-record">🎙️ הקלטת שיעור</Link>
        </div>
      </header>

      {courses.length === 0 ? (
        <EmptyState
          icon="🏰"
          title="הממלכה שלך מחכה לקורס הראשון"
          text="צור קורס, הקלט את השיעור הבא, ובסופו יחכו לך תמלול, סיכום, מבחן וכרטיסיות."
          action={<button className="btn btn-gold btn-lg mt-2" onClick={() => setNewCourse(true)}>יצירת קורס ראשון</button>}
        />
      ) : (
        <>
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label="סיכום מצב">
            <Stat icon="📚" label="קורסים" value={courses.length} />
            <Stat icon="⏱️" label="שעות שהוקלטו" value={hours < 10 ? hours.toFixed(1) : Math.round(hours)} />
            <Stat icon="📝" label="שיעורים מסוכמים" value={ready} />
            <Link href="/review" className="contents">
              <Stat icon="🃏" label="כרטיסיות לחזרה היום" value={due.length} tone="gold" />
            </Link>
          </section>

          {active.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-display text-xl font-bold">בעבודה עכשיו</h2>
              <div className="grid gap-3 md:grid-cols-2">
                {active.map((l) => (
                  <Link key={l.id} href={`/lesson/${l.id}`} className="card p-4 hover:-translate-y-0.5 transition space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold truncate">{l.title}</span>
                      <StatusBadge status={l.status} />
                    </div>
                    <div className="text-xs text-muted">{courseName(l.course_id)}</div>
                    {l.status !== "error" && <Progress indeterminate />}
                    {l.status === "error" && <p className="text-xs text-danger truncate">{l.error}</p>}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {exams.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-display text-xl font-bold">מבחנים קרובים</h2>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {exams.map((c) => {
                  const d = daysUntil(c.exam_date!);
                  const total = c.study_plan?.days.reduce((s, day) => s + day.tasks.length, 0) ?? 0;
                  const done = c.study_plan_done.length;
                  return (
                    <Link key={c.id} href={`/course/${c.id}?tab=plan`} className="card p-4 flex gap-4 items-center hover:-translate-y-0.5 transition">
                      <div className="grid place-items-center w-16 h-16 rounded-2xl bg-gold-soft text-center shrink-0">
                        <span className="text-2xl font-bold leading-none">{d}</span>
                        <span className="text-[11px] text-muted -mt-2">{d === 1 ? "יום" : "ימים"}</span>
                      </div>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="font-semibold truncate">{c.name}</div>
                        <div className="text-xs text-muted">{formatDate(c.exam_date!)}</div>
                        {total > 0 ? (
                          <>
                            <Progress value={done / total} />
                            <div className="text-[11px] text-muted">{done}/{total} משימות בתוכנית</div>
                          </>
                        ) : (
                          <div className="text-xs text-royal font-medium">בנה תוכנית לימוד ←</div>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-bold">הקורסים שלי</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {courses.map((c) => {
                const ls = lessons?.filter((l) => l.course_id === c.id) ?? [];
                const cDue = due.filter((x) => x.course_id === c.id).length;
                const d = c.exam_date ? daysUntil(c.exam_date) : null;
                return (
                  <Link key={c.id} href={`/course/${c.id}`} className="card p-5 relative overflow-hidden hover:-translate-y-0.5 hover:shadow-lg transition group">
                    <span className="absolute inset-y-0 right-0 w-1.5" style={{ background: c.color }} />
                    <h3 className="font-display text-lg font-bold group-hover:text-royal transition">{c.name}</h3>
                    <p className="text-sm text-muted mt-1">
                      {ls.length} שיעורים · {ls.filter((l) => l.status === "ready").length} מסוכמים
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {cDue > 0 && <span className="chip bg-gold-soft text-ink">🃏 {cDue} לחזרה</span>}
                      {d !== null && d >= 0 && <span className="chip bg-royal-soft text-royal">📅 מבחן בעוד {d} ימים</span>}
                      {c.notebook && <span className="chip bg-royal-soft text-royal">📓 מחברת</span>}
                    </div>
                  </Link>
                );
              })}
              <button onClick={() => setNewCourse(true)} className="card-flat border-dashed p-5 text-muted hover:text-royal hover:border-royal transition grid place-items-center min-h-28">
                ＋ קורס חדש
              </button>
            </div>
          </section>
        </>
      )}

      <CourseModal open={newCourse} onClose={() => setNewCourse(false)} onDone={(c) => router.push(`/course/${c.id}`)} />
    </div>
  );
}
