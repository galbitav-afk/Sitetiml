import type { LessonStatus } from "@/lib/db";

const MAP: Record<LessonStatus, { label: string; cls: string }> = {
  recording: { label: "● בהקלטה", cls: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
  transcribing: { label: "מתמלל…", cls: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  summarizing: { label: "מסכם…", cls: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300" },
  ready: { label: "מוכן", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  error: { label: "שגיאה", cls: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" },
};

export default function StatusBadge({ status }: { status: LessonStatus }) {
  const s = MAP[status];
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>;
}
