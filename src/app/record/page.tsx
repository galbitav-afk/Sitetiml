"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRecorder } from "@/components/recorder-provider";
import { CourseForm } from "@/components/course-form";
import { MicCheck } from "@/components/mic-check";
import Markdown from "@/components/markdown";
import { Modal, PageLoader, Spinner, useToast } from "@/components/ui";
import { createLesson, deleteLesson, nextLessonTitle, useCourses, useLesson, useSegments } from "@/lib/data";
import { recordingSupported, tabAudioSupported, SEGMENT_SECONDS, type SourceKind } from "@/lib/recorder";
import { formatClock } from "@/lib/format";
import { PART_SECONDS } from "@/lib/pipeline";

export default function RecordPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Record />
    </Suspense>
  );
}

function Record() {
  const rec = useRecorder();
  if (rec.status !== "idle" && rec.lessonId) return <Studio />;
  return <Setup />;
}

/* ------------------------------------------------------------------ */
/* Setup wizard: course → source → start                              */
/* ------------------------------------------------------------------ */

const SOURCES: { id: SourceKind; icon: string; title: string; text: string }[] = [
  { id: "mic", icon: "🎙️", title: "מיקרופון", text: "שיעור פרונטלי בכיתה" },
  { id: "tab", icon: "💻", title: "שמע מהמחשב", text: "זום, טימס או הקלטה שמתנגנת בלשונית" },
  { id: "both", icon: "🎧", title: "שניהם", text: "שיעור מקוון שבו גם אתה מדבר" },
];

function Setup() {
  const params = useSearchParams();
  const router = useRouter();
  const rec = useRecorder();
  const toast = useToast();
  const { data: courses, isLoading } = useCourses();
  const [courseId, setCourseId] = useState(params.get("course") ?? "");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [source, setSource] = useState<SourceKind>("mic");
  const [deviceId, setDeviceId] = useState("");
  const [starting, setStarting] = useState(false);
  const supported = recordingSupported();

  useEffect(() => {
    if (!courseId && courses?.length) setCourseId(courses[courses.length - 1].id);
  }, [courses, courseId]);

  useEffect(() => {
    if (!courseId || titleTouched) return;
    void nextLessonTitle(courseId).then(setTitle).catch(() => {});
  }, [courseId, titleTouched]);

  async function start() {
    if (!courseId) return;
    setStarting(true);
    rec.clearError();
    try {
      const lesson = await createLesson({
        course_id: courseId,
        title: title.trim() || "שיעור",
        source: "record",
        status: "recording",
      });
      const ok = await rec.start({ lesson, source, deviceId: deviceId || undefined });
      if (!ok) await deleteLesson(lesson.id).catch(() => {});
    } catch (e) {
      toast(`לא ניתן להתחיל: ${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setStarting(false);
    }
  }

  if (isLoading) return <PageLoader />;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <header>
        <h1 className="font-display text-3xl font-bold">הקלטת שיעור חדש</h1>
        <p className="text-muted mt-1">שלושה צעדים קצרים, ואז אפשר להתרכז בשיעור. התמלול והסיכום יקרו לבד.</p>
      </header>

      {!supported && (
        <div className="card p-4 border-danger text-danger">הדפדפן הזה לא תומך בהקלטה. מומלץ Chrome או Edge עדכני.</div>
      )}

      {/* Step 1 */}
      <section className="card p-5 sm:p-6 space-y-4">
        <StepTitle n={1} title="לאיזה קורס?" />
        {courses?.length ? (
          <div className="grid sm:grid-cols-2 gap-2">
            {courses.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setCourseId(c.id);
                  setCreating(false);
                }}
                aria-pressed={courseId === c.id}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-start transition ${
                  courseId === c.id ? "border-royal bg-royal-soft ring-1 ring-royal" : "border-line hover:border-royal/50"
                }`}
              >
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: c.color }} />
                <span className="font-medium truncate">{c.name}</span>
                {courseId === c.id && <span className="ms-auto text-royal">✓</span>}
              </button>
            ))}
            <button onClick={() => setCreating(true)} className="rounded-xl border border-dashed border-line px-4 py-3 text-muted hover:text-royal hover:border-royal transition">
              ＋ קורס חדש
            </button>
          </div>
        ) : null}
        {(creating || courses?.length === 0) && (
          <div className="rounded-xl bg-royal-soft/50 p-4">
            <CourseForm
              compact
              onCancel={courses?.length ? () => setCreating(false) : undefined}
              onDone={(c) => {
                setCourseId(c.id);
                setCreating(false);
              }}
            />
          </div>
        )}
        {courseId && (
          <div>
            <label className="label" htmlFor="lesson-title">שם השיעור</label>
            <input
              id="lesson-title"
              className="input"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setTitleTouched(true);
              }}
            />
            <p className="hint">אפשר להשאיר כך. בסוף השיעור יוצע שם לפי התוכן.</p>
          </div>
        )}
      </section>

      {/* Step 2 */}
      <section className={`card p-5 sm:p-6 space-y-4 ${courseId ? "" : "opacity-50 pointer-events-none"}`}>
        <StepTitle n={2} title="מאיפה מגיע הקול?" />
        <div className="grid sm:grid-cols-3 gap-2">
          {SOURCES.map((s) => {
            const disabled = s.id !== "mic" && !tabAudioSupported();
            return (
              <button
                key={s.id}
                disabled={disabled}
                onClick={() => setSource(s.id)}
                aria-pressed={source === s.id}
                className={`rounded-xl border p-4 text-start transition disabled:opacity-40 ${
                  source === s.id ? "border-royal bg-royal-soft ring-1 ring-royal" : "border-line hover:border-royal/50"
                }`}
              >
                <div className="text-2xl" aria-hidden>{s.icon}</div>
                <div className="font-semibold mt-1">{s.title}</div>
                <div className="text-xs text-muted mt-0.5">{s.text}</div>
              </button>
            );
          })}
        </div>
        {source !== "tab" && <MicCheck deviceId={deviceId} onDevice={setDeviceId} />}
        {source !== "mic" && (
          <div className="rounded-xl bg-gold-soft p-3 text-sm leading-relaxed">
            <b>איך משתפים שמע:</b> אחרי הלחיצה על “התחל” ייפתח חלון שיתוף. בחר את <b>הלשונית</b> של השיעור (זום או טימס
            בדפדפן, או הקלטה במודל), וסמן <b>“שיתוף אודיו של הכרטיסייה”</b>. באפליקציית זום שמותקנת במחשב, בחר “כל המסך”
            וסמן “שיתוף אודיו של המערכת” (ב-Windows).
          </div>
        )}
      </section>

      {/* Step 3 */}
      <section className={`card p-5 sm:p-6 space-y-4 ${courseId ? "" : "opacity-50 pointer-events-none"}`}>
        <StepTitle n={3} title="מוכנים?" />
        <ul className="text-sm text-muted space-y-1.5">
          <li>🔌 בשיעור ארוך, חבר את המחשב לחשמל וודא שהוא לא נכנס למצב שינה (לא לסגור את המכסה).</li>
          <li>🧭 אפשר לגלוש באתר בזמן ההקלטה, והיא תמשיך. רק אל תסגור את הלשונית.</li>
          <li>⭐ במהלך השיעור: Ctrl+B מסמן רגע חשוב, ואפשר לכתוב פתקים עם חותמת זמן.</li>
        </ul>
        {rec.error && <p role="alert" className="text-sm text-danger">{rec.error}</p>}
        <button className="btn btn-record btn-lg w-full sm:w-auto" disabled={!courseId || starting || !supported} onClick={start}>
          {starting ? <Spinner className="w-5 h-5" /> : "⏺"} התחל להקליט
        </button>
      </section>

      <p className="text-center text-sm text-muted">
        יש לך כבר הקלטה?{" "}
        <button className="text-royal underline" onClick={() => router.push(courseId ? `/course/${courseId}?upload=1` : "/")}>
          העלה קובץ
        </button>
      </p>
    </div>
  );
}

function StepTitle({ n, title }: { n: number; title: string }) {
  return (
    <h2 className="flex items-center gap-3 font-display text-xl font-bold">
      <span className="grid place-items-center w-8 h-8 rounded-full bg-royal text-white text-sm font-sans">{n}</span>
      {title}
    </h2>
  );
}

/* ------------------------------------------------------------------ */
/* Studio: live recording                                             */
/* ------------------------------------------------------------------ */

function Studio() {
  const rec = useRecorder();
  const router = useRouter();
  const { data: lesson } = useLesson(rec.lessonId ?? undefined);
  const { data: segments } = useSegments(rec.lessonId ?? undefined, true);
  const [note, setNote] = useState("");
  const [confirmStop, setConfirmStop] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const active = rec.status === "recording" || rec.status === "paused";

  // Ctrl/Cmd+B = mark this moment.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        void rec.bookmark();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [rec]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [segments?.length, rec.liveText]);

  async function finish() {
    setConfirmStop(false);
    const id = rec.lessonId;
    await rec.stop();
    if (id) router.push(`/lesson/${id}`);
  }

  const lastEnd = (segments ?? []).reduce((m, s) => Math.max(m, s.start_sec + s.duration_sec), 0);
  const nextPartAt = (Math.floor(rec.elapsed / PART_SECONDS) + 1) * PART_SECONDS;
  const sinceSegment = rec.elapsed % SEGMENT_SECONDS;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted">
        <span className="chip bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">● אולפן הקלטה</span>
        <span className="truncate">{rec.lessonTitle}</span>
        {lesson && (
          <Link href={`/course/${lesson.course_id}`} className="ms-auto text-royal hover:underline shrink-0">לדף הקורס ←</Link>
        )}
      </div>

      {rec.noSound && (
        <div role="alert" className="rounded-xl bg-danger text-white p-4 font-semibold flex items-center gap-3">
          <span className="text-2xl blink" aria-hidden>🔇</span>
          לא נקלט קול כבר חצי דקה. בדוק שהמיקרופון לא מושתק ושנבחר ההתקן הנכון.
        </div>
      )}
      {rec.saveError && <div role="alert" className="rounded-xl bg-warning/15 text-warning p-3 text-sm font-medium">{rec.saveError}</div>}

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Controls */}
        <section className="card p-6 lg:col-span-2 flex flex-col items-center gap-5 text-center lg:sticky lg:top-6 self-start">
          <div className="text-6xl font-bold tabular-nums tracking-tight ltr">{formatClock(rec.elapsed)}</div>
          <LevelMeter level={rec.level} active={rec.status === "recording"} />

          <div className="flex items-center gap-4">
            <button
              onClick={rec.status === "paused" ? rec.resume : rec.pause}
              disabled={!active}
              className="btn btn-ghost w-16 h-16 rounded-full text-2xl"
              aria-label={rec.status === "paused" ? "המשך הקלטה" : "השהיה (הפסקה)"}
              title={rec.status === "paused" ? "המשך" : "השהיה (הפסקה)"}
            >
              {rec.status === "paused" ? "▶️" : "⏸️"}
            </button>
            <button
              onClick={() => setConfirmStop(true)}
              disabled={!active}
              className={`w-24 h-24 rounded-full bg-red-600 hover:bg-red-700 text-white grid place-items-center shadow-xl transition ${rec.status === "recording" ? "recording-pulse" : ""}`}
              aria-label="סיום השיעור"
            >
              {rec.status === "stopping" || rec.status === "starting" ? <Spinner className="w-8 h-8" /> : <span className="w-8 h-8 rounded-md bg-white" />}
            </button>
            <button
              onClick={() => rec.bookmark()}
              disabled={!active}
              className="btn btn-ghost w-16 h-16 rounded-full text-2xl"
              aria-label="סימון רגע חשוב (Ctrl+B)"
              title="סימון רגע חשוב (Ctrl+B)"
            >
              ⭐
            </button>
          </div>

          <p className="text-sm text-muted">
            {rec.status === "paused" && "מושהה. לחץ ▶️ כשהשיעור חוזר."}
            {rec.status === "recording" && <>מקטע תמלול הבא בעוד <span className="ltr">{formatClock(SEGMENT_SECONDS - sinceSegment)}</span> · סיכום ביניים בעוד <span className="ltr">{formatClock(nextPartAt - rec.elapsed)}</span></>}
            {rec.status === "stopping" && "שומר את המקטע האחרון…"}
          </p>

          <form
            className="w-full flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!note.trim()) return;
              void rec.bookmark(note.trim());
              setNote("");
            }}
          >
            <input className="input" placeholder="פתק עם חותמת זמן… (Enter)" value={note} onChange={(e) => setNote(e.target.value)} disabled={!active} />
            <button className="btn btn-ghost shrink-0" disabled={!active || !note.trim()}>שמור</button>
          </form>

          {rec.bookmarks.length > 0 && (
            <ul className="w-full text-start space-y-1.5 max-h-48 overflow-y-auto">
              {[...rec.bookmarks].reverse().map((b, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className="chip bg-gold-soft text-ink ltr shrink-0">{formatClock(b.t)}</span>
                  <span className="truncate">{b.note ?? "⭐ רגע חשוב"}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted">ההקלטה נשמרת במחשב כל 10 שניות. אפשר לגלוש באתר, רק לא לסגור את הלשונית.</p>
        </section>

        {/* Transcript + interim summaries */}
        <section className="lg:col-span-3 space-y-4">
          <div className="card p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display text-lg font-bold">תמלול</h2>
              <span className="text-xs text-muted">{segments?.length ?? 0} מקטעים · עד <span className="ltr">{formatClock(lastEnd)}</span></span>
            </div>
            <div ref={transcriptRef} className="max-h-[50vh] min-h-48 overflow-y-auto space-y-3 leading-relaxed pe-1">
              {segments?.map((s) => (
                <p key={s.id} className="rise">
                  <span className="text-xs text-muted me-2 ltr">{formatClock(s.start_sec)}</span>
                  {s.silent ? <span className="text-muted italic">(שקט / הפסקה)</span> : s.text || <span className="text-muted">…</span>}
                </p>
              ))}
              {(rec.liveText || rec.liveInterim) && (
                <div className="border-t border-line pt-3">
                  <div className="text-xs font-semibold text-muted mb-1">טיוטה חיה (תוחלף בתמלול המדויק)</div>
                  <p className="text-muted">
                    {rec.liveText.slice(-700)}
                    <span className="opacity-60">{rec.liveInterim}</span>
                  </p>
                </div>
              )}
              {!segments?.length && !rec.liveText && (
                <p className="text-muted text-sm">התמלול המדויק מופיע כאן כל 3 דקות.{rec.source === "tab" ? "" : " בינתיים תופיע טיוטה חיה."}</p>
              )}
            </div>
          </div>

          <div className="card p-4 sm:p-5">
            <h2 className="font-display text-lg font-bold mb-1">סיכומי ביניים</h2>
            <p className="text-xs text-muted mb-3">כל חצי שעה של שיעור מסוכמת אוטומטית, כבר עכשיו.</p>
            {lesson?.parts?.length ? (
              <div className="space-y-4">
                {lesson.parts.map((p) => (
                  <details key={p.index} className="rounded-xl border border-line p-3" open={p.index === lesson.parts.length - 1}>
                    <summary className="cursor-pointer font-semibold">
                      חלק {p.index + 1} · <span className="ltr text-muted text-sm">{formatClock(p.startSec)}–{formatClock(p.endSec)}</span>
                    </summary>
                    <div className="mt-3 space-y-3">
                      {p.sections.length ? (
                        p.sections.map((s, i) => (
                          <div key={i}>
                            <h3 className="font-semibold">{s.heading}</h3>
                            <Markdown>{s.content}</Markdown>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted">הפסקה, אין תוכן לימודי.</p>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">הסיכום הראשון יופיע אחרי 30 דקות של שיעור.</p>
            )}
          </div>
        </section>
      </div>

      <Modal open={confirmStop} onClose={() => setConfirmStop(false)} title="לסיים את השיעור?">
        <p className="text-muted mb-5">ההקלטה תיעצר, ואז ייווצרו הסיכום, המבחן והכרטיסיות. בדרך כלל זה לוקח כמה דקות.</p>
        <div className="flex gap-2">
          <button className="btn btn-record" onClick={finish}>⏹ סיום וסיכום</button>
          <button className="btn btn-ghost" onClick={() => setConfirmStop(false)}>להמשיך להקליט</button>
        </div>
      </Modal>
    </div>
  );
}

function LevelMeter({ level, active }: { level: number; active: boolean }) {
  const bars = 24;
  return (
    <div className="flex items-center gap-1 h-12" aria-hidden>
      {Array.from({ length: bars }).map((_, i) => {
        const center = 1 - Math.abs(i - bars / 2) / (bars / 2);
        const h = active ? Math.max(0.1, Math.min(1, level * (0.35 + center * 0.9))) : 0.1;
        return (
          <span
            key={i}
            className="w-1.5 rounded-full transition-[height] duration-150"
            style={{ height: `${h * 100}%`, background: active ? "#dc2626" : "var(--line)" }}
          />
        );
      })}
    </div>
  );
}
