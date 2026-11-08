"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/providers";
import { Logo, Spinner } from "@/components/ui";
import { authErrorHe } from "@/lib/auth-errors";

export default function ResetPasswordPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase().auth.updateUser({ password });
    setBusy(false);
    if (error) setError(authErrorHe(error.message));
    else {
      // Leave "recovery" mode with a clean reload into the app.
      router.replace("/");
      setTimeout(() => window.location.assign("/"), 50);
    }
  }

  return (
    <div className="min-h-dvh grid place-items-center p-6">
      <div className="card w-full max-w-sm p-6 space-y-5">
        <div className="flex justify-center"><Logo /></div>
        <h1 className="font-display text-2xl font-bold text-center">בחירת סיסמה חדשה</h1>
        {loading ? (
          <div className="flex justify-center"><Spinner /></div>
        ) : !user ? (
          <p className="text-muted text-center">
            הקישור פג או כבר נוצל. בקש קישור חדש ממסך הכניסה.{" "}
            <a href="/login" className="text-royal underline">למסך הכניסה</a>
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="label" htmlFor="pw">סיסמה חדשה</label>
              <input id="pw" className="input ltr text-left" type="password" minLength={6} required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
            <button className="btn btn-primary w-full" disabled={busy}>
              {busy && <Spinner className="w-4 h-4" />} שמירה וכניסה
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
