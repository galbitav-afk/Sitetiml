"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { searchAll, useCourses } from "@/lib/data";
import { formatClock, snippet } from "@/lib/format";
import { EmptyState, PageLoader, Spinner } from "@/components/ui";

export default function SearchPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Search />
    </Suspense>
  );
}

function Search() {
  const params = useSearchParams();
  const router = useRouter();
  const [input, setInput] = useState(params.get("q") ?? "");
  const [q, setQ] = useState(params.get("q") ?? "");
  const { data: courses } = useCourses();

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(input.trim());
      router.replace(input.trim() ? `/search?q=${encodeURIComponent(input.trim())}` : "/search", { scroll: false });
    }, 350);
    return () => clearTimeout(t);
  }, [input, router]);

  const { data: hits, isFetching } = useQuery({
    queryKey: ["search", q],
    queryFn: () => searchAll(q),
    enabled: q.length >= 2,
  });
  const course = (id: string) => courses?.find((c) => c.id === id);

  // Group by lesson: one card per lesson with its matches.
  const groups = new Map<string, NonNullable<typeof hits>>();
  for (const h of hits ?? []) groups.set(h.lesson_id, [...(groups.get(h.lesson_id) ?? []), h]);

  return (
    <div className="space-y-5 max-w-3xl">
      <h1 className="font-display text-3xl font-bold">חיפוש בממלכה</h1>
      <div className="relative">
        <input
          className="input text-lg ps-11 min-h-14"
          autoFocus
          placeholder="מושג, נושא, או משפט שהמרצה אמר…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label="חיפוש"
        />
        <span className="absolute top-1/2 -translate-y-1/2 start-4 text-muted" aria-hidden>
          {isFetching ? <Spinner className="w-5 h-5" /> : "🔍"}
        </span>
      </div>

      {q.length < 2 ? (
        <p className="text-muted">החיפוש עובר על כל הסיכומים והתמלולים בכל הקורסים שלך.</p>
      ) : hits && !hits.length ? (
        <EmptyState icon="🔎" title="לא נמצאו תוצאות" text="נסה מילה אחרת או חלק ממנה." />
      ) : (
        <div className="space-y-3">
          {[...groups.entries()].map(([lessonId, list]) => {
            const first = list[0];
            const c = course(first.course_id);
            return (
              <div key={lessonId} className="card p-4 space-y-2">
                <Link href={`/lesson/${lessonId}`} className="flex items-center gap-2 font-semibold hover:text-royal">
                  {c && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color }} />}
                  {first.lesson_title}
                  <span className="text-xs text-muted font-normal">· {c?.name}</span>
                </Link>
                {list.slice(0, 4).map((h, i) => (
                  <Link
                    key={i}
                    href={`/lesson/${lessonId}?tab=${h.kind === "segment" ? "transcript" : "summary"}`}
                    className="block rounded-lg px-3 py-2 text-sm hover:bg-royal-soft/50"
                  >
                    <span className="chip bg-royal-soft text-royal me-2">
                      {h.kind === "segment" ? <>תמלול <span className="ltr">{formatClock(h.start_sec ?? 0)}</span></> : "סיכום"}
                    </span>
                    <Highlighted text={snippet(h.kind === "summary" ? stripJson(h.body) : h.body, q)} q={q} />
                  </Link>
                ))}
                {list.length > 4 && <p className="text-xs text-muted px-3">ועוד {list.length - 4} התאמות</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Summary rows come back as JSON text: make them readable for snippets. */
function stripJson(s: string) {
  return s.replace(/"(title|overview|heading|content|term|definition|startSec)":/g, " ").replace(/[{}[\]"\\]/g, " ").replace(/\s+/g, " ");
}

function Highlighted({ text, q }: { text: string; q: string }) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-gold/40 rounded px-0.5">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}
