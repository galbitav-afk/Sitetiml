"use client";

import { useEffect, useState } from "react";
import { queryClient, updateFlashcard } from "@/lib/data";
import { reviewCard } from "@/lib/study";
import type { Flashcard } from "@/lib/types";
import Markdown from "./markdown";
import { textDir } from "@/lib/format";
import { EmptyState, Progress, useToast } from "./ui";

/** Spaced-repetition review session. Space = flip, ← knew it, → again. */
export default function FlashcardDeck({ cards, emptyText }: { cards: Flashcard[]; emptyText?: string }) {
  // Frozen for the session (background refetches must not reset progress); remount to restart.
  const [initial] = useState(() => [...cards].sort((a, b) => a.due_at.localeCompare(b.due_at)));
  const [queue, setQueue] = useState<Flashcard[]>(initial);
  const [flipped, setFlipped] = useState(false);
  const [stats, setStats] = useState({ knew: 0, again: 0 });
  const toast = useToast();
  const total = initial.length;
  const card = queue[0];

  async function answer(knew: boolean) {
    if (!card) return;
    const next = reviewCard(card, knew);
    setFlipped(false);
    setStats((s) => (knew ? { ...s, knew: s.knew + 1 } : { ...s, again: s.again + 1 }));
    // A missed card comes back at the end of this session.
    setQueue((q) => (knew ? q.slice(1) : [...q.slice(1), { ...card, ...next }]));
    try {
      await updateFlashcard(card.id, { ...next, reviews: card.reviews + 1 });
    } catch {
      toast("שמירת ההתקדמות נכשלה", "error");
    }
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!card || (e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (e.key === " ") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (flipped && e.key === "ArrowLeft") void answer(true);
      else if (flipped && e.key === "ArrowRight") void answer(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  // When the session ends, refresh counts elsewhere (dashboard, sidebar).
  useEffect(() => {
    if (total && !card) void queryClient.invalidateQueries({ queryKey: ["flashcards"] });
  }, [card, total]);

  if (!total) return <EmptyState icon="🃏" title="אין כרטיסיות לחזרה כרגע" text={emptyText ?? "כרטיסיות נוצרות אוטומטית בסוף כל שיעור."} />;

  if (!card)
    return (
      <EmptyState
        icon="🎉"
        title="סיימת את החזרה!"
        text={`ידעת ${stats.knew} כרטיסיות${stats.again ? `, ו-${stats.again} חזרו לסבב נוסף` : ""}. הכרטיסיות יחזרו בדיוק כשצריך לרענן אותן.`}
      />
    );

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center gap-3 text-sm text-muted">
        <div className="flex-1"><Progress value={stats.knew / total} /></div>
        <span className="tabular-nums">{stats.knew}/{total}</span>
      </div>
      <button className="flip w-full block" onClick={() => setFlipped((f) => !f)} aria-label="הפוך כרטיסייה">
        <div className={`flip-inner min-h-72 ${flipped ? "flipped" : ""}`}>
          <div className="flip-face card p-8 grid place-items-center text-center">
            <div>
              <div className="text-xs text-muted mb-3">שאלה · קופסה {card.box}/5</div>
              <div className="text-2xl font-display font-bold leading-relaxed" dir={textDir(card.front)}>{card.front}</div>
              <div className="text-xs text-muted mt-6">לחץ או רווח כדי להפוך</div>
            </div>
          </div>
          <div className="flip-face flip-back card p-8 grid place-items-center text-center bg-gradient-to-b from-royal-soft to-card">
            <div className="w-full">
              <div className="text-xs text-muted mb-3">תשובה</div>
              <Markdown className="text-lg text-center">{card.back}</Markdown>
            </div>
          </div>
        </div>
      </button>
      <div className={`grid grid-cols-2 gap-3 transition ${flipped ? "" : "opacity-40 pointer-events-none"}`}>
        <button className="btn btn-ghost btn-lg" onClick={() => answer(false)}>🔁 עוד לא (→)</button>
        <button className="btn btn-primary btn-lg" onClick={() => answer(true)}>✓ ידעתי (←)</button>
      </div>
    </div>
  );
}
