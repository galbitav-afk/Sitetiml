"use client";

import { db, getLessonChunks, type Chunk } from "./db";
import { summarizeLesson, transcribeChunk, buildNotebook } from "./api";
import { formatClock } from "./format";

const MAX_ATTEMPTS = 4;
const CONCURRENCY = 3;

/**
 * Background processor that lives for the whole browser session: transcribes
 * pending chunks (while recording continues), and once a lesson's input is
 * complete and every chunk is transcribed, generates its summary + quiz.
 * All state is in IndexedDB, so it resumes automatically after a reload.
 */
class Pipeline {
  private running = 0;
  private started = false;
  private inFlight = new Set<string>();
  private summarizing = new Set<string>();

  async init() {
    if (this.started) return;
    this.started = true;
    // Chunks that were mid-request when the page closed go back to the queue.
    await db.chunks.where("status").equals("processing").modify({ status: "pending" });
    const stuck = await db.lessons.where("status").equals("summarizing").toArray();
    for (const l of stuck) await db.lessons.update(l.id, { status: "transcribing" });
    window.addEventListener("online", () => this.kick());
    this.kick();
    const lessons = await db.lessons.where("status").equals("transcribing").toArray();
    for (const l of lessons) void this.checkLesson(l.id);
  }

  kick() {
    while (this.running < CONCURRENCY) {
      this.running++;
      void this.worker().finally(() => this.running--);
    }
  }

  private async nextChunk(): Promise<Chunk | undefined> {
    const pending = await db.chunks.where("status").equals("pending").toArray();
    return pending
      .filter((c) => !this.inFlight.has(c.id))
      .sort((a, b) => a.lessonId.localeCompare(b.lessonId) || a.index - b.index)[0];
  }

  private async worker() {
    for (;;) {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      const chunk = await this.nextChunk();
      if (!chunk) return;
      this.inFlight.add(chunk.id);
      try {
        await db.chunks.update(chunk.id, { status: "processing" });
        const prompt = await this.promptFor(chunk);
        const { text } = await transcribeChunk(chunk.blob, chunk.mime, prompt);
        await db.chunks.update(chunk.id, { status: "done", text: text.trim(), error: undefined });
      } catch (e) {
        const attempts = chunk.attempts + 1;
        const failed = attempts >= MAX_ATTEMPTS;
        await db.chunks.update(chunk.id, {
          attempts,
          status: failed ? "error" : "pending",
          error: e instanceof Error ? e.message : String(e),
        });
        if (!failed) await sleep(2000 * 2 ** attempts);
      } finally {
        this.inFlight.delete(chunk.id);
      }
      await this.checkLesson(chunk.lessonId);
    }
  }

  /** Course vocabulary + the tail of the previous chunk keeps terms consistent. */
  private async promptFor(chunk: Chunk) {
    const lesson = await db.lessons.get(chunk.lessonId);
    const course = lesson ? await db.courses.get(lesson.courseId) : undefined;
    const prev = await db.chunks
      .where("[lessonId+index]")
      .equals([chunk.lessonId, chunk.index - 1])
      .first();
    const parts = [];
    if (course?.vocabulary) parts.push(`מונחים: ${course.vocabulary}.`);
    if (prev?.text) parts.push(prev.text.slice(-300));
    return parts.join(" ");
  }

  /** Called after any change; starts the summary when everything is ready. */
  async checkLesson(lessonId: string) {
    const lesson = await db.lessons.get(lessonId);
    if (!lesson || !lesson.inputDone) return;
    if (lesson.status !== "transcribing") return;
    const chunks = await getLessonChunks(lessonId);
    if (chunks.some((c) => c.status === "pending" || c.status === "processing")) return;
    if (chunks.some((c) => c.status === "error")) {
      await db.lessons.update(lessonId, {
        status: "error",
        error: "חלק מקטעי התמלול נכשלו. לחץ 'נסה שוב'.",
      });
      return;
    }
    await this.summarize(lessonId);
  }

  async summarize(lessonId: string) {
    if (this.summarizing.has(lessonId)) return;
    this.summarizing.add(lessonId);
    try {
      const lesson = await db.lessons.get(lessonId);
      if (!lesson) return;
      const course = await db.courses.get(lesson.courseId);
      const chunks = await getLessonChunks(lessonId);
      const transcript = buildTranscript(chunks);
      if (!transcript.trim()) {
        await db.lessons.update(lessonId, {
          status: "error",
          error: "לא זוהה דיבור בהקלטה.",
        });
        return;
      }
      await db.lessons.update(lessonId, { status: "summarizing", error: undefined });
      const { summary } = await summarizeLesson({
        courseName: course?.name ?? "",
        lessonTitle: lesson.title,
        vocabulary: course?.vocabulary,
        transcript,
        bookmarks: lesson.bookmarks.map(formatClock),
        notes: lesson.notes || undefined,
      });
      await db.lessons.update(lessonId, {
        status: "ready",
        summary,
        title: lesson.titleEdited ? lesson.title : summary.title || lesson.title,
      });
    } catch (e) {
      await db.lessons.update(lessonId, {
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      this.summarizing.delete(lessonId);
    }
  }

  /** Retry failed chunks (or the summary step) of a lesson. */
  async retry(lessonId: string) {
    await db.chunks
      .where("lessonId")
      .equals(lessonId)
      .filter((c) => c.status === "error")
      .modify({ status: "pending", attempts: 0 });
    await db.lessons.update(lessonId, { status: "transcribing", error: undefined });
    this.kick();
    await this.checkLesson(lessonId);
  }

  async regenerateSummary(lessonId: string) {
    await db.lessons.update(lessonId, { status: "transcribing" });
    await this.checkLesson(lessonId);
  }

  async buildCourseNotebook(courseId: string) {
    const course = await db.courses.get(courseId);
    if (!course) throw new Error("קורס לא נמצא");
    const lessons = (await db.lessons.where("courseId").equals(courseId).sortBy("createdAt"))
      .filter((l) => l.summary);
    if (!lessons.length) throw new Error("אין עדיין שיעורים מסוכמים בקורס");
    const { notebook } = await buildNotebook({
      courseName: course.name,
      lessons: lessons.map((l) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { quiz, ...summary } = l.summary!;
        return {
          title: l.title,
          date: new Date(l.createdAt).toLocaleDateString("he-IL"),
          summary,
        };
      }),
    });
    await db.courses.update(courseId, {
      notebook: {
        data: notebook,
        updatedAt: Date.now(),
        lessonIds: lessons.map((l) => l.id),
      },
    });
  }
}

export function buildTranscript(chunks: Chunk[]) {
  return chunks
    .filter((c) => c.text)
    .map((c) => `[${formatClock(c.startSec)}] ${c.text}`)
    .join("\n\n");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const pipeline = new Pipeline();
