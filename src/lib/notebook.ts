"use client";

import { runTaskWithRetry } from "./ai-client";
import { updateCourse, type DigestLesson } from "./data";
import { courseDigestText, lessonDigestText } from "./context";
import type { Course, KeyTerm, Notebook } from "./types";

/**
 * Builds the course notebook in small steps so no single AI call is huge
 * (works for a full semester of 3-hour lessons):
 *   1. outline (chapters by topic, which lessons feed each)
 *   2. each chapter written in parallel from just its lessons
 *   3. glossary merged locally, exam-prep page last
 */
export async function buildNotebook(
  course: Course,
  lessons: DigestLesson[],
  onProgress: (text: string, ratio: number) => void,
): Promise<Notebook> {
  if (!lessons.length) throw new Error("אין עדיין שיעורים מסוכמים בקורס.");
  onProgress("בונה את מבנה המחברת…", 0.05);
  const outline = await runTaskWithRetry("notebook-outline", {
    courseName: course.name,
    lessons: courseDigestText(lessons, { full: false }),
  });

  const chapters: Notebook["chapters"] = new Array(outline.chapters.length);
  let done = 0;
  const queue = outline.chapters.map((ch, i) => ({ ch, i }));
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const { ch, i } = item;
      const nums = ch.lessonNumbers.filter((n) => n >= 1 && n <= lessons.length);
      const source = (nums.length ? nums : lessons.map((_, k) => k + 1)).map((n) => lessonDigestText(lessons[n - 1], n));
      const r = await runTaskWithRetry("notebook-chapter", {
        courseName: course.name,
        chapterTitle: ch.title,
        focus: ch.focus,
        material: source.join("\n\n---\n\n"),
      });
      chapters[i] = { title: ch.title, lessonNumbers: nums, content: r.content };
      done++;
      onProgress(`כותב פרקים… (${done}/${outline.chapters.length})`, 0.1 + 0.75 * (done / outline.chapters.length));
    }
  };
  await Promise.all([worker(), worker(), worker()]);

  onProgress("מכין דף הכנה למבחן…", 0.9);
  const prep = await runTaskWithRetry("exam-prep", {
    courseName: course.name,
    material: [
      `פרקי המחברת: ${outline.chapters.map((c) => c.title).join(" · ")}`,
      ...lessons.map((l, i) =>
        [`שיעור ${i + 1}: ${l.title}`, l.summary?.overview ?? "", `עיקרים: ${(l.summary?.takeaways ?? []).join(" | ")}`].join("\n"),
      ),
    ].join("\n\n"),
  });

  const notebook: Notebook = {
    title: outline.title,
    introduction: outline.introduction,
    chapters,
    glossary: mergeGlossary(lessons.flatMap((l) => l.summary?.keyTerms ?? [])),
    examPrep: prep.examPrep,
  };
  await updateCourse(course.id, {
    notebook,
    notebook_updated_at: new Date().toISOString(),
    notebook_lesson_ids: lessons.map((l) => l.id),
  });
  onProgress("מוכן!", 1);
  return notebook;
}

export function mergeGlossary(terms: KeyTerm[]): KeyTerm[] {
  const map = new Map<string, KeyTerm>();
  for (const t of terms) {
    const key = t.term.trim().replace(/["'״׳]/g, "").toLowerCase();
    if (!key) continue;
    const prev = map.get(key);
    if (!prev || t.definition.length > prev.definition.length) map.set(key, { term: t.term.trim(), definition: t.definition.trim() });
  }
  return [...map.values()].sort((a, b) => a.term.localeCompare(b.term, "he"));
}

export function notebookMarkdown(course: Course, nb: Notebook | null, lessons: DigestLesson[]) {
  const out: string[] = [`# ${nb?.title || course.name}`, ""];
  if (nb) {
    out.push(nb.introduction, "");
    nb.chapters.forEach((c, i) => out.push(`## פרק ${i + 1}: ${c.title}`, "", c.content, ""));
    out.push("## מילון מושגים", "", ...nb.glossary.map((g) => `- **${g.term}**: ${g.definition}`), "");
    out.push("## הכנה למבחן", "", nb.examPrep, "", "---", "");
  }
  out.push("# סיכומים לפי שיעור", "");
  lessons.forEach((l, i) => out.push(lessonDigestText(l, i + 1).replace(/^# /, "## "), ""));
  return out.join("\n");
}
