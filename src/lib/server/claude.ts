import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic()); // reads ANTHROPIC_API_KEY

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

type Effort = "low" | "medium" | "high";

/**
 * One structured-output call. Streams under the hood (long lectures mean long
 * inputs/outputs) and returns the object validated against `schema`.
 * Server-side fallback retries a rare policy decline on Anthropic's
 * recommended substitute model instead of failing the lesson.
 */
export async function generateStructured<T extends z.ZodType>(opts: {
  system: string;
  prompt: string;
  schema: T;
  effort?: Effort;
  signal?: AbortSignal;
}): Promise<z.infer<T>> {
  const stream = getClient().beta.messages.stream(
    {
      model: CLAUDE_MODEL,
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: opts.effort ?? "medium", format: betaZodOutputFormat(opts.schema) },
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
    },
    { signal: opts.signal },
  );
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new Error("המודל סירב לעבד את התוכן הזה.");
  if (message.stop_reason === "max_tokens") throw new Error("התשובה נקטעה כי הייתה ארוכה מדי. נסה שוב.");
  if (!message.parsed_output) throw new Error("לא התקבל פלט תקין מהמודל. נסה שוב.");
  return message.parsed_output as z.infer<T>;
}

/**
 * Streams a plain-text chat answer. The (large, stable) course context sits in
 * a cached system block so follow-up questions are cheap and fast.
 */
export function streamChat(opts: {
  system: string;
  context: string;
  messages: { role: "user" | "assistant"; content: string }[];
  signal?: AbortSignal;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        const stream = getClient().beta.messages.stream(
          {
            model: CLAUDE_MODEL,
            max_tokens: 16000,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            thinking: { type: "adaptive" },
            output_config: { effort: "low" },
            system: [
              { type: "text", text: opts.system },
              { type: "text", text: opts.context, cache_control: { type: "ephemeral" } },
            ],
            messages: opts.messages,
          },
          { signal: opts.signal },
        );
        stream.on("text", (delta) => controller.enqueue(encoder.encode(delta)));
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") {
          controller.enqueue(encoder.encode("\n\n(המודל לא יכול לענות על השאלה הזו.)"));
        }
        controller.close();
      } catch (e) {
        controller.enqueue(encoder.encode(`\n\n⚠️ ${describeError(e).message}`));
        controller.close();
      }
    },
  });
}

export function describeError(e: unknown): { message: string; status: number } {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    // 424 = misconfiguration: the client must not retry, it should surface the message.
    return { message: "מפתח ה-API של Anthropic שגוי או חסר (ANTHROPIC_API_KEY).", status: 424 };
  }
  if (e instanceof Anthropic.RateLimitError) {
    return { message: "חרגת ממגבלת הקצב של Claude. נסה שוב בעוד דקה.", status: 429 };
  }
  if (e instanceof Anthropic.BadRequestError) {
    return { message: `בקשה לא תקינה ל-Claude: ${e.message}`, status: 400 };
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return { message: "אין חיבור לשרתי Claude. נסה שוב.", status: 502 };
  }
  if (e instanceof Anthropic.APIError) {
    return { message: `שגיאת Claude (${e.status}): ${e.message}`, status: 502 };
  }
  return { message: e instanceof Error ? e.message : String(e), status: 500 };
}
