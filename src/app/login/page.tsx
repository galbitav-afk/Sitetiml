"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Crown, Logo, Spinner } from "@/components/ui";
import { authErrorHe } from "@/lib/auth-errors";

type Mode = "signin" | "signup" | "magic" | "forgot";

const FEATURES = [
  ["🎙️", "הקלטה של שיעור שלם", "גם 3 שעות רצוף, מהמיקרופון או מזום"],
  ["📝", "תמלול וסיכום אוטומטי", "סיכום לפי נושאים, כבר במהלך השיעור"],
  ["✅", "מבחנים וכרטיסיות", "תרגול אמיתי, חזרה מרווחת וסימולציות"],
  ["📓", "מחברת לכל קורס", "כל השיעורים במקום אחד, מוכן למבחן"],
];

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    const sb = supabase();
    const origin = window.location.origin;
    try {
      if (mode === "signin") {
        const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else if (mode === "signup") {
        const { data, error } = await sb.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { name: name.trim() }, emailRedirectTo: origin },
        });
        if (error) throw error;
        if (!data.session) setInfo("כמעט סיימנו! שלחנו לך מייל לאישור החשבון. לחץ על הקישור שבו ותיכנס לממלכה.");
      } else if (mode === "magic") {
        const { error } = await sb.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: origin, shouldCreateUser: false } });
        if (error) throw error;
        setInfo("שלחנו לך קישור כניסה למייל. פתח אותו באותו מחשב.");
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${origin}/reset-password` });
        if (error) throw error;
        setInfo("אם המייל רשום אצלנו, נשלח אליו קישור לבחירת סיסמה חדשה.");
      }
    } catch (err) {
      setError(authErrorHe(err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  const titles: Record<Mode, string> = {
    signin: "ברוכים השבים לממלכה",
    signup: "הצטרפות לממלכה",
    magic: "כניסה עם קישור למייל",
    forgot: "איפוס סיסמה",
  };

  return (
    <div className="min-h-dvh grid lg:grid-cols-2">
      {/* Brand panel */}
      <section className="hidden lg:flex flex-col justify-between p-12 bg-royal text-white relative overflow-hidden">
        <Crown className="absolute -left-16 -bottom-16 w-96 h-96 text-white/5" />
        <div className="flex items-center gap-3">
          <span className="grid place-items-center w-11 h-11 rounded-xl bg-white/10 text-gold"><Crown className="w-6 h-6" /></span>
          <span className="font-display text-2xl font-bold">הממלכה של גל</span>
        </div>
        <div className="space-y-8 relative">
          <h1 className="font-display text-4xl xl:text-5xl font-bold leading-tight">
            כל שיעור הופך<br />למחברת מוכנה למבחן.
          </h1>
          <ul className="space-y-5">
            {FEATURES.map(([icon, title, text]) => (
              <li key={title} className="flex gap-4 items-start">
                <span className="grid place-items-center w-11 h-11 rounded-xl bg-white/10 text-xl shrink-0">{icon}</span>
                <span>
                  <span className="block font-semibold">{title}</span>
                  <span className="block text-white/70 text-sm">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-white/50 text-sm">הנתונים של כל משתמש פרטיים לחלוטין.</p>
      </section>

      {/* Form */}
      <section className="flex flex-col items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm space-y-6">
          <div className="lg:hidden flex justify-center"><Logo /></div>
          <div className="space-y-1 text-center lg:text-start">
            <h2 className="font-display text-3xl font-bold">{titles[mode]}</h2>
            <p className="text-muted">
              {mode === "signin" && "התחבר כדי להגיע לקורסים ולסיכומים שלך."}
              {mode === "signup" && "חשבון אישי: הקורסים והסיכומים שלך פרטיים רק לך."}
              {mode === "magic" && "בלי סיסמה: נשלח לך קישור כניסה חד-פעמי."}
              {mode === "forgot" && "נשלח לך קישור לבחירת סיסמה חדשה."}
            </p>
          </div>

          {(mode === "signin" || mode === "signup") && (
            <div className="tabbar" role="tablist">
              <button role="tab" aria-selected={mode === "signin"} className="tab" onClick={() => setMode("signin")}>כניסה</button>
              <button role="tab" aria-selected={mode === "signup"} className="tab" onClick={() => setMode("signup")}>הרשמה</button>
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            {mode === "signup" && (
              <div>
                <label className="label" htmlFor="name">איך לקרוא לך?</label>
                <input id="name" className="input" required autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="גל" />
              </div>
            )}
            <div>
              <label className="label" htmlFor="email">מייל</label>
              <input id="email" className="input ltr text-left" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            {(mode === "signin" || mode === "signup") && (
              <div>
                <div className="flex justify-between items-baseline">
                  <label className="label" htmlFor="password">סיסמה</label>
                  {mode === "signin" && (
                    <button type="button" className="text-xs text-royal hover:underline" onClick={() => setMode("forgot")}>שכחתי סיסמה</button>
                  )}
                </div>
                <input
                  id="password"
                  className="input ltr text-left"
                  type="password"
                  required
                  minLength={6}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {mode === "signup" && <p className="hint">לפחות 6 תווים.</p>}
              </div>
            )}

            {error && <p role="alert" className="text-sm text-danger bg-rose-50 dark:bg-rose-950/40 rounded-lg px-3 py-2">{error}</p>}
            {info && <p role="status" className="text-sm text-success bg-emerald-50 dark:bg-emerald-950/40 rounded-lg px-3 py-2">{info}</p>}

            <button className="btn btn-primary btn-lg w-full" disabled={busy}>
              {busy && <Spinner className="w-4 h-4" />}
              {mode === "signin" && "כניסה"}
              {mode === "signup" && "יצירת חשבון"}
              {mode === "magic" && "שלחו לי קישור"}
              {mode === "forgot" && "שלחו קישור לאיפוס"}
            </button>
          </form>

          <div className="text-center text-sm text-muted space-y-2">
            {mode === "signin" && (
              <button className="hover:text-royal" onClick={() => setMode("magic")}>✉️ כניסה בלי סיסמה (קישור למייל)</button>
            )}
            {(mode === "magic" || mode === "forgot") && (
              <button className="hover:text-royal" onClick={() => setMode("signin")}>→ חזרה לכניסה עם סיסמה</button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
