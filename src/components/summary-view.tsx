"use client";

import Markdown from "./markdown";
import { formatClock } from "@/lib/format";
import type { LessonSummary } from "@/lib/types";

export default function SummaryView(props: {
  summary: LessonSummary;
  idPrefix: string;
  onSeek?: (t: number) => void;
  compact?: boolean;
}) {
  const { summary, idPrefix, onSeek } = props;
  return (
    <article className="space-y-5">
      <div className="card p-5 sm:p-6 bg-gradient-to-l from-royal-soft to-card">
        <h2 className="font-display text-lg font-bold mb-1.5">בקצרה</h2>
        <p className="leading-relaxed">{summary.overview}</p>
      </div>

      {summary.sections.length > 2 && !props.compact && (
        <nav className="card p-5 no-print" aria-label="נושאי השיעור">
          <h2 className="font-display font-bold mb-2">נושאי השיעור</h2>
          <ol className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 list-decimal ps-5 marker:text-muted">
            {summary.sections.map((s, i) => (
              <li key={i}>
                <a href={`#${idPrefix}-sec-${i}`} className="text-royal hover:underline">{s.heading}</a>
                {s.startSec != null && <span className="text-xs text-muted ms-2 ltr">{formatClock(s.startSec)}</span>}
              </li>
            ))}
          </ol>
        </nav>
      )}

      {summary.sections.map((s, i) => (
        <section key={i} id={`${idPrefix}-sec-${i}`} className="card p-5 sm:p-6 scroll-mt-24">
          <div className="flex items-start justify-between gap-3 mb-3">
            <h2 className="font-display text-xl font-bold">{s.heading}</h2>
            {s.startSec != null && (
              onSeek ? (
                <button onClick={() => onSeek(s.startSec!)} className="chip bg-royal-soft text-royal hover:bg-royal hover:text-white transition shrink-0 no-print" title="השמעה מהרגע הזה">
                  ▶ <span className="ltr">{formatClock(s.startSec)}</span>
                </button>
              ) : (
                <span className="chip bg-royal-soft text-royal shrink-0 ltr">{formatClock(s.startSec)}</span>
              )
            )}
          </div>
          <Markdown>{s.content}</Markdown>
        </section>
      ))}

      {summary.takeaways.length > 0 && (
        <section className="card p-5 sm:p-6 border-gold/40 bg-gradient-to-l from-gold-soft to-card">
          <h2 className="font-display text-xl font-bold mb-3">🎯 הכי חשוב לזכור</h2>
          <ul className="space-y-2">
            {summary.takeaways.map((t, i) => (
              <li key={i} className="flex gap-2.5"><span className="text-gold" aria-hidden>◆</span><span>{t}</span></li>
            ))}
          </ul>
        </section>
      )}

      {summary.keyTerms.length > 0 && (
        <section className="card p-5 sm:p-6">
          <h2 className="font-display text-xl font-bold mb-3">📚 מושגי מפתח</h2>
          <dl className="grid gap-3 sm:grid-cols-2">
            {summary.keyTerms.map((k, i) => (
              <div key={i} className="rounded-xl border border-line p-3">
                <dt className="font-bold">{k.term}</dt>
                <dd className="text-sm text-muted mt-1 leading-relaxed">{k.definition}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {summary.openQuestions.length > 0 && (
        <section className="card p-5 sm:p-6">
          <h2 className="font-display text-xl font-bold mb-3">📌 משימות ונקודות פתוחות</h2>
          <ul className="list-disc ps-5 space-y-1.5">
            {summary.openQuestions.map((q, i) => <li key={i}>{q}</li>)}
          </ul>
        </section>
      )}
    </article>
  );
}
