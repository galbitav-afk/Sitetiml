"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid, deleteCourse, type Lesson } from "@/lib/db";
import { splitAudioFile } from "@/lib/audio";
import { pipeline } from "@/lib/pipeline";
import { formatDate, formatDuration } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";

function newLesson(courseId: string, title: string, source: Lesson["source"]): Lesson {
  return {
    id: uid(),
    courseId,
    title,
    createdAt: Date.now(),
    durationSec: 0,
    status: source === "record" ? "recording" : "transcribing",
    inputDone: false,
    source,
    bookmarks: [],
    notes: "",
    quizAttempts: [],
  };
}

export default function CoursePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const course = useLiveQuery(() => db.courses.get(id), [id]);
  const lessons = useLiveQuery(
    () => db.lessons.where("courseId").equals(id).reverse().sortBy("createdAt"),
    [id],
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  if (course === undefined) return <p className="text-muted">טוען…</p>;
  if (course === null) return <p>הקורס לא נמצא. <Link href="/" className="text-brand-600">לדף הבית</Link></p>;

  const nextTitle = `שיעור ${(lessons?.length ?? 0) + 1}`;

  async function startRecording() {
    const lesson = newLesson(id, nextTitle, "record");
    await db.lessons.add(lesson);
    router.push(`/lesson/${lesson.id}`);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setUploadMsg("מפענח את הקובץ…");
      const { chunks, durationSec } = await splitAudioFile(file, (p) =>
        setUploadMsg(`מכין את הקובץ לתמלול… ${Math.round(p * 100)}%`),
      );
      const lesson = newLesson(id, file.name.replace(/\.[^.]+$/, "") || nextTitle, "upload");
      lesson.durationSec = durationSec;
      lesson.inputDone = true;
      await db.transaction("rw", db.lessons, db.chunks, async () => {
        await db.lessons.add(lesson);
        await db.chunks.bulkAdd(
          chunks.map((c, i) => ({
            id: uid(),
            lessonId: lesson.id,
            index: i,
            startSec: c.startSec,
            durationSec: c.durationSec,
            blob: c.blob,
            mime: "audio/wav",
            status: "pending" as const,
            attempts: 0,
          })),
        );
      });
      pipeline.kick();
      setUploadMsg(null);
      router.push(`/lesson/${lesson.id}`);
    } catch (err) {
      setUploadMsg(
        `לא ניתן לקרוא את הקובץ (${err instanceof Error ? err.message : err}). נסה קובץ MP3, M4A, WAV או WEBM.`,
      );
    }
  }

  const readyCount = lessons?.filter((l) => l.summary).length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted">
        <Link href="/" className="hover:underline">הקורסים שלי</Link>
        <span>›</span>
        <span>{course.name}</span>
      </div>

      <section className="card p-5 sm:p-6 relative overflow-hidden">
        <div className="absolute inset-y-0 right-0 w-2" style={{ background: course.color }} />
        {editing ? (
          <CourseEditor
            name={course.name}
            vocabulary={course.vocabulary}
            onSave={async (name, vocabulary) => {
              await db.courses.update(id, { name, vocabulary });
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold">{course.name}</h1>
              <p className="text-muted mt-1 text-sm">
                {lessons?.length ?? 0} שיעורים · {readyCount} מסוכמים
              </p>
              {course.vocabulary && (
                <p className="text-xs text-muted mt-2">מונחים: {course.vocabulary}</p>
              )}
            </div>
            <button className="btn btn-ghost text-sm self-start" onClick={() => setEditing(true)}>
              ✏️ עריכה
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
          <button className="btn btn-primary py-4 text-base" onClick={startRecording}>
            🎙️ הקלטת שיעור חדש
          </button>
          <button className="btn btn-ghost py-4 text-base" onClick={() => fileRef.current?.click()}>
            ⬆️ העלאת הקלטה קיימת
          </button>
          <Link
            href={`/course/${id}/notebook`}
            className={`btn btn-ghost py-4 text-base ${readyCount ? "" : "opacity-50 pointer-events-none"}`}
          >
            📓 מחברת הקורס
          </Link>
        </div>
        <input ref={fileRef} type="file" accept="audio/*,video/*" className="hidden" onChange={onFile} />
        {uploadMsg && <p className="mt-3 text-sm text-muted">{uploadMsg}</p>}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">שיעורים</h2>
        {lessons?.length === 0 && (
          <p className="text-muted card p-6 text-center">עוד אין שיעורים. התחל בהקלטה או העלה קובץ.</p>
        )}
        {lessons?.map((l, i) => (
          <Link
            key={l.id}
            href={`/lesson/${l.id}`}
            className="card p-4 flex items-center gap-4 hover:shadow-md transition"
          >
            <div className="grid place-items-center w-10 h-10 rounded-xl bg-brand-50 dark:bg-brand-700/20 text-brand-700 dark:text-brand-100 font-bold shrink-0">
              {lessons.length - i}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold truncate">{l.title}</div>
              <div className="text-xs text-muted mt-0.5">
                {formatDate(l.createdAt)}
                {l.durationSec > 0 && ` · ${formatDuration(l.durationSec)}`}
                {l.quizAttempts.length > 0 &&
                  ` · מבחן: ${l.quizAttempts[l.quizAttempts.length - 1].score}%`}
              </div>
            </div>
            <StatusBadge status={l.status} />
          </Link>
        ))}
      </section>

      <div className="pt-6">
        <button
          className="text-sm text-rose-600 hover:underline"
          onClick={async () => {
            if (confirm(`למחוק את הקורס "${course.name}" וכל השיעורים שבו? לא ניתן לשחזר.`)) {
              await deleteCourse(id);
              router.push("/");
            }
          }}
        >
          מחיקת הקורס
        </button>
      </div>
    </div>
  );
}

function CourseEditor(props: {
  name: string;
  vocabulary: string;
  onSave: (name: string, vocabulary: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(props.name);
  const [vocab, setVocab] = useState(props.vocabulary);
  return (
    <div className="space-y-3">
      <input className="input text-lg font-bold" value={name} onChange={(e) => setName(e.target.value)} />
      <div>
        <label className="text-sm font-semibold">מונחים נפוצים בקורס</label>
        <input className="input mt-1" value={vocab} onChange={(e) => setVocab(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={!name.trim()} onClick={() => props.onSave(name.trim(), vocab.trim())}>
          שמירה
        </button>
        <button className="btn btn-ghost" onClick={props.onCancel}>ביטול</button>
      </div>
    </div>
  );
}
