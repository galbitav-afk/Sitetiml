"use client";

import Markdown from "./Markdown";
import type { LessonSummary } from "@/lib/schemas";

export default function SummaryView({ summary }: { summary: LessonSummary }) {
  return (
    <article className="space-y-5">
      <div className="card p-5 bg-brand-50/60 dark:bg-brand-700/10">
        <h2 className="font-bold mb-1">בקצרה</h2>
        <p className="leading-relaxed">{summary.overview}</p>
      </div>

      {summary.sections.length > 1 && (
        <nav className="card p-4 no-print">
          <h2 className="font-bold mb-2 text-sm text-muted">נושאי השיעור</h2>
          <ol className="list-decimal ps-5 space-y-1">
            {summary.sections.map((s, i) => (
              <li key={i}>
                <a href={`#sec-${i}`} className="hover:underline text-brand-600">{s.heading}</a>
              </li>
            ))}
          </ol>
        </nav>
      )}

      {summary.sections.map((s, i) => (
        <section key={i} id={`sec-${i}`} className="card p-5 scroll-mt-20">
          <h2 className="text-xl font-bold mb-3">{s.heading}</h2>
          <Markdown>{s.content}</Markdown>
        </section>
      ))}

      {summary.takeaways.length > 0 && (
        <section className="card p-5">
          <h2 className="text-xl font-bold mb-3">🎯 הכי חשוב לזכור</h2>
          <ul className="space-y-2">
            {summary.takeaways.map((t, i) => (
              <li key={i} className="flex gap-2"><span>✔️</span><span>{t}</span></li>
            ))}
          </ul>
        </section>
      )}

      {summary.keyTerms.length > 0 && (
        <section className="card p-5">
          <h2 className="text-xl font-bold mb-3">📚 מושגי מפתח</h2>
          <dl className="grid gap-3 sm:grid-cols-2">
            {summary.keyTerms.map((k, i) => (
              <div key={i} className="rounded-xl border border-soft p-3">
                <dt className="font-bold">{k.term}</dt>
                <dd className="text-sm text-muted mt-1">{k.definition}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {summary.openQuestions.length > 0 && (
        <section className="card p-5">
          <h2 className="text-xl font-bold mb-3">❓ לבירור / משימות</h2>
          <ul className="list-disc ps-5 space-y-1">
            {summary.openQuestions.map((q, i) => <li key={i}>{q}</li>)}
          </ul>
        </section>
      )}
    </article>
  );
}
