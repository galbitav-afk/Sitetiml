"use client";

import { useState } from "react";
import type { Bookmark, Segment } from "@/lib/types";
import { formatClock } from "@/lib/format";
import type { LessonAudio } from "./lesson-audio";
import { EmptyState } from "./ui";

export default function TranscriptView(props: { segments: Segment[]; bookmarks: Bookmark[]; audio: LessonAudio; title: string }) {
  const { segments, bookmarks, audio } = props;
  const [query, setQuery] = useState("");
  const q = query.trim();
  const visible = q ? segments.filter((s) => s.text.includes(q)) : segments;

  function download() {
    const text = segments.map((s) => `[${formatClock(s.start_sec)}] ${s.silent ? "(שקט)" : s.text}`).join("\n\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${props.title} - תמלול.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!segments.length) return <EmptyState icon="🗒️" title="עוד אין תמלול" text="התמלול מתמלא כל כמה דקות במהלך ההקלטה." />;

  return (
    <div className="space-y-3">
      <div className="flex gap-2 no-print">
        <input className="input" placeholder="🔍 חיפוש בתמלול" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn btn-ghost shrink-0" onClick={download}>⬇️ הורדה</button>
      </div>
      {!audio.available && (
        <p className="text-xs text-muted">אין כאן השמעה: ההקלטה שמורה רק במחשב שבו הוקלטה (גיבוי הקלטות לענן כבוי או עדיין לא הסתיים). התמלול זמין בכל מכשיר.</p>
      )}
      <div className="card divide-y divide-line">
        {visible.map((s) => {
          const marks = bookmarks.filter((b) => b.t >= s.start_sec && b.t < s.start_sec + s.duration_sec);
          return (
            <div key={s.id} className="p-4 flex gap-3">
              {audio.available ? (
                <button onClick={() => audio.playAt(s.start_sec)} className="shrink-0 h-8 px-2 rounded-lg bg-royal-soft text-royal text-xs font-semibold ltr hover:bg-royal hover:text-white transition" title="השמעה מכאן">
                  ▶ {formatClock(s.start_sec)}
                </button>
              ) : (
                <span className="shrink-0 h-8 px-2 grid place-items-center text-xs text-muted ltr">{formatClock(s.start_sec)}</span>
              )}
              <div className="min-w-0 space-y-1.5">
                {marks.map((m, i) => (
                  <div key={i} className="chip bg-gold-soft text-ink">⭐ <span className="ltr">{formatClock(m.t)}</span> {m.note}</div>
                ))}
                <p className="leading-relaxed whitespace-pre-wrap">
                  {s.silent ? <span className="text-muted italic">(שקט / הפסקה)</span> : highlight(s.text, q)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      {q && !visible.length && <p className="text-muted">לא נמצאו תוצאות.</p>}
    </div>
  );
}

function highlight(text: string, q: string) {
  if (!q) return text;
  return text.split(q).flatMap((p, i) => (i === 0 ? [p] : [<mark key={i} className="bg-gold/40 rounded px-0.5">{q}</mark>, p]));
}
