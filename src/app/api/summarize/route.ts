import { NextResponse } from "next/server";
import { generateStructured, describeError } from "@/lib/claude";
import { LessonSummarySchema, SummarizeRequestSchema } from "@/lib/schemas";
import { checkAuth, errorResponse } from "@/lib/server-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

const SYSTEM = `אתה עוזר לימודי שהופך תמלול של שיעור למחברת סיכום איכותית ולמבחן אמריקאי, בעברית.

התמלול נוצר אוטומטית ועלול להכיל שגיאות זיהוי, מילים חסרות וחזרות. השתמש בהקשר כדי להבין למה המרצה התכוון, ותקן מונחים שזוהו בצורה שגויה. אל תמציא תוכן שלא נאמר בשיעור. אם משהו לא ברור בתמלול, ציין זאת.

הסיכום:
- מאורגן לפי נושאים, בסדר שבו הם הופיעו בשיעור.
- מלא מספיק כדי ללמוד ממנו בלי לשמוע את ההקלטה: הגדרות, הסברים, דוגמאות, נוסחאות ושלבים.
- השתמש ב-Markdown בתוך שדות התוכן (רשימות, **הדגשות**, טבלאות כשמתאים). נוסחאות וביטויים מתמטיים כתוב בתוך \`backticks\` כדי שיוצגו נכון משמאל לימין.
- רגעים שהסטודנט סימן כחשובים יקבלו דגש מיוחד.
- מונחים מקצועיים באנגלית מותר להשאיר באנגלית לצד התרגום.

המבחן:
- 8 עד 12 שאלות שבודקות הבנה, לא רק שינון. כסה את כל הנושאים המרכזיים.
- לכל שאלה בדיוק 4 תשובות, אחת נכונה בלבד, ומסיחים סבירים.
- פזר את מיקום התשובה הנכונה בין האפשרויות.
- בשאלות ובתשובות אין Markdown; כתוב טקסט רגיל.`;

export async function POST(req: Request) {
  const denied = checkAuth(req);
  if (denied) return denied;

  const parsed = SummarizeRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse("בקשה לא תקינה", 400);
  const { courseName, lessonTitle, vocabulary, transcript, bookmarks, notes } = parsed.data;

  const prompt = [
    `קורס: ${courseName || "לא צוין"}`,
    `שיעור: ${lessonTitle}`,
    vocabulary ? `מונחים נפוצים בקורס: ${vocabulary}` : "",
    bookmarks?.length ? `רגעים שהסטודנט סימן כחשובים (זמן מתחילת השיעור): ${bookmarks.join(", ")}` : "",
    notes ? `הערות שהסטודנט כתב במהלך השיעור:\n${notes}` : "",
    `תמלול השיעור (הזמנים בסוגריים מציינים את תחילת כל מקטע):\n<transcript>\n${transcript}\n</transcript>`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const summary = await generateStructured({ system: SYSTEM, prompt, schema: LessonSummarySchema });
    return NextResponse.json({ summary });
  } catch (e) {
    const { message, status } = describeError(e);
    return errorResponse(message, status);
  }
}
