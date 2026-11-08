"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "./providers";
import { useRecorder } from "./recorder-provider";
import { Logo, PageLoader } from "./ui";
import { isConfigured } from "@/lib/supabase";
import { useCourses, useFlashcards } from "@/lib/data";
import { isDue } from "@/lib/study";
import { formatClock } from "@/lib/format";

const PUBLIC_ROUTES = ["/login", "/reset-password"];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, recovery } = useAuth();
  const isPublic = PUBLIC_ROUTES.some((r) => pathname.startsWith(r));

  useEffect(() => {
    if (!isConfigured || loading) return;
    if (recovery && pathname !== "/reset-password") router.replace("/reset-password");
    else if (!user && !isPublic) router.replace("/login");
    else if (user && pathname === "/login") router.replace("/");
  }, [user, loading, isPublic, pathname, router, recovery]);

  if (!isConfigured) return <SetupNeeded />;
  if (isPublic) return <>{children}</>;
  if (loading || !user) return <PageLoader label="נכנסים לממלכה…" />;

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_1fr]">
      <Sidebar />
      <div className="min-w-0 flex flex-col min-h-dvh">
        <MobileTopBar />
        <RecordingBar />
        <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-10 py-6 lg:py-8 pb-28 lg:pb-12">
          {children}
        </main>
      </div>
      <MobileNav />
    </div>
  );
}

function SetupNeeded() {
  return (
    <div className="min-h-dvh grid place-items-center p-6">
      <div className="card max-w-lg p-8 space-y-3 text-center">
        <div className="flex justify-center"><Logo /></div>
        <h1 className="font-display text-2xl font-bold">האתר עוד לא מחובר לענן</h1>
        <p className="text-muted">
          חסרים משתני הסביבה <code className="ltr">NEXT_PUBLIC_SUPABASE_URL</code> ו-
          <code className="ltr">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>. ההוראות המלאות נמצאות בקובץ{" "}
          <code className="ltr">docs/SETUP.md</code>.
        </p>
      </div>
    </div>
  );
}

function NavLink({ href, icon, label, exact }: { href: string; icon: string; label: string; exact?: boolean }) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 font-medium transition ${
        active ? "bg-royal-soft text-royal" : "text-muted hover:text-ink hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)]"
      }`}
    >
      <span className="text-lg w-6 text-center" aria-hidden>{icon}</span>
      <span className="truncate">{label}</span>
    </Link>
  );
}

function Sidebar() {
  const { data: courses } = useCourses();
  const { data: cards } = useFlashcards();
  const due = cards?.filter(isDue).length ?? 0;
  const pathname = usePathname();
  const { displayName } = useAuth();
  return (
    <aside className="hidden lg:flex flex-col gap-5 sticky top-0 h-dvh border-e border-line bg-card/60 backdrop-blur px-4 py-5 no-print">
      <Link href="/" className="px-1"><Logo /></Link>
      <Link href="/record" className="btn btn-record w-full">🎙️ הקלטה חדשה</Link>
      <nav className="flex flex-col gap-1" aria-label="ניווט ראשי">
        <NavLink href="/" icon="🏰" label="הממלכה" exact />
        <NavLink href="/search" icon="🔍" label="חיפוש" />
        <NavLink href="/review" icon="🃏" label={due ? `חזרה יומית (${due})` : "חזרה יומית"} />
      </nav>
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="text-xs font-semibold text-muted px-3 mb-1.5">הקורסים שלי</div>
        <div className="flex-1 overflow-y-auto flex flex-col gap-0.5 -mx-1 px-1">
          {courses?.map((c) => {
            const active = pathname.startsWith(`/course/${c.id}`);
            return (
              <Link
                key={c.id}
                href={`/course/${c.id}`}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                  active ? "bg-royal-soft text-royal font-semibold" : "text-ink/80 hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)]"
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color }} />
                <span className="truncate">{c.name}</span>
              </Link>
            );
          })}
          {courses?.length === 0 && <p className="text-xs text-muted px-3">עוד אין קורסים</p>}
        </div>
      </div>
      <div className="border-t border-line pt-3">
        <NavLink href="/settings" icon="⚙️" label={displayName ? `${displayName} · הגדרות` : "הגדרות"} />
      </div>
    </aside>
  );
}

function MobileTopBar() {
  return (
    <header className="lg:hidden sticky top-0 z-30 h-14 px-4 flex items-center justify-between border-b border-line bg-[color-mix(in_srgb,var(--bg)_85%,transparent)] backdrop-blur no-print">
      <Link href="/"><Logo compact /></Link>
      <span className="font-display font-bold">הממלכה של גל</span>
      <Link href="/settings" className="btn btn-quiet btn-sm" aria-label="הגדרות">⚙️</Link>
    </header>
  );
}

function MobileNav() {
  const pathname = usePathname();
  const item = (href: string, icon: string, label: string, exact = false) => {
    const active = exact ? pathname === href : pathname.startsWith(href);
    return (
      <Link href={href} className={`flex flex-col items-center gap-0.5 text-[11px] font-medium py-1 ${active ? "text-royal" : "text-muted"}`}>
        <span className="text-xl" aria-hidden>{icon}</span>
        {label}
      </Link>
    );
  };
  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-line bg-card/95 backdrop-blur grid grid-cols-5 items-end px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] no-print"
      aria-label="ניווט"
    >
      {item("/", "🏰", "בית", true)}
      {item("/search", "🔍", "חיפוש")}
      <Link href="/record" className="flex flex-col items-center -mt-6" aria-label="הקלטה חדשה">
        <span className="grid place-items-center w-14 h-14 rounded-full btn-record text-2xl shadow-xl">🎙️</span>
      </Link>
      {item("/review", "🃏", "חזרה")}
      {item("/settings", "👤", "אני")}
    </nav>
  );
}

/** Floating "recording in progress" bar on every page except the studio itself. */
function RecordingBar() {
  const rec = useRecorder();
  const pathname = usePathname();
  if (rec.status === "idle" || pathname.startsWith("/record")) return null;
  return (
    <div className="sticky top-14 lg:top-0 z-30 bg-red-600 text-white no-print">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-10 py-2 flex items-center gap-3 text-sm">
        <span className={`w-2.5 h-2.5 rounded-full bg-white ${rec.status === "recording" ? "blink" : ""}`} />
        <span className="font-semibold">{rec.status === "paused" ? "ההקלטה מושהית" : "מקליט"}</span>
        <span className="ltr tabular-nums font-bold">{formatClock(rec.elapsed)}</span>
        <span className="truncate opacity-90 hidden sm:inline">· {rec.lessonTitle}</span>
        {rec.noSound && <span className="chip bg-white text-red-700">לא נקלט קול!</span>}
        <Link href="/record" className="ms-auto btn btn-sm bg-white/15 hover:bg-white/25 text-white">חזרה לאולפן</Link>
      </div>
    </div>
  );
}
