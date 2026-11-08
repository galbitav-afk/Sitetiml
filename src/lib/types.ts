/** Shapes stored in Supabase (rows) and inside their JSON columns. */

export type LessonStatus = "recording" | "transcribing" | "summarizing" | "ready" | "error";

export interface Bookmark {
  t: number; // seconds from lesson start
  note?: string;
}

export interface Section {
  heading: string;
  content: string; // Markdown
  startSec?: number;
}

export interface KeyTerm {
  term: string;
  definition: string;
}

/** Summary of one ~30-minute window of a lesson, produced while recording. */
export interface Part {
  index: number;
  startSec: number;
  endSec: number;
  sections: Section[];
  keyTerms: KeyTerm[];
  takeaways: string[];
  openQuestions: string[];
}

export interface LessonSummary {
  title: string;
  overview: string;
  sections: Section[];
  keyTerms: KeyTerm[];
  takeaways: string[];
  openQuestions: string[];
}

export interface Question {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  topic: string;
  lessonTitle?: string;
}

export interface Notebook {
  title: string;
  introduction: string;
  chapters: { title: string; lessonNumbers: number[]; content: string }[];
  glossary: KeyTerm[];
  examPrep: string;
}

export interface StudyTask {
  id: string;
  title: string;
  detail: string;
  kind: "review" | "flashcards" | "quiz" | "exam" | "read" | "rest";
}

export interface StudyPlan {
  generatedAt: string;
  examDate: string;
  days: { date: string; focus: string; tasks: StudyTask[] }[];
  tips: string[];
}

export interface Course {
  id: string;
  user_id: string;
  name: string;
  vocabulary: string;
  color: string;
  exam_date: string | null;
  notebook: Notebook | null;
  notebook_updated_at: string | null;
  notebook_lesson_ids: string[];
  study_plan: StudyPlan | null;
  study_plan_done: string[];
  created_at: string;
}

export interface Lesson {
  id: string;
  user_id: string;
  course_id: string;
  title: string;
  title_edited: boolean;
  status: LessonStatus;
  source: "record" | "upload";
  input_done: boolean;
  duration_sec: number;
  segment_count: number;
  bookmarks: Bookmark[];
  notes: string;
  parts: Part[];
  summary: LessonSummary | null;
  quiz: Question[] | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface Segment {
  id: string;
  lesson_id: string;
  idx: number;
  start_sec: number;
  duration_sec: number;
  text: string;
  silent: boolean;
  audio_path?: string | null;
  audio_bytes?: number;
}

export interface Flashcard {
  id: string;
  course_id: string;
  lesson_id: string | null;
  front: string;
  back: string;
  box: number;
  due_at: string;
  reviews: number;
  created_at: string;
}

export interface QuizAttempt {
  id: string;
  course_id: string;
  lesson_id: string | null;
  kind: "lesson" | "exam" | "mistakes";
  score: number;
  questions: Question[];
  answers: number[];
  duration_sec: number | null;
  created_at: string;
}
