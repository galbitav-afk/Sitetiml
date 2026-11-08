import { formatClock, formatDate } from "./format";
import type { DigestLesson } from "./data";
import type { Lesson, Segment } from "./types";

/* Builders for the text context sent to Claude (chat, exams, notebook, plan). */

export function lessonDigestText(l: DigestLesson, n: number, opts: { full?: boolean } = {}) {
  const s = l.summary;
  if (!s) return "";
  const lines = [`# שיעור ${n}: ${l.title} (${formatDate(l.created_at)})`, s.overview];
  if (opts.full !== false) {
    for (const sec of s.sections) {
      lines.push(`## ${sec.heading}${sec.startSec != null ? ` [${formatClock(sec.startSec)}]` : ""}\n${sec.content}`);
    }
    if (s.keyTerms.length) lines.push(`מושגים: ${s.keyTerms.map((k) => `${k.term}: ${k.definition}`).join(" | ")}`);
    if (s.takeaways.length) lines.push(`עיקרים: ${s.takeaways.join(" | ")}`);
  } else {
    lines.push(`נושאים: ${s.sections.map((x) => x.heading).join(" · ")}`);
  }
  return lines.join("\n\n");
}

export function courseDigestText(lessons: DigestLesson[], opts: { full?: boolean } = {}) {
  return lessons.map((l, i) => lessonDigestText(l, i + 1, opts)).filter(Boolean).join("\n\n---\n\n");
}

export function lessonChatContext(lesson: Lesson, segments: Segment[]) {
  const parts: string[] = [];
  if (lesson.summary) parts.push(`<summary>\n${lessonDigestText(lesson, 1)}\n</summary>`);
  const transcript = segments
    .filter((s) => !s.silent && s.text.trim())
    .map((s) => `[${formatClock(s.start_sec)}] ${s.text}`)
    .join("\n");
  if (transcript) parts.push(`<transcript lesson="${lesson.title}">\n${transcript}\n</transcript>`);
  return parts.join("\n\n") || "(אין עדיין חומר לשיעור הזה)";
}
