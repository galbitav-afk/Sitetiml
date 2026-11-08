import { z } from "zod";
import { requireUser, jsonError } from "@/lib/server/auth";
import { streamChat } from "@/lib/server/claude";
import { CHAT_SYSTEM } from "@/lib/server/tasks";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({
  courseName: z.string(),
  context: z.string().max(1_500_000),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(20_000) }))
    .min(1)
    .max(60),
});

export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth.error) return auth.error;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("בקשה לא תקינה", 400);
  const { courseName, context, messages } = parsed.data;
  if (messages[messages.length - 1].role !== "user") return jsonError("ההודעה האחרונה חייבת להיות של המשתמש", 400);

  const stream = streamChat({
    system: CHAT_SYSTEM,
    context: `קורס: ${courseName}\n\n<course_material>\n${context}\n</course_material>`,
    messages,
    signal: req.signal,
  });
  return new Response(stream, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
