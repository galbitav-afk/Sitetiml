"use client";

import { QueryClient, useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { deleteLocalLesson } from "./local-db";
import type { Course, Flashcard, Lesson, LessonStatus, QuizAttempt, Segment } from "./types";

/* Data access for everything stored in Supabase. Row Level Security on the
   server guarantees each user only ever touches their own rows. */

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: 1 } },
});

export const keys = {
  courses: ["courses"] as const,
  lessons: (courseId?: string) => ["lessons", courseId ?? "all"] as const,
  lesson: (id: string) => ["lesson", id] as const,
  segments: (lessonId: string) => ["segments", lessonId] as const,
  flashcards: (courseId?: string) => ["flashcards", courseId ?? "all"] as const,
  attempts: (courseId: string) => ["attempts", courseId] as const,
  digest: (courseId: string) => ["digest", courseId] as const,
};

export const PROCESSING: LessonStatus[] = ["recording", "transcribing", "summarizing"];

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export function invalidateLesson(lesson: Pick<Lesson, "id" | "course_id">) {
  void queryClient.invalidateQueries({ queryKey: keys.lesson(lesson.id) });
  void queryClient.invalidateQueries({ queryKey: keys.lessons(lesson.course_id) });
  void queryClient.invalidateQueries({ queryKey: keys.lessons() });
  void queryClient.invalidateQueries({ queryKey: keys.digest(lesson.course_id) });
}

/* ---------- Courses ---------- */

export async function fetchCourses(): Promise<Course[]> {
  return check(await supabase().from("courses").select("*").order("created_at", { ascending: true }));
}

export async function createCourse(input: { name: string; vocabulary?: string; color: string }): Promise<Course> {
  const course = check(
    await supabase()
      .from("courses")
      .insert({ name: input.name, vocabulary: input.vocabulary ?? "", color: input.color })
      .select()
      .single(),
  ) as Course;
  await queryClient.invalidateQueries({ queryKey: keys.courses });
  return course;
}

export async function updateCourse(id: string, patch: Partial<Course>) {
  check(await supabase().from("courses").update(patch).eq("id", id));
  await queryClient.invalidateQueries({ queryKey: keys.courses });
}

export async function deleteCourse(id: string) {
  const lessons = check(await supabase().from("lessons").select("id").eq("course_id", id)) as { id: string }[];
  check(await supabase().from("courses").delete().eq("id", id));
  for (const l of lessons) await deleteLocalLesson(l.id);
  await queryClient.invalidateQueries();
}

export function useCourses() {
  return useQuery({ queryKey: keys.courses, queryFn: fetchCourses });
}

export function useCourse(id: string | undefined) {
  const q = useCourses();
  return { ...q, data: id ? q.data?.find((c) => c.id === id) : undefined };
}

/* ---------- Lessons ---------- */

/** Lightweight columns for lists (no big JSON). */
const LIGHT =
  "id,course_id,title,status,source,input_done,duration_sec,segment_count,created_at,updated_at,error,summary_title:summary->>title";
export type LessonLight = Pick<
  Lesson,
  | "id"
  | "course_id"
  | "title"
  | "status"
  | "source"
  | "input_done"
  | "duration_sec"
  | "segment_count"
  | "created_at"
  | "updated_at"
  | "error"
> & { summary_title: string | null };

export async function fetchLessons(courseId?: string): Promise<LessonLight[]> {
  let q = supabase().from("lessons").select(LIGHT).order("created_at", { ascending: true });
  if (courseId) q = q.eq("course_id", courseId);
  return check(await q) as unknown as LessonLight[];
}

export function useLessons(courseId?: string) {
  return useQuery({
    queryKey: keys.lessons(courseId),
    queryFn: () => fetchLessons(courseId),
    refetchInterval: (query) =>
      (query.state.data as LessonLight[] | undefined)?.some((l) => PROCESSING.includes(l.status)) ? 5000 : false,
  });
}

export async function fetchLesson(id: string): Promise<Lesson | null> {
  return check(await supabase().from("lessons").select("*").eq("id", id).maybeSingle()) as Lesson | null;
}

export function useLesson(id: string | undefined) {
  return useQuery({
    queryKey: keys.lesson(id ?? ""),
    queryFn: () => fetchLesson(id!),
    enabled: !!id,
    refetchInterval: (query) => {
      const l = query.state.data as Lesson | null | undefined;
      return l && PROCESSING.includes(l.status) ? 4000 : false;
    },
  });
}

export async function createLesson(input: {
  course_id: string;
  title: string;
  source: Lesson["source"];
  status: LessonStatus;
  input_done?: boolean;
  duration_sec?: number;
  segment_count?: number;
}): Promise<Lesson> {
  const lesson = check(await supabase().from("lessons").insert(input).select().single()) as Lesson;
  invalidateLesson(lesson);
  return lesson;
}

export async function updateLesson(id: string, patch: Partial<Lesson>) {
  const row = check(
    await supabase().from("lessons").update(patch).eq("id", id).select("id,course_id").single(),
  ) as Pick<Lesson, "id" | "course_id">;
  invalidateLesson(row);
}

export async function deleteLesson(id: string) {
  check(await supabase().from("lessons").delete().eq("id", id));
  await deleteLocalLesson(id);
  await queryClient.invalidateQueries();
}

export async function nextLessonTitle(courseId: string) {
  const { count } = await supabase()
    .from("lessons")
    .select("id", { count: "exact", head: true })
    .eq("course_id", courseId);
  return `שיעור ${(count ?? 0) + 1}`;
}

/* ---------- Transcript segments ---------- */

export async function fetchSegments(lessonId: string): Promise<Segment[]> {
  return check(
    await supabase()
      .from("transcript_segments")
      .select("id,lesson_id,idx,start_sec,duration_sec,text,silent")
      .eq("lesson_id", lessonId)
      .order("idx"),
  ) as Segment[];
}

export function useSegments(lessonId: string | undefined, live = false) {
  return useQuery({
    queryKey: keys.segments(lessonId ?? ""),
    queryFn: () => fetchSegments(lessonId!),
    enabled: !!lessonId,
    refetchInterval: live ? 5000 : false,
  });
}

export async function upsertSegment(s: Omit<Segment, "id">) {
  check(await supabase().from("transcript_segments").upsert(s, { onConflict: "lesson_id,idx" }));
  void queryClient.invalidateQueries({ queryKey: keys.segments(s.lesson_id) });
}

/* ---------- Flashcards ---------- */

export async function fetchFlashcards(courseId?: string): Promise<Flashcard[]> {
  let q = supabase().from("flashcards").select("*").order("created_at");
  if (courseId) q = q.eq("course_id", courseId);
  return check(await q) as Flashcard[];
}

export function useFlashcards(courseId?: string) {
  return useQuery({ queryKey: keys.flashcards(courseId), queryFn: () => fetchFlashcards(courseId) });
}

export async function insertFlashcards(rows: Pick<Flashcard, "course_id" | "lesson_id" | "front" | "back">[]) {
  if (!rows.length) return;
  check(await supabase().from("flashcards").insert(rows));
  void queryClient.invalidateQueries({ queryKey: ["flashcards"] });
}

export async function updateFlashcard(id: string, patch: Partial<Flashcard>) {
  check(await supabase().from("flashcards").update(patch).eq("id", id));
}

export async function deleteFlashcard(id: string) {
  check(await supabase().from("flashcards").delete().eq("id", id));
  void queryClient.invalidateQueries({ queryKey: ["flashcards"] });
}

/* ---------- Quiz attempts ---------- */

export async function fetchAttempts(courseId: string): Promise<QuizAttempt[]> {
  return check(
    await supabase()
      .from("quiz_attempts")
      .select("*")
      .eq("course_id", courseId)
      .order("created_at", { ascending: false })
      .limit(200),
  ) as QuizAttempt[];
}

export function useAttempts(courseId: string | undefined) {
  return useQuery({
    queryKey: keys.attempts(courseId ?? ""),
    queryFn: () => fetchAttempts(courseId!),
    enabled: !!courseId,
  });
}

export async function insertAttempt(a: Omit<QuizAttempt, "id" | "created_at">) {
  check(await supabase().from("quiz_attempts").insert(a));
  void queryClient.invalidateQueries({ queryKey: keys.attempts(a.course_id) });
}

/* ---------- Course digest (summaries of every lesson, for AI context) ---------- */

export type DigestLesson = Pick<Lesson, "id" | "title" | "created_at" | "duration_sec" | "summary" | "parts">;

export async function fetchDigest(courseId: string): Promise<DigestLesson[]> {
  return check(
    await supabase()
      .from("lessons")
      .select("id,title,created_at,duration_sec,summary,parts")
      .eq("course_id", courseId)
      .not("summary", "is", null)
      .order("created_at"),
  ) as DigestLesson[];
}

export function useDigest(courseId: string | undefined) {
  return useQuery({
    queryKey: keys.digest(courseId ?? ""),
    queryFn: () => fetchDigest(courseId!),
    enabled: !!courseId,
  });
}

/* ---------- Search ---------- */

export interface SearchHit {
  kind: "summary" | "segment";
  lesson_id: string;
  course_id: string;
  lesson_title: string;
  body: string;
  start_sec: number | null;
  created_at: string;
}

export async function searchAll(q: string): Promise<SearchHit[]> {
  return check(await supabase().rpc("search_all", { q })) as SearchHit[];
}
