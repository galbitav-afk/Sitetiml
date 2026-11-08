import { NextResponse } from "next/server";
import { requireUser, jsonError as errorResponse } from "@/lib/server/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Proxies one audio chunk to an OpenAI-compatible speech-to-text endpoint
 * (OpenAI by default; Groq or any compatible service via TRANSCRIBE_BASE_URL).
 * Keeps the API key on the server.
 */
export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth.error) return auth.error;

  const apiKey = process.env.TRANSCRIBE_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return errorResponse("חסר מפתח לשירות התמלול (OPENAI_API_KEY או TRANSCRIBE_API_KEY).", 424);
  }
  const baseUrl = (process.env.TRANSCRIBE_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.TRANSCRIBE_MODEL || "gpt-4o-transcribe";
  const language = process.env.TRANSCRIBE_LANGUAGE || "he";

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) return errorResponse("לא התקבל קובץ שמע", 400);
  const prompt = String(form?.get("prompt") ?? "").slice(0, 800);

  const upstream = new FormData();
  upstream.append("file", file, file.name);
  upstream.append("model", model);
  upstream.append("language", language);
  upstream.append("response_format", "json");
  if (prompt) upstream.append("prompt", prompt);

  try {
    const res = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstream,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) {
        return errorResponse("מפתח שירות התמלול שגוי או שאין בו קרדיט. בדוק את ההגדרות ב-Vercel.", 424);
      }
      // 400 = this particular file was rejected (not worth retrying); others are transient.
      return errorResponse(`שירות התמלול החזיר שגיאה ${res.status}: ${detail.slice(0, 300)}`, res.status === 400 ? 422 : 502);
    }
    const data = (await res.json()) as { text?: string };
    return NextResponse.json({ text: data.text ?? "" });
  } catch (e) {
    return errorResponse(`שגיאת רשת מול שירות התמלול: ${e instanceof Error ? e.message : e}`, 502);
  }
}
