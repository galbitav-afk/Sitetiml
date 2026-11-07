"use client";

import { useEffect, useRef, useState } from "react";
import type { Chunk } from "@/lib/db";
import { formatClock } from "@/lib/format";

/** Full transcript; each segment has a play button for its original audio. */
export default function TranscriptView({ chunks, bookmarks }: { chunks: Chunk[]; bookmarks: number[] }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  function play(c: Chunk) {
    const a = audioRef.current;
    if (!a) return;
    if (playing === c.id) {
      a.pause();
      setPlaying(null);
      return;
    }
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = URL.createObjectURL(c.blob);
    a.src = urlRef.current;
    void a.play();
    setPlaying(c.id);
  }

  function download() {
    const text = chunks.map((c) => `[${formatClock(c.startSec)}] ${c.text ?? ""}`).join("\n\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "transcript.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  const q = query.trim();
  const visible = q ? chunks.filter((c) => c.text?.includes(q)) : chunks;

  return (
    <div className="space-y-3">
      <div className="flex gap-2 no-print">
        <input className="input" placeholder="🔍 חיפוש בתמלול" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn btn-ghost" onClick={download}>⬇️ הורדה</button>
      </div>
      <audio ref={audioRef} onEnded={() => setPlaying(null)} className="hidden" />
      {visible.map((c) => {
        const marks = bookmarks.filter((b) => b >= c.startSec && b < c.startSec + c.durationSec);
        return (
          <div key={c.id} className="card p-4 flex gap-3">
            <button
              onClick={() => play(c)}
              className="shrink-0 w-10 h-10 rounded-full border border-soft grid place-items-center hover:bg-brand-50 dark:hover:bg-brand-700/20"
              aria-label="השמעת הקטע"
            >
              {playing === c.id ? "⏸" : "▶"}
            </button>
            <div className="min-w-0">
              <div className="text-xs text-muted mb-1 flex gap-2 flex-wrap" dir="ltr">
                <span>{formatClock(c.startSec)}–{formatClock(c.startSec + c.durationSec)}</span>
                {marks.map((m) => <span key={m} className="text-amber-600">⭐ {formatClock(m)}</span>)}
              </div>
              {c.status === "done" ? (
                <p className="leading-relaxed whitespace-pre-wrap">{highlight(c.text ?? "", q)}</p>
              ) : c.status === "error" ? (
                <p className="text-rose-600 text-sm">התמלול נכשל: {c.error}</p>
              ) : (
                <p className="text-muted text-sm">ממתין לתמלול…</p>
              )}
            </div>
          </div>
        );
      })}
      {q && !visible.length && <p className="text-muted">לא נמצאו תוצאות.</p>}
    </div>
  );
}

function highlight(text: string, q: string) {
  if (!q) return text;
  const parts = text.split(q);
  return parts.flatMap((p, i) =>
    i === 0 ? [p] : [<mark key={i} className="bg-amber-200 dark:bg-amber-700 rounded px-0.5">{q}</mark>, p],
  );
}
