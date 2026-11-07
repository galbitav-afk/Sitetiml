import { z } from "zod";

/** Structured summary + quiz that Claude produces for a single lesson. */
export const LessonSummarySchema = z.object({
  title: z.string().describe("כותרת קצרה ותיאורית לשיעור"),
  overview: z.string().describe("תקציר של 2-4 משפטים על מה השיעור עסק"),
  sections: z
    .array(
      z.object({
        heading: z.string(),
        content: z
          .string()
          .describe("תוכן הנושא ב-Markdown: הסברים, נקודות, דוגמאות, נוסחאות"),
      }),
    )
    .describe("הנושאים המרכזיים של השיעור לפי סדר הופעתם"),
  keyTerms: z
    .array(z.object({ term: z.string(), definition: z.string() }))
    .describe("מושגי מפתח והגדרותיהם כפי שהוצגו בשיעור"),
  takeaways: z.array(z.string()).describe("הנקודות החשובות ביותר לזכור"),
  openQuestions: z
    .array(z.string())
    .describe("נקודות שלא היו ברורות, משימות או דברים שהמרצה ביקש להכין"),
  quiz: z
    .array(
      z.object({
        question: z.string(),
        options: z.array(z.string()).describe("בדיוק 4 תשובות אפשריות"),
        correctIndex: z
          .number()
          .int()
          .describe("האינדקס (0-3) של התשובה הנכונה במערך options"),
        explanation: z
          .string()
          .describe("הסבר קצר למה התשובה נכונה ולמה המסיחים שגויים"),
      }),
    )
    .describe("מבחן אמריקאי של 8-12 שאלות להבנת החומר"),
});
export type LessonSummary = z.infer<typeof LessonSummarySchema>;

/** Course-wide notebook that merges all lesson summaries. */
export const NotebookSchema = z.object({
  title: z.string(),
  introduction: z
    .string()
    .describe("פתיח ב-Markdown: על מה הקורס, ומבנה החומר"),
  chapters: z
    .array(
      z.object({
        title: z.string(),
        content: z.string().describe("תוכן הפרק ב-Markdown"),
      }),
    )
    .describe("פרקים לפי נושאים (לא בהכרח לפי שיעורים) שמאחדים את כל החומר"),
  glossary: z
    .array(z.object({ term: z.string(), definition: z.string() }))
    .describe("מילון מושגים מאוחד לכל הקורס, ממוין לפי א-ב"),
  examPrep: z
    .string()
    .describe("דף הכנה למבחן ב-Markdown: עיקרים, נוסחאות, שאלות צפויות"),
});
export type Notebook = z.infer<typeof NotebookSchema>;

/** Request bodies for the API routes. */
export const SummarizeRequestSchema = z.object({
  courseName: z.string(),
  lessonTitle: z.string(),
  vocabulary: z.string().optional(),
  transcript: z.string().min(1),
  bookmarks: z.array(z.string()).optional(),
  notes: z.string().optional(),
});
export type SummarizeRequest = z.infer<typeof SummarizeRequestSchema>;

export const NotebookRequestSchema = z.object({
  courseName: z.string(),
  lessons: z
    .array(
      z.object({
        title: z.string(),
        date: z.string(),
        summary: LessonSummarySchema.omit({ quiz: true }),
      }),
    )
    .min(1),
});
export type NotebookRequest = z.infer<typeof NotebookRequestSchema>;
