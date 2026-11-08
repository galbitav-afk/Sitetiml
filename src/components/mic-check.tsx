"use client";

import { useEffect, useRef, useState } from "react";
import { listMics, micConstraints } from "@/lib/recorder";

/** Device picker + live level meter, so nobody records 3 hours of silence. */
export function MicCheck({ deviceId, onDevice }: { deviceId: string; onDevice: (id: string) => void }) {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loudFrames = useRef(0);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let ctx: AudioContext | undefined;
    let raf = 0;
    let cancelled = false;
    setHeard(false);
    loudFrames.current = 0;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(deviceId || undefined) });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        setError(null);
        setMics(await listMics());
        ctx = new AudioContext();
        const an = ctx.createAnalyser();
        an.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(an);
        const data = new Float32Array(an.fftSize);
        const loop = () => {
          an.getFloatTimeDomainData(data);
          let s = 0;
          for (const v of data) s += v * v;
          const l = Math.min(1, Math.sqrt(s / data.length) * 8);
          setLevel(l);
          if (l > 0.12) loudFrames.current++;
          if (loudFrames.current > 12) setHeard(true);
          raf = requestAnimationFrame(loop);
        };
        loop();
      } catch (e) {
        setError(
          e instanceof DOMException && e.name === "NotAllowedError"
            ? "הדפדפן חוסם את המיקרופון. לחץ על סמל המנעול ליד הכתובת ואפשר מיקרופון."
            : "לא הצלחתי לפתוח את המיקרופון. בחר התקן אחר או חבר מיקרופון.",
        );
      }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(() => {});
    };
  }, [deviceId]);

  return (
    <div className="space-y-3">
      {mics.length > 1 && (
        <div>
          <label className="label" htmlFor="mic">מיקרופון</label>
          <select id="mic" className="select" value={deviceId} onChange={(e) => onDevice(e.target.value)}>
            <option value="">ברירת המחדל של המחשב</option>
            {mics.map((m, i) => (
              <option key={m.deviceId || i} value={m.deviceId}>{m.label || `מיקרופון ${i + 1}`}</option>
            ))}
          </select>
        </div>
      )}
      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : (
        <div className="rounded-xl border border-line p-3 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">בדיקת קול: דבר משהו…</span>
            <span className={heard ? "text-success font-semibold" : "text-muted"}>{heard ? "✓ נשמע מצוין" : "מקשיב…"}</span>
          </div>
          <div className="h-2.5 rounded-full bg-line overflow-hidden">
            <div
              className="h-full rounded-full transition-[width] duration-75"
              style={{ width: `${Math.round(level * 100)}%`, background: level > 0.85 ? "var(--warning)" : "var(--success)" }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
