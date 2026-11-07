import Dexie, { type EntityTable } from "dexie";
import type { LessonSummary, Notebook } from "./schemas";

export interface Course {
  id: string;
  name: string;
  /** Course-specific terms that help transcription accuracy. */
  vocabulary: string;
  color: string;
  createdAt: number;
  notebook?: { data: Notebook; updatedAt: number; lessonIds: string[] };
}

export type LessonStatus =
  | "recording"
  | "transcribing"
  | "summarizing"
  | "ready"
  | "error";

export interface QuizAttempt {
  answers: number[];
  score: number;
  at: number;
}

export interface Lesson {
  id: string;
  courseId: string;
  title: string;
  /** User renamed the lesson — don't overwrite with the AI-suggested title. */
  titleEdited?: boolean;
  createdAt: number;
  durationSec: number;
  status: LessonStatus;
  /** True once the recording/upload has finished producing chunks. */
  inputDone: boolean;
  source: "record" | "upload";
  /** Seconds from lesson start that the user marked as important. */
  bookmarks: number[];
  notes: string;
  summary?: LessonSummary;
  quizAttempts: QuizAttempt[];
  error?: string;
}

export type ChunkStatus = "pending" | "processing" | "done" | "error";

export interface Chunk {
  id: string;
  lessonId: string;
  index: number;
  startSec: number;
  durationSec: number;
  blob: Blob;
  mime: string;
  status: ChunkStatus;
  attempts: number;
  text?: string;
  error?: string;
}

export const db = new Dexie("lesson-notebook") as Dexie & {
  courses: EntityTable<Course, "id">;
  lessons: EntityTable<Lesson, "id">;
  chunks: EntityTable<Chunk, "id">;
};

db.version(1).stores({
  courses: "id, createdAt",
  lessons: "id, courseId, createdAt, status",
  chunks: "id, lessonId, [lessonId+index], status",
});

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

export const COURSE_COLORS = [
  "#6366f1",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#8b5cf6",
  "#14b8a6",
];

export async function getLessonChunks(lessonId: string) {
  return db.chunks
    .where("[lessonId+index]")
    .between([lessonId, Dexie.minKey], [lessonId, Dexie.maxKey])
    .toArray();
}

export async function deleteLesson(lessonId: string) {
  await db.transaction("rw", db.lessons, db.chunks, async () => {
    await db.chunks.where("lessonId").equals(lessonId).delete();
    await db.lessons.delete(lessonId);
  });
}

export async function deleteCourse(courseId: string) {
  const lessons = await db.lessons.where("courseId").equals(courseId).toArray();
  for (const l of lessons) await deleteLesson(l.id);
  await db.courses.delete(courseId);
}
