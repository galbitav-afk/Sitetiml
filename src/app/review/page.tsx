"use client";

import { useState } from "react";
import { useCourses, useFlashcards } from "@/lib/data";
import { isDue } from "@/lib/study";
import FlashcardDeck from "@/components/flashcard-deck";
import { PageLoader } from "@/components/ui";

/** Daily review across every course. */
export default function ReviewPage() {
  const { data: cards, isLoading } = useFlashcards();
  const { data: courses } = useCourses();
  const [courseId, setCourseId] = useState<string>("all");
  const [started, setStarted] = useState(0);

  if (isLoading) return <PageLoader />;
  const due = (cards ?? []).filter(isDue).filter((c) => courseId === "all" || c.course_id === courseId);
  const byCourse = (courses ?? [])
    .map((c) => ({ c, n: (cards ?? []).filter((x) => isDue(x) && x.course_id === c.id).length }))
    .filter((x) => x.n);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-3xl font-bold">🃏 חזרה יומית</h1>
        <p className="text-muted mt-1">כמה דקות ביום של חזרה מרווחת שומרות את כל החומר טרי עד המבחן.</p>
      </header>
      {byCourse.length > 1 && !started && (
        <div className="flex flex-wrap gap-2">
          <button className={`btn btn-sm ${courseId === "all" ? "btn-primary" : "btn-ghost"}`} onClick={() => setCourseId("all")}>הכל</button>
          {byCourse.map(({ c, n }) => (
            <button key={c.id} className={`btn btn-sm ${courseId === c.id ? "btn-primary" : "btn-ghost"}`} onClick={() => setCourseId(c.id)}>
              <span className="w-2 h-2 rounded-full" style={{ background: c.color }} /> {c.name} ({n})
            </button>
          ))}
        </div>
      )}
      {started ? (
        <FlashcardDeck key={started} cards={due} />
      ) : (
        <div className="card p-8 text-center space-y-4">
          <div className="text-6xl font-bold tabular-nums">{due.length}</div>
          <p className="text-muted">כרטיסיות מחכות לך היום</p>
          <button className="btn btn-primary btn-lg" disabled={!due.length} onClick={() => setStarted(Date.now())}>
            {due.length ? "▶ בוא נתחיל" : "אין מה לחזור היום 🎉"}
          </button>
        </div>
      )}
    </div>
  );
}
