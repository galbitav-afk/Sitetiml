export function formatClock(totalSec: number) {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  const ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString("he-IL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDuration(totalSec: number) {
  const m = Math.round(totalSec / 60);
  if (m < 60) return `${m} דק׳`;
  return `${Math.floor(m / 60)} שע׳ ${m % 60} דק׳`;
}
