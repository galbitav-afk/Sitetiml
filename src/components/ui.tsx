"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { LessonStatus } from "@/lib/types";

/* ---------- Logo ---------- */

export function Crown({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden fill="none">
      <path
        d="M4 11.5l6 5 6-9 6 9 6-5-2.2 13.2a2 2 0 0 1-2 1.7H8.2a2 2 0 0 1-2-1.7L4 11.5z"
        fill="currentColor"
      />
      <circle cx="4" cy="10" r="2.2" fill="currentColor" />
      <circle cx="16" cy="6" r="2.4" fill="currentColor" />
      <circle cx="28" cy="10" r="2.2" fill="currentColor" />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid place-items-center w-9 h-9 rounded-xl bg-royal text-gold shadow-md">
        <Crown className="w-5 h-5" />
      </span>
      {!compact && (
        <span className="leading-tight">
          <span className="block font-display font-bold text-lg">הממלכה של גל</span>
          <span className="block text-[11px] text-muted -mt-0.5">סיכומים · מבחנים · הצלחה</span>
        </span>
      )}
    </span>
  );
}

/* ---------- Small pieces ---------- */

export function Spinner({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" opacity=".2" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function PageLoader({ label = "טוען…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-24 text-muted">
      <Spinner /> {label}
    </div>
  );
}

export function Progress({ value, indeterminate }: { value?: number; indeterminate?: boolean }) {
  return (
    <div
      className={`progress ${indeterminate ? "progress-indeterminate" : ""}`}
      role="progressbar"
      aria-valuenow={indeterminate ? undefined : Math.round((value ?? 0) * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${Math.round((value ?? 0) * 100)}%` }} />
    </div>
  );
}

export function EmptyState(props: { icon: string; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="card p-8 sm:p-10 text-center flex flex-col items-center gap-3">
      <div className="text-5xl" aria-hidden>{props.icon}</div>
      <h3 className="font-display text-xl font-bold">{props.title}</h3>
      {props.text && <p className="text-muted max-w-md">{props.text}</p>}
      {props.action}
    </div>
  );
}

const STATUS: Record<LessonStatus, { label: string; cls: string }> = {
  recording: { label: "● בהקלטה", cls: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
  transcribing: { label: "מתמלל…", cls: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  summarizing: { label: "מסכם…", cls: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300" },
  ready: { label: "מוכן", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  error: { label: "דורש טיפול", cls: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" },
};

export function StatusBadge({ status }: { status: LessonStatus }) {
  const s = STATUS[status];
  return <span className={`chip ${s.cls}`}>{s.label}</span>;
}

export function Stat(props: { label: string; value: React.ReactNode; icon: string; tone?: "royal" | "gold" }) {
  return (
    <div className="card p-4 flex items-center gap-3">
      <div
        className={`grid place-items-center w-11 h-11 rounded-xl text-xl shrink-0 ${
          props.tone === "gold" ? "bg-gold-soft" : "bg-royal-soft"
        }`}
        aria-hidden
      >
        {props.icon}
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-bold leading-none tabular-nums">{props.value}</div>
        <div className="text-xs text-muted mt-1">{props.label}</div>
      </div>
    </div>
  );
}

/* ---------- Modal ---------- */

export function Modal(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (props.open && !d.open) d.showModal();
    if (!props.open && d.open) d.close();
  }, [props.open]);
  return (
    <dialog
      ref={ref}
      onClose={props.onClose}
      onClick={(e) => e.target === ref.current && props.onClose()}
      className={`m-auto w-[calc(100%-2rem)] ${props.wide ? "max-w-2xl" : "max-w-lg"} rounded-2xl bg-card text-ink p-0 shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm`}
    >
      {props.open && (
        <div className="p-5 sm:p-6 rise">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-xl font-bold">{props.title}</h2>
            <button className="btn btn-quiet btn-sm" onClick={props.onClose} aria-label="סגירה">
              ✕
            </button>
          </div>
          {props.children}
        </div>
      )}
    </dialog>
  );
}

/* ---------- Toasts ---------- */

type Toast = { id: number; text: string; tone: "info" | "error" | "success" };
const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-24 lg:bottom-6 inset-x-0 z-[60] flex flex-col items-center gap-2 pointer-events-none px-4" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rise pointer-events-auto max-w-md w-full rounded-xl px-4 py-3 shadow-lg text-sm font-medium ${
              t.tone === "error"
                ? "bg-danger text-white"
                : t.tone === "success"
                  ? "bg-success text-white"
                  : "bg-ink text-bg"
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- Tabs (URL-synced) ---------- */

export function Tabs<T extends string>(props: {
  tabs: { id: T; label: string; badge?: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={`tabbar no-print ${props.className ?? ""}`}>
      {props.tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={props.value === t.id}
          className="tab"
          onClick={() => props.onChange(t.id)}
        >
          {t.label}
          {t.badge != null && <span className="ms-1.5 opacity-80">{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}
