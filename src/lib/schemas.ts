import { z } from "zod";

/* Output schemas for every Claude task. Shared by the server (structured
   output) and the client (types). Hebrew descriptions guide the model. */

const KeyTerm = z.object({ term: z.string(), definition: z.string() });

const QuestionSchema = z.object({
  question: z.string(),
  options: z.array(z.string()).describe("בדיוק 4 תשובות אפשריות, טקסט רגיל בלי Markdown"),
  correctIndex: z.number().int().describe("האינדקס (0-3) של התשובה הנכונה"),
  explanation: z.string().describe("הסבר קצר: למה התשובה נכונה ולמה המסיחים שגויים"),
  topic: z.string().describe("שם הנושא שהשאלה בודקת, 1-4 מילים, עקבי בין שאלות"),
});

export const PartOutput = z.object({
  sections: z
    .array(
      z.object({
        heading: z.string(),
        content: z.string().describe("תוכן הנושא ב-Markdown: הסברים, נקודות, דוגמאות, נוסחאות"),
        startTime: z.string().describe("הזמן שבו הנושא מתחיל, מועתק מסימון הזמן בתמלול, למשל 1:02:30"),
      }),
    )
    .describe("הנושאים בקטע הזה לפי סדר הופעתם"),
  keyTerms: z.array(KeyTerm),
  takeaways: z.array(z.string()),
  openQuestions: z.array(z.string()).describe("משימות, הודעות מנהלתיות או דברים שלא הובהרו"),
});

export const LessonMetaOutput = z.object({
  title: z.string().describe("כותרת קצרה ותיאורית לשיעור"),
  overview: z.string().describe("תקציר של 3-6 משפטים על כל השיעור"),
  keyTerms: z.array(KeyTerm).describe("מושגי המפתח של כל השיעור, מאוחדים וללא כפילויות"),
  takeaways: z.array(z.string()).describe("5-10 הנקודות החשובות ביותר לזכור"),
  openQuestions: z.array(z.string()),
});

export const QuizOutput = z.object({ questions: z.array(QuestionSchema) });

export const ExamOutput = z.object({
  questions: z.array(
    QuestionSchema.extend({ lessonTitle: z.string().describe("שם השיעור שממנו נלקח החומר") }),
  ),
});

export const FlashcardsOutput = z.object({
  cards: z.array(
    z.object({
      front: z.string().describe("צד השאלה: מושג, שאלה קצרה או השלמה"),
      back: z.string().describe("צד התשובה: תמציתי, 1-3 משפטים"),
    }),
  ),
});

export const NotebookOutlineOutput = z.object({
  title: z.string(),
  introduction: z.string().describe("פתיח ב-Markdown: על מה הקורס ואיך המחברת בנויה"),
  chapters: z
    .array(
      z.object({
        title: z.string(),
        lessonNumbers: z.array(z.number().int()).describe("מספרי השיעורים שהפרק נשען עליהם"),
        focus: z.string().describe("מה הפרק צריך לכסות, 1-2 משפטים"),
      }),
    )
    .describe("פרקים לפי נושאים, לא בהכרח לפי סדר השיעורים"),
});

export const NotebookChapterOutput = z.object({
  content: z.string().describe("תוכן הפרק המלא ב-Markdown"),
});

export const ExamPrepOutput = z.object({
  examPrep: z.string().describe("דף הכנה למבחן ב-Markdown: עיקרים, קשרים בין נושאים, נוסחאות, שאלות צפויות"),
});

export const StudyPlanOutput = z.object({
  days: z.array(
    z.object({
      date: z.string().describe("YYYY-MM-DD"),
      focus: z.string().describe("נושא היום במשפט קצר"),
      tasks: z.array(
        z.object({
          title: z.string(),
          detail: z.string(),
          kind: z.enum(["review", "flashcards", "quiz", "exam", "read", "rest"]),
        }),
      ),
    }),
  ),
  tips: z.array(z.string()),
});

export type PartOutputT = z.infer<typeof PartOutput>;
export type LessonMetaOutputT = z.infer<typeof LessonMetaOutput>;
export type QuizOutputT = z.infer<typeof QuizOutput>;
export type ExamOutputT = z.infer<typeof ExamOutput>;
export type FlashcardsOutputT = z.infer<typeof FlashcardsOutput>;
export type NotebookOutlineOutputT = z.infer<typeof NotebookOutlineOutput>;
export type NotebookChapterOutputT = z.infer<typeof NotebookChapterOutput>;
export type ExamPrepOutputT = z.infer<typeof ExamPrepOutput>;
export type StudyPlanOutputT = z.infer<typeof StudyPlanOutput>;

/** Map of task name → output type, used by the typed client helper. */
export interface TaskOutputs {
  part: PartOutputT;
  "lesson-meta": LessonMetaOutputT;
  quiz: QuizOutputT;
  flashcards: FlashcardsOutputT;
  "notebook-outline": NotebookOutlineOutputT;
  "notebook-chapter": NotebookChapterOutputT;
  "exam-prep": ExamPrepOutputT;
  exam: ExamOutputT;
  "study-plan": StudyPlanOutputT;
}
export type TaskName = keyof TaskOutputs;
