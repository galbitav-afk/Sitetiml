import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

/**
 * One structured-output call to Claude. Streams under the hood (long lectures
 * mean long inputs/outputs) and returns the object validated against `schema`.
 * Server-side fallback is enabled so a rare policy decline is retried on
 * Anthropic's recommended substitute model instead of failing the lesson.
 */
export async function generateStructured<T extends z.ZodType>(opts: {
  system: string;
  prompt: string;
  schema: T;
}): Promise<z.infer<T>> {
  const stream = client.beta.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 64000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: betaZodOutputFormat(opts.schema),
    },
    system: opts.system,
    messages: [{ role: "user", content: opts.prompt }],
  });
  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new Error("המודל סירב לעבד את התוכן הזה.");
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error("התשובה נקטעה (ארוכה מדי). נסה שוב.");
  }
  if (!message.parsed_output) {
    throw new Error("לא התקבל פלט תקין מהמודל.");
  }
  return message.parsed_output as z.infer<T>;
}

export function describeError(e: unknown): { message: string; status: number } {
  if (e instanceof Anthropic.AuthenticationError) {
    return { message: "מפתח ה-API של Anthropic שגוי או חסר (ANTHROPIC_API_KEY).", status: 500 };
  }
  if (e instanceof Anthropic.RateLimitError) {
    return { message: "חרגת ממגבלת הקצב של Claude. נסה שוב בעוד דקה.", status: 429 };
  }
  if (e instanceof Anthropic.BadRequestError) {
    return { message: `בקשה לא תקינה ל-Claude: ${e.message}`, status: 400 };
  }
  if (e instanceof Anthropic.APIError) {
    return { message: `שגיאת Claude (${e.status}): ${e.message}`, status: 502 };
  }
  return { message: e instanceof Error ? e.message : String(e), status: 500 };
}
