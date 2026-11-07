"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Lesson } from "@/lib/db";
import type { Notebook } from "@/lib/schemas";
import { pipeline } from "@/lib/pipeline";
import { formatDate } from "@/lib/format";
import Markdown from "@/components/Markdown";
import SummaryView from "@/components/SummaryView";

export default function NotebookPage() {
  const { id } = useParams<{ id: string }>();
  const course = useLiveQuery(() => db.courses.get(id), [id]);
  const lessons = useLiveQuery(() => db.lessons.where("courseId").equals(id).sortBy("createdAt"), [id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"merged" | "lessons">("merged");

  if (course === undefined || lessons === undefined) return <p className="text-muted">טוען…</p>;
  if (course === null) return <p>הקורס לא נמצא.</p>;

  const summarized = lessons.filter((l) => l.summary);
  const nb = course.notebook;
  const missing = summarized.filter((l) => !nb?.lessonIds.includes(l.id)).length;

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      await pipeline.buildCourseNotebook(id);
      setView("merged");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function downloadMarkdown() {
    const md = toMarkdown(course!.name, nb?.data, summarized);
    const url = URL.createObjectURL(new Blob([md], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${course!.name}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm text-muted no-print">
        <Link href="/" className="hover:underline">הקורסים שלי</Link>
        <span>›</span>
        <Link href={`/course/${id}`} className="hover:underline">{course.name}</Link>
        <span>›</span>
        <span>מחברת</span>
      </div>

      <header className="card p-6 relative overflow-hidden">
        <div className="absolute inset-y-0 right-0 w-2" style={{ background: course.color }} />
        <p className="text-sm text-muted">📓 מחברת קורס</p>
        <h1 className="text-3xl font-extrabold mt-1">{nb?.data.title || course.name}</h1>
        <p className="text-sm text-muted mt-2">
          {summarized.length} שיעורים מסוכמים
          {nb && ` · המחברת המאוחדת עודכנה ${formatDate(nb.updatedAt)}`}
        </p>
        <div className="flex flex-wrap gap-2 mt-4 no-print">
          <button className="btn btn-primary" onClick={generate} disabled={busy || !summarized.length}>
            {busy ? "⏳ בונה מחברת…" : nb ? "🔄 עדכון המחברת המאוחדת" : "✨ יצירת מחברת מאוחדת"}
          </button>
          <button className="btn btn-ghost" onClick={() => window.print()}>🖨️ הדפסה / PDF</button>
          <button className="btn btn-ghost" onClick={downloadMarkdown}>⬇️ Markdown</button>
        </div>
        {nb && missing > 0 && !busy && (
          <p className="text-sm mt-3 text-amber-700 dark:text-amber-400">
            נוספו {missing} שיעורים מאז העדכון האחרון. לחץ על &quot;עדכון&quot; כדי לשלב אותם.
          </p>
        )}
        {busy && <p className="text-sm text-muted mt-3">Claude מאחד את כל השיעורים לפי נושאים. זה עשוי לקחת דקה או שתיים.</p>}
        {error && <p className="text-sm text-rose-600 mt-3">{error}</p>}
      </header>

      <nav className="flex gap-1 p-1 card no-print">
        {(
          [
            ["merged", "מחברת מאוחדת לפי נושאים"],
            ["lessons", "סיכומים לפי שיעור"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`flex-1 px-3 py-2 rounded-lg font-semibold text-sm transition ${
              view === v ? "bg-brand-600 text-white" : "hover:bg-[color-mix(in_srgb,var(--text)_6%,transparent)]"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {view === "merged" &&
        (nb ? (
          <MergedNotebook data={nb.data} />
        ) : (
          <div className="card p-8 text-center space-y-2">
            <div className="text-4xl">✨</div>
            <p className="font-semibold">עוד לא נוצרה מחברת מאוחדת</p>
            <p className="text-muted text-sm">
              המחברת המאוחדת מארגנת את כל החומר לפי נושאים, עם מילון מושגים ודף הכנה למבחן.
            </p>
          </div>
        ))}

      {view === "lessons" && (
        <div className="space-y-8">
          {summarized.map((l, i) => (
            <section key={l.id} className={i ? "print-break" : ""}>
              <h2 className="text-2xl font-extrabold mb-3">
                <span className="text-muted">שיעור {i + 1} · </span>
                <Link href={`/lesson/${l.id}`} className="hover:underline">{l.title}</Link>
              </h2>
              <SummaryView summary={l.summary!} />
            </section>
          ))}
          {!summarized.length && <p className="text-muted">אין עדיין שיעורים מסוכמים.</p>}
        </div>
      )}
    </div>
  );
}

function MergedNotebook({ data }: { data: Notebook }) {
  return (
    <article className="space-y-5">
      <nav className="card p-5 no-print">
        <h2 className="font-bold mb-2">תוכן עניינים</h2>
        <ol className="list-decimal ps-5 space-y-1">
          {data.chapters.map((c, i) => (
            <li key={i}><a href={`#ch-${i}`} className="text-brand-600 hover:underline">{c.title}</a></li>
          ))}
          <li><a href="#glossary" className="text-brand-600 hover:underline">מילון מושגים</a></li>
          <li><a href="#exam" className="text-brand-600 hover:underline">הכנה למבחן</a></li>
        </ol>
      </nav>
      <section className="card p-5"><Markdown>{data.introduction}</Markdown></section>
      {data.chapters.map((c, i) => (
        <section key={i} id={`ch-${i}`} className="card p-5 scroll-mt-20 print-break">
          <h2 className="text-2xl font-extrabold mb-3">
            <span className="text-muted">פרק {i + 1}: </span>{c.title}
          </h2>
          <Markdown>{c.content}</Markdown>
        </section>
      ))}
      <section id="glossary" className="card p-5 scroll-mt-20 print-break">
        <h2 className="text-2xl font-extrabold mb-3">📚 מילון מושגים</h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          {data.glossary.map((g, i) => (
            <div key={i} className="rounded-xl border border-soft p-3">
              <dt className="font-bold">{g.term}</dt>
              <dd className="text-sm text-muted mt-1">{g.definition}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section id="exam" className="card p-5 scroll-mt-20 print-break">
        <h2 className="text-2xl font-extrabold mb-3">🎯 הכנה למבחן</h2>
        <Markdown>{data.examPrep}</Markdown>
      </section>
    </article>
  );
}

function toMarkdown(courseName: string, nb: Notebook | undefined, lessons: Lesson[]) {
  const out: string[] = [`# ${nb?.title || courseName}`, ""];
  if (nb) {
    out.push(nb.introduction, "");
    nb.chapters.forEach((c, i) => out.push(`## פרק ${i + 1}: ${c.title}`, "", c.content, ""));
    out.push("## מילון מושגים", "", ...nb.glossary.map((g) => `- **${g.term}** — ${g.definition}`), "");
    out.push("## הכנה למבחן", "", nb.examPrep, "");
  }
  out.push("---", "", "# סיכומים לפי שיעור", "");
  lessons.forEach((l, i) => {
    const s = l.summary!;
    out.push(`## שיעור ${i + 1}: ${l.title}`, "", s.overview, "");
    s.sections.forEach((sec) => out.push(`### ${sec.heading}`, "", sec.content, ""));
    if (s.takeaways.length) out.push("### הכי חשוב לזכור", "", ...s.takeaways.map((t) => `- ${t}`), "");
    if (s.keyTerms.length) out.push("### מושגי מפתח", "", ...s.keyTerms.map((k) => `- **${k.term}** — ${k.definition}`), "");
  });
  return out.join("\n");
}
