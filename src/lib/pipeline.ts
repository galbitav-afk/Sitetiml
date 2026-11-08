"use client";

import { ApiError, runTaskWithRetry, transcribeAudio } from "./ai-client";
import {
  AUDIO_BUCKET,
  cloudAudioEnabled,
  fetchLesson,
  fetchSegments,
  insertFlashcards,
  invalidateLesson,
  queryClient,
  updateLesson,
  upsertSegment,
  keys,
} from "./data";
import { supabase } from "./supabase";
import { localDb, requestPersistentStorage, type AudioChunk } from "./local-db";
import { formatClock, parseClock } from "./format";
import { sanitizeQuestions } from "./study";
import type { Bookmark, Lesson, LessonSummary, Part, Segment } from "./types";

/** Lessons are summarized in windows of this length, progressively, while recording. */
export const PART_SECONDS = 30 * 60;
const CONCURRENCY = 3;
const MAX_CHUNK_ATTEMPTS = 6;
const MAX_PART_FAILURES = 3;

type Activity = Record<string, string>; // lessonId -> human status

/**
 * Background processor. Exactly one tab per browser is the leader (Web Locks),
 * so two open tabs never transcribe or pay for the same audio twice. Other tabs
 * forward "something changed" pings to the leader over a BroadcastChannel.
 *
 * Flow per lesson:  audio chunk → transcript segment (cloud)
 *                   every 30 min of contiguous transcript → part summary
 *                   input done + all parts → lesson summary + quiz + flashcards
 */
class Pipeline {
  private userId: string | null = null;
  private leader = false;
  private workers = 0;
  private inFlight = new Set<string>();
  private partsInFlight = new Set<string>();
  private evalChains = new Map<string, Promise<void>>();
  private channel?: BroadcastChannel;
  private sweep?: ReturnType<typeof setInterval>;
  private releaseLock?: () => void;
  private authBlocked = false;
  private ctxCache = new Map<string, { courseName: string; vocabulary: string }>();
  private activity: Activity = {};
  private uploading = false;
  /** Set when the cloud storage quota is full, so Settings can explain it. */
  cloudFull = false;
  private listeners = new Set<() => void>();

  /* ---------- lifecycle ---------- */

  start(userId: string) {
    if (this.userId === userId) return;
    this.stop();
    this.userId = userId;
    void requestPersistentStorage();
    this.channel = new BroadcastChannel("gal-kingdom-pipeline");
    this.channel.onmessage = (e) => {
      if (this.leader) this.notifyLocal(e.data?.lessonId);
    };
    window.addEventListener("online", this.onOnline);
    if (navigator.locks?.request) {
      void navigator.locks.request(
        `gal-kingdom-pipeline:${userId}`,
        () =>
          new Promise<void>((resolve) => {
            this.releaseLock = resolve;
            void this.becomeLeader();
          }),
      );
    } else {
      void this.becomeLeader();
    }
  }

  stop() {
    this.leader = false;
    this.userId = null;
    clearInterval(this.sweep);
    this.channel?.close();
    this.channel = undefined;
    this.releaseLock?.();
    this.releaseLock = undefined;
    window.removeEventListener("online", this.onOnline);
    this.ctxCache.clear();
  }

  private onOnline = () => this.notifyLocal();

  private async becomeLeader() {
    this.leader = true;
    await this.recover();
    this.notifyLocal();
    this.sweep = setInterval(() => this.notifyLocal(), 15_000);
  }

  /** Crash recovery: re-queue interrupted work. */
  private async recover() {
    const uid = this.userId;
    if (!uid) return;
    await localDb.chunks.where("status").equals("processing").modify({ status: "pending" });
    // A segment still marked "recording" whose recorder no longer holds its lock = crashed tab.
    const held = new Set(((await navigator.locks?.query?.())?.held ?? []).map((l) => l.name));
    const orphans = await localDb.chunks.where("status").equals("recording").toArray();
    for (const c of orphans) {
      if (!held.has(recordingLockName(c.lessonId))) {
        await localDb.chunks.update(c.id, { status: "pending", nextAttemptAt: 0 });
      }
    }
  }

  /** Call after anything changes (new chunk, recording stopped, retry…). */
  notify(lessonId?: string) {
    if (this.leader) this.notifyLocal(lessonId);
    else this.channel?.postMessage({ lessonId });
  }

  private notifyLocal(lessonId?: string) {
    if (!this.leader || !this.userId) return;
    this.authBlocked = false;
    this.kick();
    void this.uploadLoop();
    if (lessonId) void this.evaluate(lessonId);
    else void this.evaluateAll();
  }

  /* ---------- activity (for the UI) ---------- */

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getActivity = () => this.activity;
  private setActivity(lessonId: string, text: string | null) {
    const next = { ...this.activity };
    if (text) next[lessonId] = text;
    else delete next[lessonId];
    this.activity = next;
    this.listeners.forEach((f) => f());
  }

  /* ---------- transcription workers ---------- */

  private kick() {
    while (this.workers < CONCURRENCY) {
      this.workers++;
      void this.worker().finally(() => this.workers--);
    }
  }

  private async nextChunk(): Promise<AudioChunk | undefined> {
    const uid = this.userId;
    const now = Date.now();
    const pending = await localDb.chunks.where("status").equals("pending").toArray();
    return pending
      .filter((c) => c.userId === uid && c.nextAttemptAt <= now && !this.inFlight.has(c.id))
      .sort((a, b) => a.lessonId.localeCompare(b.lessonId) || a.idx - b.idx)[0];
  }

  private async worker() {
    for (;;) {
      if (!this.leader || this.authBlocked || !navigator.onLine) return;
      const chunk = await this.nextChunk();
      if (!chunk) return;
      this.inFlight.add(chunk.id);
      try {
        await this.transcribe(chunk);
      } finally {
        this.inFlight.delete(chunk.id);
      }
      void this.evaluate(chunk.lessonId);
    }
  }

  private async transcribe(chunk: AudioChunk) {
    await localDb.chunks.update(chunk.id, { status: "processing" });
    try {
      let text = "";
      if (!chunk.silent) {
        const prompt = await this.promptFor(chunk);
        text = (await transcribeAudio(chunk.blob, chunk.mime, prompt)).text.trim();
      }
      await upsertSegment({
        lesson_id: chunk.lessonId,
        idx: chunk.idx,
        start_sec: chunk.startSec,
        duration_sec: chunk.durationSec,
        text,
        silent: chunk.silent,
      });
      await localDb.chunks.update(chunk.id, { status: "done", text, error: undefined });
      void this.uploadLoop();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof ApiError && e.status === 401) {
        // Session expired: stop until the user is signed in again.
        this.authBlocked = true;
        await localDb.chunks.update(chunk.id, { status: "pending", error: msg });
        return;
      }
      const attempts = chunk.attempts + 1;
      const permanent = (e instanceof ApiError && !e.retryable) || attempts >= MAX_CHUNK_ATTEMPTS;
      await localDb.chunks.update(chunk.id, {
        attempts,
        status: permanent ? "error" : "pending",
        error: msg,
        nextAttemptAt: Date.now() + Math.min(5 * 60_000, 5000 * 2 ** attempts),
      });
      if (!permanent) setTimeout(() => this.kick(), Math.min(5 * 60_000, 5000 * 2 ** attempts) + 50);
    }
  }

  private async lessonContext(lessonId: string) {
    const cached = this.ctxCache.get(lessonId);
    if (cached) return cached;
    const { data } = await supabase()
      .from("lessons")
      .select("course:courses(name,vocabulary)")
      .eq("id", lessonId)
      .maybeSingle();
    const course = (data as { course?: { name: string; vocabulary: string } } | null)?.course;
    const ctx = { courseName: course?.name ?? "", vocabulary: course?.vocabulary ?? "" };
    this.ctxCache.set(lessonId, ctx);
    return ctx;
  }

  /** Course vocabulary + the tail of the previous segment keeps terms consistent. */
  private async promptFor(chunk: AudioChunk) {
    const { vocabulary } = await this.lessonContext(chunk.lessonId);
    const prev = await localDb.chunks.get(`${chunk.lessonId}:${chunk.idx - 1}`);
    const parts: string[] = [];
    if (vocabulary) parts.push(`מונחים: ${vocabulary}.`);
    if (prev?.text) parts.push(prev.text.slice(-300));
    return parts.join(" ");
  }

  /* ---------- cloud audio backup ---------- */

  /**
   * Uploads each transcribed chunk's audio to Supabase Storage (one at a time, in
   * the background), so recordings can be played on any device and survive this
   * computer. Can be turned off in Settings.
   */
  private async uploadLoop() {
    if (this.uploading || !this.leader || !this.userId) return;
    this.uploading = true;
    try {
      if (!(await cloudAudioEnabled())) return;
      for (;;) {
        if (!this.leader || !navigator.onLine) return;
        const uid = this.userId;
        const next = (await localDb.chunks.where("status").equals("done").toArray())
          .filter((c) => c.userId === uid && !c.cloud && (c.cloudAttempts ?? 0) < 5 && c.blob?.size > 0)
          .sort((a, b) => a.lessonId.localeCompare(b.lessonId) || a.idx - b.idx)[0];
        if (!next) return;
        await this.uploadChunk(next);
        if (this.cloudFull) return;
      }
    } finally {
      this.uploading = false;
    }
  }

  private async uploadChunk(c: AudioChunk) {
    const base = c.mime.split(";")[0];
    const ext = base.includes("ogg") ? "ogg" : base.includes("wav") ? "wav" : base.includes("mp4") ? "m4a" : "webm";
    const path = `${c.userId}/${c.lessonId}/${String(c.idx).padStart(4, "0")}.${ext}`;
    const sb = supabase();
    const { error } = await sb.storage.from(AUDIO_BUCKET).upload(path, c.blob, { upsert: true, contentType: base });
    if (error) {
      const full = /exceed|quota|too large|payload/i.test(error.message);
      if (full) this.cloudFull = true;
      const attempts = (c.cloudAttempts ?? 0) + 1;
      await localDb.chunks.update(c.id, { cloudAttempts: attempts, cloud: full || attempts >= 5 ? "failed" : undefined });
      if (!full) await new Promise((r) => setTimeout(r, 5000 * attempts));
      return;
    }
    await sb.from("transcript_segments").update({ audio_path: path, audio_bytes: c.blob.size }).eq("lesson_id", c.lessonId).eq("idx", c.idx);
    await localDb.chunks.update(c.id, { cloud: "uploaded" });
  }

  /* ---------- summarization ---------- */

  private async evaluateAll() {
    const uid = this.userId;
    if (!uid) return;
    const jobs = await localDb.jobs.where("userId").equals(uid).toArray();
    for (const j of jobs) void this.evaluate(j.lessonId);
  }

  /** Serialized per lesson so concurrent pings never double-summarize. */
  evaluate(lessonId: string): Promise<void> {
    const prev = this.evalChains.get(lessonId) ?? Promise.resolve();
    const next = prev
      .then(() => this.evaluateNow(lessonId))
      .catch((e) => console.error("evaluate failed", e));
    this.evalChains.set(lessonId, next);
    void next.finally(() => {
      if (this.evalChains.get(lessonId) === next) this.evalChains.delete(lessonId);
    });
    return next;
  }

  private async evaluateNow(lessonId: string) {
    if (!this.leader || !this.userId) return;
    const job = await localDb.jobs.get(lessonId);
    if (!job || job.userId !== this.userId) return;

    const lesson = await fetchLesson(lessonId);
    if (!lesson) {
      await localDb.jobs.delete(lessonId); // deleted elsewhere
      return;
    }
    if (lesson.status === "ready" || lesson.status === "error") {
      if (lesson.status === "ready") await localDb.jobs.delete(lessonId);
      return;
    }

    const segments = await fetchSegments(lessonId);
    const plan = planParts(lesson, segments);

    // A chunk that failed for good blocks the contiguous transcript: surface it
    // (with a "try again" button) instead of waiting forever.
    if (lesson.input_done && !plan.complete) {
      const failed = await localDb.chunks
        .where("lessonId")
        .equals(lessonId)
        .filter((c) => c.status === "error")
        .first();
      if (failed) {
        await updateLesson(lessonId, {
          status: "error",
          error: `התמלול נכשל בקטע שמתחיל ב-${formatClock(failed.startSec)}: ${failed.error ?? "שגיאה לא ידועה"}`,
        });
        return;
      }
    }

    for (const w of plan.readyWindows) {
      if (lesson.parts.some((p) => p.index === w.index)) continue;
      const key = `${lessonId}:${w.index}`;
      if (this.partsInFlight.has(key)) continue;
      this.partsInFlight.add(key);
      try {
        this.setActivity(lessonId, `מסכם את חלק ${w.index + 1} (${formatClock(w.start)}–${formatClock(w.end)})`);
        const part = await this.summarizePart(lesson, w, segments);
        const fresh = await fetchLesson(lessonId);
        if (!fresh) return;
        const parts = [...fresh.parts.filter((p) => p.index !== part.index), part].sort((a, b) => a.index - b.index);
        await updateLesson(lessonId, { parts });
        lesson.parts = parts;
      } catch (e) {
        await this.partFailed(lesson, e);
        return;
      } finally {
        this.partsInFlight.delete(key);
        this.setActivity(lessonId, null);
      }
    }

    if (plan.complete && plan.allWindows.every((i) => lesson.parts.some((p) => p.index === i))) {
      await this.finalize(lesson);
    } else if (lesson.input_done && lesson.status !== "transcribing") {
      await updateLesson(lessonId, { status: "transcribing" });
    }
  }

  private async partFailed(lesson: Lesson, e: unknown) {
    const job = await localDb.jobs.get(lesson.id);
    const failures = (job?.partFailures ?? 0) + 1;
    await localDb.jobs.update(lesson.id, { partFailures: failures });
    const msg = e instanceof Error ? e.message : String(e);
    if (failures >= MAX_PART_FAILURES || (e instanceof ApiError && !e.retryable)) {
      await updateLesson(lesson.id, { status: "error", error: `הסיכום נכשל: ${msg}` });
    } else {
      setTimeout(() => this.notify(lesson.id), 20_000 * failures);
    }
  }

  private async summarizePart(lesson: Lesson, w: PartWindow, segments: Segment[]): Promise<Part> {
    const inWindow = segments.filter((s) => s.start_sec >= w.start && s.start_sec < w.end);
    const base: Part = { index: w.index, startSec: w.start, endSec: w.end, sections: [], keyTerms: [], takeaways: [], openQuestions: [] };
    const spoken = inWindow.filter((s) => !s.silent && s.text.trim());
    if (!spoken.length) return base; // a break / silence: nothing to summarize

    const transcript = inWindow
      .map((s) => `[${formatClock(s.start_sec)}] ${s.silent || !s.text.trim() ? "(שקט / הפסקה)" : s.text}`)
      .join("\n\n");
    const ctx = await this.lessonContext(lesson.id);
    const prevPart = lesson.parts.find((p) => p.index === w.index - 1);
    const result = await runTaskWithRetry("part", {
      courseName: ctx.courseName,
      lessonTitle: lesson.title,
      vocabulary: ctx.vocabulary || undefined,
      partNumber: w.index + 1,
      startClock: formatClock(w.start),
      endClock: formatClock(Math.min(w.end, w.start + inWindow.reduce((m, s) => Math.max(m, s.start_sec + s.duration_sec - w.start), 0))),
      transcript,
      bookmarks: bookmarksIn(lesson.bookmarks, w.start, w.end),
      previousHeadings: prevPart?.sections.map((s) => s.heading),
    });
    return {
      ...base,
      sections: result.sections.map((s) => {
        const t = parseClock(s.startTime);
        return {
          heading: s.heading,
          content: s.content,
          startSec: Number.isFinite(t) && t >= w.start - 60 && t < w.end + 60 ? t : w.start,
        };
      }),
      keyTerms: result.keyTerms,
      takeaways: result.takeaways,
      openQuestions: result.openQuestions,
    };
  }

  private async finalize(lesson: Lesson) {
    const id = lesson.id;
    this.setActivity(id, "מאחד את הסיכום ובונה מבחן וכרטיסיות…");
    try {
      await updateLesson(id, { status: "summarizing", error: null });
      const ctx = await this.lessonContext(id);
      const parts = [...lesson.parts].sort((a, b) => a.index - b.index);
      const sections = parts.flatMap((p) => p.sections);
      if (!sections.length) {
        await updateLesson(id, { status: "error", error: "לא זוהה דיבור בהקלטה. בדוק שהמיקרופון קלט קול." });
        await localDb.jobs.delete(id);
        return;
      }
      const material = materialFromParts(parts);
      const durationMin = Math.max(1, lesson.duration_sec / 60);
      const quizCount = clamp(Math.round(durationMin / 9), 8, 20);
      const cardCount = clamp(Math.round(durationMin / 5), 10, 35);
      const common = { courseName: ctx.courseName, lessonTitle: lesson.title, material };

      const [meta, quiz, cards] = await Promise.allSettled([
        runTaskWithRetry("lesson-meta", { ...common, durationMin, notes: notesText(lesson) || undefined }),
        runTaskWithRetry("quiz", { ...common, count: quizCount }),
        runTaskWithRetry("flashcards", { ...common, count: cardCount }),
      ]);
      if (meta.status === "rejected") throw meta.reason;

      const summary: LessonSummary = {
        title: meta.value.title,
        overview: meta.value.overview,
        sections,
        keyTerms: meta.value.keyTerms,
        takeaways: meta.value.takeaways,
        openQuestions: meta.value.openQuestions,
      };
      const fresh = await fetchLesson(id);
      if (!fresh) return;
      if (cards.status === "fulfilled") {
        await supabase().from("flashcards").delete().eq("lesson_id", id);
        await insertFlashcards(
          cards.value.cards.map((c) => ({ course_id: fresh.course_id, lesson_id: id, front: c.front, back: c.back })),
        );
      }
      await updateLesson(id, {
        summary,
        quiz: quiz.status === "fulfilled" ? sanitizeQuestions(quiz.value.questions) : fresh.quiz,
        title: fresh.title_edited ? fresh.title : summary.title || fresh.title,
        status: "ready",
        error: null,
      });
      await localDb.jobs.delete(id);
      void queryClient.invalidateQueries({ queryKey: keys.flashcards(fresh.course_id) });
    } catch (e) {
      await updateLesson(id, {
        status: "error",
        error: `יצירת הסיכום נכשלה: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      this.setActivity(id, null);
    }
  }

  /* ---------- user actions ---------- */

  /** Register a lesson this device will drive to completion. */
  async addJob(lessonId: string) {
    if (!this.userId) return;
    await localDb.jobs.put({ lessonId, userId: this.userId, createdAt: Date.now(), partFailures: 0 });
  }

  async retry(lesson: Pick<Lesson, "id" | "course_id">) {
    await localDb.chunks
      .where("lessonId")
      .equals(lesson.id)
      .filter((c) => c.status === "error")
      .modify({ status: "pending", attempts: 0, nextAttemptAt: 0 });
    await this.addJob(lesson.id);
    await updateLesson(lesson.id, { status: "transcribing", error: null });
    this.notify(lesson.id);
  }

  /** Close an interrupted recording (crash / closed tab) and summarize what was captured. */
  async finishInterrupted(lesson: Pick<Lesson, "id" | "course_id" | "duration_sec">, cloudSegments: number) {
    const chunks = await localDb.chunks.where("lessonId").equals(lesson.id).toArray();
    await localDb.chunks
      .where("lessonId")
      .equals(lesson.id)
      .filter((c) => c.status === "recording")
      .modify({ status: "pending", nextAttemptAt: 0 });
    const count = chunks.length ? Math.max(...chunks.map((c) => c.idx)) + 1 : cloudSegments;
    const duration = chunks.length ? chunks.reduce((m, c) => Math.max(m, c.startSec + c.durationSec), 0) : lesson.duration_sec;
    await this.addJob(lesson.id);
    await updateLesson(lesson.id, {
      input_done: true,
      segment_count: count,
      duration_sec: duration,
      status: count ? "transcribing" : "error",
      error: count ? null : "לא נקלט אודיו בהקלטה.",
    });
    this.notify(lesson.id);
  }

  /** Re-run every summary step from the (cloud) transcript — works on any device. */
  async regenerate(lesson: Pick<Lesson, "id" | "course_id">) {
    await this.addJob(lesson.id);
    await updateLesson(lesson.id, { parts: [], status: "transcribing", error: null });
    invalidateLesson(lesson);
    this.notify(lesson.id);
  }
}

/* ---------- planning helpers (pure) ---------- */

export interface PartWindow {
  index: number;
  start: number;
  end: number;
}

/**
 * Decide which 30-minute windows can be summarized now. A window is ready once
 * every segment from the start of the lesson through the end of the window is
 * transcribed (contiguous), or the whole lesson is transcribed.
 */
export function planParts(lesson: Pick<Lesson, "input_done" | "segment_count">, segments: Segment[]) {
  const byIdx = new Map(segments.map((s) => [s.idx, s]));
  let p = -1;
  while (byIdx.has(p + 1)) p++;
  const prefix = segments.filter((s) => s.idx <= p).sort((a, b) => a.idx - b.idx);
  const complete = lesson.input_done && lesson.segment_count > 0 && p >= lesson.segment_count - 1;
  const coveredUntil = complete ? Infinity : prefix.length ? prefix[prefix.length - 1].start_sec + prefix[prefix.length - 1].duration_sec : 0;

  const windowIndexes = [...new Set(prefix.map((s) => Math.floor(s.start_sec / PART_SECONDS)))].sort((a, b) => a - b);
  const readyWindows: PartWindow[] = windowIndexes
    .filter((k) => complete || coveredUntil >= (k + 1) * PART_SECONDS)
    .map((k) => ({ index: k, start: k * PART_SECONDS, end: (k + 1) * PART_SECONDS }));
  return { complete, readyWindows, allWindows: complete ? windowIndexes : [] };
}

function bookmarksIn(bookmarks: Bookmark[], start: number, end: number) {
  return (bookmarks ?? [])
    .filter((b) => b.t >= start && b.t < end)
    .map((b) => `[${formatClock(b.t)}] ${b.note ? `פתק: ${b.note}` : "⭐ סומן כחשוב"}`);
}

function notesText(lesson: Lesson) {
  const notes = (lesson.bookmarks ?? []).filter((b) => b.note).map((b) => `[${formatClock(b.t)}] ${b.note}`);
  return [lesson.notes, ...notes].filter(Boolean).join("\n");
}

export function materialFromParts(parts: Part[]) {
  return parts
    .map((p) =>
      [
        ...p.sections.map((s) => `## ${s.heading} [${formatClock(s.startSec ?? p.startSec)}]\n${s.content}`),
        p.keyTerms.length ? `מושגים: ${p.keyTerms.map((k) => `${k.term}: ${k.definition}`).join(" | ")}` : "",
        p.takeaways.length ? `עיקרים: ${p.takeaways.join(" | ")}` : "",
        p.openQuestions.length ? `משימות/פתוח: ${p.openQuestions.join(" | ")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    )
    .join("\n\n");
}

export const recordingLockName = (lessonId: string) => `gal-kingdom-rec:${lessonId}`;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export const pipeline = new Pipeline();
