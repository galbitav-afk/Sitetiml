export function formatClock(totalSec: number) {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  const ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "1:02:30" | "12:30" | "45" → seconds (NaN if unparsable). */
export function parseClock(s: string | undefined): number {
  if (!s) return NaN;
  const parts = s.trim().replace(/[[\]()]/g, "").split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return NaN;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function formatDate(ts: string | number) {
  return new Date(ts).toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDuration(totalSec: number) {
  const m = Math.round(totalSec / 60);
  if (m < 1) return "פחות מדקה";
  if (m < 60) return `${m} דק׳`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} שע׳ ${m % 60} דק׳` : `${h} שע׳`;
}

export function daysUntil(date: string) {
  const target = new Date(date + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "לילה טוב";
  if (h < 12) return "בוקר טוב";
  if (h < 17) return "צהריים טובים";
  if (h < 21) return "ערב טוב";
  return "לילה טוב";
}

/** Snippet of `text` around the first match of `q`. */
export function snippet(text: string, q: string, radius = 90) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, i - radius);
  const end = Math.min(text.length, i + q.length + radius);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

export const COURSE_COLORS = ["#4c2a85", "#0e7490", "#047857", "#b45309", "#be123c", "#7c3aed", "#1d4ed8", "#a21caf"];

/** Text containing any Hebrew reads RTL; pure Latin/math gets "auto" (LTR). */
export function textDir(s: string): "rtl" | "auto" {
  return /[֐-׿]/.test(s) ? "rtl" : "auto";
}
