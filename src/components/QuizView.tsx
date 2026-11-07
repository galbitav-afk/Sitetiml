"use client";

import { useState } from "react";
import { db, type Lesson } from "@/lib/db";
import type { LessonSummary } from "@/lib/schemas";

type Question = LessonSummary["quiz"][number];

export default function QuizView({ lesson, quiz }: { lesson: Lesson; quiz: Question[] }) {
  const [answers, setAnswers] = useState<(number | null)[]>(() => quiz.map(() => null));
  const [submitted, setSubmitted] = useState(false);

  const answered = answers.filter((a) => a !== null).length;
  const correct = answers.filter((a, i) => a === quiz[i].correctIndex).length;
  const score = Math.round((correct / quiz.length) * 100);

  async function submit() {
    setSubmitted(true);
    await db.lessons.update(lesson.id, {
      quizAttempts: [
        ...lesson.quizAttempts,
        { answers: answers.map((a) => a ?? -1), score, at: Date.now() },
      ],
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function reset() {
    setAnswers(quiz.map(() => null));
    setSubmitted(false);
  }

  return (
    <div className="space-y-4">
      {submitted && (
        <div className="card p-5 text-center">
          <div className="text-4xl font-extrabold">{score}%</div>
          <p className="text-muted mt-1">
            {correct} מתוך {quiz.length} תשובות נכונות
            {score >= 85 ? " · מצוין! 🎉" : score >= 60 ? " · כמעט שם 💪" : " · כדאי לחזור על הסיכום 📖"}
          </p>
          <button className="btn btn-ghost mt-3" onClick={reset}>נסה שוב</button>
        </div>
      )}
      {!submitted && lesson.quizAttempts.length > 0 && (
        <p className="text-sm text-muted">
          ניסיונות קודמים: {lesson.quizAttempts.map((a) => `${a.score}%`).join(" · ")}
        </p>
      )}

      {quiz.map((q, qi) => (
        <div key={qi} className="card p-4 sm:p-5">
          <div className="font-semibold mb-3">
            <span className="text-muted me-1">{qi + 1}.</span> {q.question}
          </div>
          <div className="grid gap-2">
            {q.options.map((opt, oi) => {
              const chosen = answers[qi] === oi;
              const isCorrect = oi === q.correctIndex;
              let cls = "border-soft hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)]";
              if (!submitted && chosen) cls = "border-brand-500 bg-brand-50 dark:bg-brand-700/20";
              if (submitted && isCorrect) cls = "border-emerald-500 bg-emerald-50 dark:bg-emerald-950";
              if (submitted && chosen && !isCorrect) cls = "border-rose-500 bg-rose-50 dark:bg-rose-950";
              return (
                <button
                  key={oi}
                  disabled={submitted}
                  onClick={() => setAnswers((a) => a.map((v, i) => (i === qi ? oi : v)))}
                  className={`text-start border rounded-xl px-3 py-2.5 transition ${cls}`}
                >
                  <span className="font-bold me-2 text-muted">{"אבגד"[oi] ?? oi + 1}.</span>
                  <span dir="auto" className="inline-block">{opt}</span>
                  {submitted && isCorrect && " ✓"}
                </button>
              );
            })}
          </div>
          {submitted && (
            <p className="mt-3 text-sm text-muted border-t border-soft pt-3">💡 {q.explanation}</p>
          )}
        </div>
      ))}

      {!submitted && (
        <div className="sticky bottom-4 flex justify-center no-print">
          <button className="btn btn-primary shadow-lg px-6" disabled={answered < quiz.length} onClick={submit}>
            בדיקת תשובות ({answered}/{quiz.length})
          </button>
        </div>
      )}
    </div>
  );
}
