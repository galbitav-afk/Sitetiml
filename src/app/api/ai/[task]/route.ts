import { NextResponse } from "next/server";
import { requireUser, jsonError } from "@/lib/server/auth";
import { generateStructured, describeError } from "@/lib/server/claude";
import { TASKS, isTask } from "@/lib/server/tasks";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request, ctx: { params: Promise<{ task: string }> }) {
  const auth = await requireUser(req);
  if (auth.error) return auth.error;

  const { task } = await ctx.params;
  if (!isTask(task)) return jsonError("משימה לא מוכרת", 404);
  // Widen to the common shape: input was validated by this task's own schema.
  const def = TASKS[task] as unknown as {
    input: (typeof TASKS)[typeof task]["input"];
    output: (typeof TASKS)[typeof task]["output"];
    effort: "low" | "medium" | "high";
    system: string;
    prompt: (i: unknown) => string;
  };

  const body = await req.json().catch(() => null);
  const parsed = def.input.safeParse(body);
  if (!parsed.success) return jsonError(`בקשה לא תקינה: ${parsed.error.issues[0]?.message ?? ""}`, 400);

  try {
    const result = await generateStructured({
      system: def.system,
      prompt: def.prompt(parsed.data),
      schema: def.output,
      effort: def.effort,
      signal: req.signal,
    });
    return NextResponse.json({ result });
  } catch (e) {
    const { message, status } = describeError(e);
    return jsonError(message, status);
  }
}
