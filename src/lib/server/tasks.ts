import "server-only";
import { z } from "zod";
import {
  ExamOutput,
  ExamPrepOutput,
  FlashcardsOutput,
  LessonMetaOutput,
  NotebookChapterOutput,
  NotebookOutlineOutput,
  PartOutput,
  QuizOutput,
  StudyPlanOutput,
  type TaskName,
} from "@/lib/schemas";

/* Every AI task: what the client sends (input schema), the system prompt, how
   the user prompt is built, and the structured output schema. */

const BASE = `אתה עוזר לימודי מומחה שכותב בעברית ברורה ומדויקת לסטודנטים.
- אל תמציא תוכן שלא מופיע בחומר. אם משהו לא ברור, ציין זאת.
- מונחים מקצועיים באנגלית מותר להשאיר באנגלית לצד התרגום.
- נוסחאות וביטויים מתמטיים כתוב בתוך \`backticks\` כדי שיוצגו נכון משמאל לימין.`;

const TRANSCRIPT_NOTE = `התמלול נוצר אוטומטית ועלול להכיל שגיאות זיהוי, מילים חסרות וחזרות. השתמש בהקשר כדי להבין למה המרצה התכוון, ותקן מונחים שזוהו לא נכון.
בקטעים שקטים או בהפסקות, מודלי תמלול לפעמים "ממציאים" משפטים כלליים שלא קשורים לשיעור (למשל "תודה רבה", "תודה שצפיתם", "כתוביות"). התעלם משורות כאלה.`;

const str = z.string().max(400_000);
const lessonMaterial = z.string().max(1_500_000);

const QUIZ_RULES = `- כל שאלה בודקת הבנה ויישום, לא רק שינון. כסה את כל הנושאים באופן מאוזן.
- לכל שאלה בדיוק 4 תשובות, אחת נכונה בלבד, ומסיחים סבירים שמשקפים טעויות נפוצות.
- פזר את מיקום התשובה הנכונה בין האפשרויות.
- בשאלות ובתשובות אין Markdown.
- שדה topic: שם נושא קצר ועקבי (אותו נושא = אותו שם בדיוק).`;

interface TaskDef<I extends z.ZodType, O extends z.ZodType> {
  input: I;
  output: O;
  effort: "low" | "medium" | "high";
  system: string;
  prompt: (i: z.infer<I>) => string;
}
const defineTask = <I extends z.ZodType, O extends z.ZodType>(d: TaskDef<I, O>) => d;

export const TASKS = {
  part: defineTask({
    input: z.object({
      courseName: z.string(),
      lessonTitle: z.string(),
      vocabulary: z.string().optional(),
      partNumber: z.number().int(),
      startClock: z.string(),
      endClock: z.string(),
      transcript: str,
      bookmarks: z.array(z.string()).optional(),
      previousHeadings: z.array(z.string()).optional(),
    }),
    output: PartOutput,
    effort: "medium",
    system: `${BASE}

אתה מסכם קטע אחד (כחצי שעה) מתוך שיעור ארוך. הסיכומים של כל הקטעים יחוברו יחד למחברת אחת.
${TRANSCRIPT_NOTE}

- חלק לנושאים לפי סדר הופעתם, וציין לכל נושא את זמן ההתחלה כפי שמופיע בסימוני הזמן בתמלול.
- הסיכום צריך להיות מלא מספיק כדי ללמוד ממנו בלי לשמוע את ההקלטה: הגדרות, הסברים, דוגמאות, נוסחאות, שלבים, וגם דברים שהמרצה הדגיש ("זה חשוב", "זה יהיה במבחן").
- השתמש ב-Markdown בשדות התוכן (רשימות, **הדגשות**, טבלאות כשמתאים).
- רגעים שהסטודנט סימן כחשובים, ופתקים שכתב, מקבלים דגש מיוחד.
- אם הקטע ממשיך נושא מהקטע הקודם, המשך אותו באופן טבעי בלי לחזור על מה שכבר נאמר.
- אם הקטע הוא הפסקה או חסר תוכן לימודי, החזר רשימות ריקות.`,
    prompt: (i) =>
      [
        `קורס: ${i.courseName || "לא צוין"} · שיעור: ${i.lessonTitle}`,
        i.vocabulary ? `מונחים נפוצים בקורס: ${i.vocabulary}` : "",
        `זהו קטע מספר ${i.partNumber} בשיעור (${i.startClock}–${i.endClock}).`,
        i.previousHeadings?.length ? `הנושאים שסוכמו בקטע הקודם: ${i.previousHeadings.join(" · ")}` : "",
        i.bookmarks?.length ? `רגעים חשובים ופתקים של הסטודנט בקטע הזה:\n${i.bookmarks.join("\n")}` : "",
        `<transcript>\n${i.transcript}\n</transcript>`,
      ]
        .filter(Boolean)
        .join("\n\n"),
  }),

  "lesson-meta": defineTask({
    input: z.object({
      courseName: z.string(),
      lessonTitle: z.string(),
      durationMin: z.number(),
      material: lessonMaterial,
      notes: z.string().optional(),
    }),
    output: LessonMetaOutput,
    effort: "medium",
    system: `${BASE}

קיבלת את הסיכום המפורט של כל חלקי השיעור, לפי הסדר. כתוב את "השכבה העליונה" של המחברת: כותרת, תקציר של כל השיעור, מושגי מפתח מאוחדים (בלי כפילויות, עם ההגדרה הטובה ביותר), הנקודות החשובות ביותר לזכור, ומשימות או נקודות פתוחות.`,
    prompt: (i) =>
      [
        `קורס: ${i.courseName} · שיעור: ${i.lessonTitle} · משך: ${Math.round(i.durationMin)} דקות`,
        i.notes ? `הערות הסטודנט:\n${i.notes}` : "",
        `<lesson_notes>\n${i.material}\n</lesson_notes>`,
      ]
        .filter(Boolean)
        .join("\n\n"),
  }),

  quiz: defineTask({
    input: z.object({
      courseName: z.string(),
      lessonTitle: z.string(),
      material: lessonMaterial,
      count: z.number().int().min(3).max(40),
    }),
    output: QuizOutput,
    effort: "medium",
    system: `${BASE}

כתוב מבחן אמריקאי שבודק הבנה של השיעור.
${QUIZ_RULES}`,
    prompt: (i) =>
      `קורס: ${i.courseName} · שיעור: ${i.lessonTitle}\nכתוב בדיוק ${i.count} שאלות.\n\n<lesson_notes>\n${i.material}\n</lesson_notes>`,
  }),

  flashcards: defineTask({
    input: z.object({
      courseName: z.string(),
      lessonTitle: z.string(),
      material: lessonMaterial,
      count: z.number().int().min(3).max(60),
    }),
    output: FlashcardsOutput,
    effort: "low",
    system: `${BASE}

כתוב כרטיסיות לחזרה מרווחת. כל כרטיסייה בודקת פריט ידע אחד: מושג והגדרה, שאלת "למה" או "מה ההבדל", שלבים של תהליך, או נוסחה ומשמעותה. הצד האחורי קצר וחד.`,
    prompt: (i) =>
      `קורס: ${i.courseName} · שיעור: ${i.lessonTitle}\nכתוב כ-${i.count} כרטיסיות.\n\n<lesson_notes>\n${i.material}\n</lesson_notes>`,
  }),

  "notebook-outline": defineTask({
    input: z.object({
      courseName: z.string(),
      lessons: z.string().max(600_000),
    }),
    output: NotebookOutlineOutput,
    effort: "medium",
    system: `${BASE}

אתה בונה את מבנה מחברת הקורס: פרקים לפי נושאים שמאחדים את כל השיעורים. אחד נושאים שחזרו בכמה שיעורים, וסדר את הפרקים בסדר לימודי הגיוני. בדרך כלל 4-12 פרקים.`,
    prompt: (i) =>
      `קורס: ${i.courseName}\n\n<lessons>\n${i.lessons}\n</lessons>`,
  }),

  "notebook-chapter": defineTask({
    input: z.object({
      courseName: z.string(),
      chapterTitle: z.string(),
      focus: z.string(),
      material: lessonMaterial,
    }),
    output: NotebookChapterOutput,
    effort: "medium",
    system: `${BASE}

כתוב פרק אחד במחברת קורס, מתוך סיכומי השיעורים שקיבלת. איחד את החומר לטקסט רציף ומאורגן (כותרות משנה ##, רשימות, טבלאות), בלי כפילויות, ושמור על כל ההגדרות, ההסברים, הדוגמאות והנוסחאות. בסוף הפרק הוסף שורה: "מקורות: שיעורים X, Y".`,
    prompt: (i) =>
      `קורס: ${i.courseName}\nפרק: ${i.chapterTitle}\nמה לכסות: ${i.focus}\n\n<material>\n${i.material}\n</material>`,
  }),

  "exam-prep": defineTask({
    input: z.object({ courseName: z.string(), material: lessonMaterial }),
    output: ExamPrepOutput,
    effort: "medium",
    system: `${BASE}

כתוב דף הכנה למבחן: מה הכי חשוב לדעת, הקשרים בין הנושאים, נוסחאות או הגדרות שחייבים לזכור, טעויות נפוצות, ו-8-12 שאלות שסביר שיופיעו במבחן (בלי תשובות).`,
    prompt: (i) =>
      `קורס: ${i.courseName}\n\n<course>\n${i.material}\n</course>`,
  }),

  exam: defineTask({
    input: z.object({
      courseName: z.string(),
      material: lessonMaterial,
      count: z.number().int().min(5).max(50),
      difficulty: z.enum(["easy", "medium", "hard"]),
      focusTopics: z.array(z.string()).optional(),
    }),
    output: ExamOutput,
    effort: "medium",
    system: `${BASE}

אתה כותב סימולציית מבחן לקורס, מתוך סיכומי השיעורים שקיבלת.
${QUIZ_RULES}
- רמת קושי "easy": הבנה בסיסית. "medium": יישום. "hard": שאלות שמשלבות כמה נושאים, מקרים מורכבים ומסיחים קשים.
- לכל שאלה ציין את שם השיעור שממנו נלקח החומר (lessonTitle).`,
    prompt: (i) =>
      [
        `קורס: ${i.courseName}`,
        `כתוב בדיוק ${i.count} שאלות ברמת קושי ${i.difficulty}.`,
        i.focusTopics?.length ? `תן משקל גבוה לנושאים שבהם הסטודנט חלש: ${i.focusTopics.join(", ")}` : "",
        `<course>\n${i.material}\n</course>`,
      ]
        .filter(Boolean)
        .join("\n\n"),
  }),

  "study-plan": defineTask({
    input: z.object({
      courseName: z.string(),
      today: z.string(),
      examDate: z.string(),
      hoursPerDay: z.number(),
      lessons: z.string().max(200_000),
      weakTopics: z.array(z.string()),
      dueCards: z.number().int(),
    }),
    output: StudyPlanOutput,
    effort: "medium",
    system: `${BASE}

בנה תוכנית לימוד יומית ומציאותית מהיום ועד יום המבחן (כולל). עקרונות: פיזור חזרות (spaced repetition), תרגול אקטיבי (מבחנים וכרטיסיות) ולא רק קריאה, יותר זמן לנושאים חלשים, סימולציית מבחן מלאה 2-3 ימים לפני המבחן, ויום אחרון קליל. כל יום: 2-5 משימות קונקרטיות שמתאימות לזמן שהוקצב.
סוגי משימות: review (חזרה על סיכום שיעור או פרק), flashcards, quiz (מבחן של שיעור), exam (סימולציה), read (קריאה במחברת), rest.`,
    prompt: (i) =>
      [
        `קורס: ${i.courseName}`,
        `היום: ${i.today} · תאריך המבחן: ${i.examDate} · זמן לימוד ביום: כ-${i.hoursPerDay} שעות`,
        `כרטיסיות שממתינות לחזרה: ${i.dueCards}`,
        i.weakTopics.length ? `נושאים חלשים לפי המבחנים: ${i.weakTopics.join(", ")}` : "אין עדיין נתוני מבחנים.",
        `<lessons>\n${i.lessons}\n</lessons>`,
      ].join("\n\n"),
  }),
} satisfies Record<TaskName, TaskDef<z.ZodType, z.ZodType>>;

export function isTask(name: string): name is TaskName {
  return Object.prototype.hasOwnProperty.call(TASKS, name);
}

export const CHAT_SYSTEM = `${BASE}

אתה "העוזר של הממלכה": עונה על שאלות של סטודנט על החומר של הקורס, על סמך החומר המצורף (סיכומי שיעורים ולעיתים תמלול מלא).
- ענה בעברית, בקצרה וברור, עם Markdown כשזה עוזר.
- כשאפשר, ציין מאיזה שיעור ומאיזה זמן המידע, בפורמט: (שיעור 3, 12:30).
- אם התשובה לא מופיעה בחומר, אמור זאת במפורש, ורק אז הוסף הסבר כללי שמסומן "מעבר לחומר של הקורס".
- אפשר גם לבחון את הסטודנט, להסביר בדרך אחרת או לתת דוגמאות כשהוא מבקש.
${TRANSCRIPT_NOTE}`;
