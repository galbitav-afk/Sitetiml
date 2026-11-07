import { NextResponse } from "next/server";
import { generateStructured, describeError } from "@/lib/claude";
import { NotebookRequestSchema, NotebookSchema } from "@/lib/schemas";
import { checkAuth, errorResponse } from "@/lib/server-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

const SYSTEM = `אתה עוזר לימודי שבונה מחברת קורס מאוחדת בעברית מתוך סיכומי השיעורים של הקורס.

- ארגן את החומר לפי נושאים ולא בהכרח לפי סדר השיעורים: אחד נושאים שחזרו בכמה שיעורים, והסר כפילויות.
- שמור על כל התוכן המהותי: הגדרות, הסברים, דוגמאות ונוסחאות. המחברת צריכה לאפשר ללמוד למבחן בלי שום חומר נוסף.
- ציין בכל פרק מאילו שיעורים החומר הגיע (למשל "שיעורים 2, 5").
- השתמש ב-Markdown בשדות התוכן. נוסחאות וביטויים מתמטיים כתוב בתוך \`backticks\`.
- מילון המושגים מאוחד וממוין לפי סדר א-ב.
- דף ההכנה למבחן מרכז את העיקרים, הקשרים בין הנושאים ושאלות שסביר שיופיעו.`;

export async function POST(req: Request) {
  const denied = checkAuth(req);
  if (denied) return denied;

  const parsed = NotebookRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse("בקשה לא תקינה", 400);
  const { courseName, lessons } = parsed.data;

  const prompt = [
    `קורס: ${courseName}`,
    `להלן סיכומי ${lessons.length} השיעורים בסדר כרונולוגי:`,
    ...lessons.map(
      (l, i) => `<lesson number="${i + 1}" title="${l.title}" date="${l.date}">\n${JSON.stringify(l.summary)}\n</lesson>`,
    ),
  ].join("\n\n");

  try {
    const notebook = await generateStructured({ system: SYSTEM, prompt, schema: NotebookSchema });
    return NextResponse.json({ notebook });
  } catch (e) {
    const { message, status } = describeError(e);
    return errorResponse(message, status);
  }
}
