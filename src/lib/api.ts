"use client";

import type {
  LessonSummary,
  Notebook,
  NotebookRequest,
  SummarizeRequest,
} from "./schemas";

const PW_KEY = "app-password";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

function headers(extra?: HeadersInit): HeadersInit {
  let pw = "";
  try {
    pw = localStorage.getItem(PW_KEY) ?? "";
  } catch {
    /* storage unavailable */
  }
  return { ...(pw ? { "x-app-password": pw } : {}), ...extra };
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  let res = await fetch(path, { ...init, headers: headers(init.headers) });
  if (res.status === 401) {
    const pw = window.prompt("האתר מוגן בסיסמה. הזן סיסמה:");
    if (pw) {
      try {
        localStorage.setItem(PW_KEY, pw);
      } catch {
        /* ignore */
      }
      res = await fetch(path, { ...init, headers: headers(init.headers) });
    }
  }
  if (!res.ok) {
    let msg = `שגיאה ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* not json */
    }
    throw new ApiError(msg, res.status);
  }
  return res.json() as Promise<T>;
}

export function transcribeChunk(blob: Blob, mime: string, prompt: string) {
  const ext = mime.includes("wav")
    ? "wav"
    : mime.includes("mp4")
      ? "mp4"
      : mime.includes("ogg")
        ? "ogg"
        : "webm";
  const form = new FormData();
  form.append("file", new File([blob], `chunk.${ext}`, { type: mime.split(";")[0] }));
  form.append("prompt", prompt);
  return call<{ text: string }>("/api/transcribe", { method: "POST", body: form });
}

export function summarizeLesson(body: SummarizeRequest) {
  return call<{ summary: LessonSummary }>("/api/summarize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function buildNotebook(body: NotebookRequest) {
  return call<{ notebook: Notebook }>("/api/notebook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
