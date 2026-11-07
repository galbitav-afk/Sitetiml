"use client";

import { useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid, COURSE_COLORS } from "@/lib/db";

export default function Home() {
  const courses = useLiveQuery(() => db.courses.orderBy("createdAt").reverse().toArray());
  const lessons = useLiveQuery(() => db.lessons.toArray());
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [vocab, setVocab] = useState("");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const count = courses?.length ?? 0;
    await db.courses.add({
      id: uid(),
      name: name.trim(),
      vocabulary: vocab.trim(),
      color: COURSE_COLORS[count % COURSE_COLORS.length],
      createdAt: Date.now(),
    });
    setName("");
    setVocab("");
    setCreating(false);
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold">הקורסים שלי</h1>
          <p className="text-muted mt-1">
            מקליטים שיעור, והמערכת מתמללת, מסכמת, יוצרת מבחן ובונה מחברת לכל קורס.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating((v) => !v)}>
          ＋ קורס חדש
        </button>
      </section>

      {creating && (
        <form onSubmit={create} className="card p-4 sm:p-5 space-y-3">
          <div>
            <label className="text-sm font-semibold">שם הקורס</label>
            <input
              className="input mt-1"
              autoFocus
              placeholder="לדוגמה: מבוא לכלכלה"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm font-semibold">מונחים נפוצים בקורס (לא חובה)</label>
            <input
              className="input mt-1"
              placeholder="לדוגמה: גמישות, עקומת ביקוש, Elasticity, תמ״ג"
              value={vocab}
              onChange={(e) => setVocab(e.target.value)}
            />
            <p className="text-xs text-muted mt-1">משפר את דיוק התמלול של מונחים מקצועיים ושמות.</p>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-primary" type="submit" disabled={!name.trim()}>
              יצירה
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setCreating(false)}>
              ביטול
            </button>
          </div>
        </form>
      )}

      {courses && courses.length === 0 && !creating && (
        <div className="card p-8 text-center space-y-3">
          <div className="text-5xl">🎓</div>
          <h2 className="text-xl font-bold">עוד אין קורסים</h2>
          <p className="text-muted">צור קורס ראשון ואז הקלט את השיעור הבא שלך.</p>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            יצירת קורס ראשון
          </button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {courses?.map((c) => {
          const ls = lessons?.filter((l) => l.courseId === c.id) ?? [];
          const ready = ls.filter((l) => l.status === "ready").length;
          const busy = ls.filter((l) => l.status === "transcribing" || l.status === "summarizing").length;
          return (
            <Link
              key={c.id}
              href={`/course/${c.id}`}
              className="card p-5 hover:shadow-lg hover:-translate-y-0.5 transition block overflow-hidden relative"
            >
              <div className="absolute inset-y-0 right-0 w-1.5" style={{ background: c.color }} />
              <h2 className="text-lg font-bold">{c.name}</h2>
              <p className="text-sm text-muted mt-1">
                {ls.length} שיעורים · {ready} מסוכמים
                {busy ? ` · ${busy} בעיבוד` : ""}
              </p>
              {c.notebook && <p className="text-xs mt-3 text-brand-600 font-semibold">📓 יש מחברת קורס</p>}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
