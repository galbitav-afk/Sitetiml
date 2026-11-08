"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { supabase } from "@/lib/supabase";
import { localDb } from "@/lib/local-db";
import { useLessons } from "@/lib/data";
import { useAuth } from "@/components/providers";
import { useRecorder } from "@/components/recorder-provider";
import { Modal, Spinner, useToast } from "@/components/ui";

export default function SettingsPage() {
  const { user, displayName } = useAuth();
  const toast = useToast();
  const rec = useRecorder();
  const [name, setName] = useState(displayName);
  const [saving, setSaving] = useState(false);
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const { data: lessons } = useLessons();
  const chunks = useLiveQuery(() => localDb.chunks.toArray());

  useEffect(() => setName(displayName), [displayName]);
  useEffect(() => {
    void navigator.storage?.estimate?.().then((e) => setUsage({ used: e.usage ?? 0, quota: e.quota ?? 0 }));
  }, [chunks?.length]);

  const localBytes = (chunks ?? []).reduce((s, c) => s + (c.blob?.size ?? 0), 0);
  const readyIds = new Set((lessons ?? []).filter((l) => l.status === "ready").map((l) => l.id));
  const clearable = (chunks ?? []).filter((c) => readyIds.has(c.lessonId));

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase().auth.updateUser({ data: { name: name.trim() } });
    setSaving(false);
    if (error) toast(error.message, "error");
    else {
      toast("נשמר ✓", "success");
      await supabase().auth.refreshSession();
    }
  }

  async function clearAudio() {
    setConfirmClear(false);
    await localDb.chunks.bulkDelete(clearable.map((c) => c.id));
    toast("ההקלטות נמחקו מהמחשב. התמלולים והסיכומים נשארו בענן.", "success");
  }

  async function signOut() {
    if (rec.status !== "idle") return toast("יש הקלטה פעילה. סיים אותה לפני היציאה.", "error");
    await supabase().auth.signOut();
  }

  const mb = (b: number) => `${(b / 1024 / 1024).toFixed(b > 1024 ** 3 ? 0 : 1)}MB`;

  return (
    <div className="space-y-5 max-w-2xl">
      <h1 className="font-display text-3xl font-bold">הגדרות</h1>

      <section className="card p-5 sm:p-6 space-y-4">
        <h2 className="font-display text-xl font-bold">👤 החשבון שלי</h2>
        <p className="text-sm text-muted">מחובר כ-<span className="ltr font-medium text-ink">{user?.email}</span></p>
        <form onSubmit={saveName} className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="label" htmlFor="display-name">איך לקרוא לך?</label>
            <input id="display-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <button className="btn btn-primary" disabled={saving || !name.trim()}>{saving && <Spinner className="w-4 h-4" />} שמירה</button>
        </form>
        <button className="btn btn-ghost" onClick={signOut}>יציאה מהחשבון</button>
      </section>

      <section className="card p-5 sm:p-6 space-y-3">
        <h2 className="font-display text-xl font-bold">💾 אחסון במחשב הזה</h2>
        <p className="text-sm text-muted leading-relaxed">
          ההקלטות עצמן נשמרות רק במחשב שבו הוקלטו, ומשמשות להשמעה. התמלולים, הסיכומים, המבחנים והכרטיסיות שמורים בענן וזמינים מכל מכשיר.
        </p>
        <div className="grid grid-cols-2 gap-3 text-center">
          <div className="rounded-xl bg-royal-soft p-3">
            <div className="text-xl font-bold">{mb(localBytes)}</div>
            <div className="text-xs text-muted">הקלטות שמורות ({chunks?.length ?? 0} קטעים)</div>
          </div>
          <div className="rounded-xl bg-royal-soft p-3">
            <div className="text-xl font-bold">{usage ? mb(Math.max(0, usage.quota - usage.used)) : "…"}</div>
            <div className="text-xs text-muted">מקום פנוי לאתר בדפדפן</div>
          </div>
        </div>
        <button className="btn btn-ghost" disabled={!clearable.length} onClick={() => setConfirmClear(true)}>
          🧹 פינוי הקלטות של שיעורים מוכנים ({mb(clearable.reduce((s, c) => s + c.blob.size, 0))})
        </button>
      </section>

      <section className="card p-5 sm:p-6 space-y-2 text-sm text-muted">
        <h2 className="font-display text-xl font-bold text-ink">ℹ️ טיפים לשיעורים ארוכים</h2>
        <p>• חבר את המחשב לחשמל, ובהגדרות החשמל בטל שינה אוטומטית בזמן השיעור.</p>
        <p>• אפשר לגלוש באתר בזמן ההקלטה. רק לא לסגור את הלשונית או את הדפדפן.</p>
        <p>• בשיעור בזום, בחר “שמע מהמחשב” באולפן ההקלטה. כך הקול מגיע ישירות, נקי ובלי רעשי רקע.</p>
        <p>• העיבוד רץ ברקע כל עוד האתר פתוח באחת הלשוניות.</p>
      </section>

      <Modal open={confirmClear} onClose={() => setConfirmClear(false)} title="לפנות הקלטות?">
        <p className="text-muted mb-5">יימחקו מהמחשב ההקלטות של שיעורים שכבר סוכמו. התמלול, הסיכום והמבחנים יישארו. רק השמעת הקול תיעלם.</p>
        <div className="flex gap-2">
          <button className="btn btn-danger" onClick={clearAudio}>פינוי</button>
          <button className="btn btn-ghost" onClick={() => setConfirmClear(false)}>ביטול</button>
        </div>
      </Modal>
    </div>
  );
}
