"use client";

import { accessToken } from "./supabase";
import type { TaskName, TaskOutputs } from "./schemas";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
  /** Worth retrying automatically (network, rate limit, server hiccup). */
  get retryable() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await accessToken();
  if (!token) throw new ApiError("נדרשת התחברות", 401);
  return { authorization: `Bearer ${token}` };
}

async function parseError(res: Response) {
  let msg = `שגיאה ${res.status}`;
  try {
    const body = await res.json();
    if (body?.error) msg = body.error;
  } catch {
    /* not json */
  }
  return new ApiError(msg, res.status);
}

async function safeFetch(input: string, init: RequestInit) {
  try {
    return await fetch(input, init);
  } catch {
    throw new ApiError("אין חיבור לשרת. בדוק את האינטרנט.", 0);
  }
}

export async function runTask<T extends TaskName>(
  task: T,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<TaskOutputs[T]> {
  const res = await safeFetch(`/api/ai/${task}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(input),
    signal,
  });
  if (!res.ok) throw await parseError(res);
  const { result } = await res.json();
  return result as TaskOutputs[T];
}

/** Retries transient failures with backoff (long lectures = many calls). */
export async function runTaskWithRetry<T extends TaskName>(
  task: T,
  input: Record<string, unknown>,
  attempts = 3,
): Promise<TaskOutputs[T]> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await runTask(task, input);
    } catch (e) {
      last = e;
      if (!(e instanceof ApiError) || !e.retryable) throw e;
      await new Promise((r) => setTimeout(r, 3000 * 2 ** i));
    }
  }
  throw last;
}

export async function transcribeAudio(blob: Blob, mime: string, prompt: string) {
  const base = mime.split(";")[0];
  const ext = base.includes("wav")
    ? "wav"
    : base.includes("ogg")
      ? "ogg"
      : base.includes("mp4") || base.includes("m4a")
        ? "mp4"
        : base.includes("mpeg")
          ? "mp3"
          : "webm";
  const form = new FormData();
  form.append("file", new File([blob], `chunk.${ext}`, { type: base }));
  form.append("prompt", prompt);
  const res = await safeFetch("/api/transcribe", {
    method: "POST",
    headers: await authHeaders(),
    body: form,
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { text: string };
}

/** Streams a chat answer; calls onText with the full text so far. */
export async function askChat(
  body: { courseName: string; context: string; messages: { role: "user" | "assistant"; content: string }[] },
  onText: (full: string) => void,
  signal?: AbortSignal,
) {
  const res = await safeFetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw await parseError(res);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    full += decoder.decode(value, { stream: true });
    onText(full);
  }
  return full;
}
