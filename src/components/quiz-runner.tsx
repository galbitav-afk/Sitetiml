"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Question } from "@/lib/types";
import { scoreOf, topicStats } from "@/lib/study";
import { formatClock, textDir } from "@/lib/format";
import { Progress } from "./ui";

const LETTERS = ["א", "ב", "ג", "ד", "ה", "ו"];

/**
 * One question per screen. "practice": instant feedback + explanation after
 * each answer. "exam": no feedback until the end, optional countdown.
 */
export default function QuizRunner(props: {
  questions: Question[];
  mode: "practice" | "exam";
  timeLimitSec?: number;
  title?: string;
  onFinish: (answers: number[], durationSec: number) => void | Promise<void>;
  onRetryMistakes?: (wrong: Question[]) => void;
  onRestart?: () => void;
}) {
  const { questions, mode } = props;
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<number[]>(() => questions.map(() => -1));
  const [revealed, setRevealed] = useState(false);
  const [finished, setFinished] = useState(false);
  const startedAt = useRef(Date.now());
  const [now, setNow] = useState(Date.now());

  const q = questions[i];
  const chosen = answers[i];

  const finish = async (final = answers) => {
    if (finished) return;
    setFinished(true);
    await props.onFinish(final, Math.round((Date.now() - startedAt.current) / 1000));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Countdown for timed exams.
  useEffect(() => {
    if (!props.timeLimitSec || finished) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [props.timeLimitSec, finished]);
  const remaining = props.timeLimitSec ? props.timeLimitSec - Math.floor((now - startedAt.current) / 1000) : null;
  useEffect(() => {
    if (remaining !== null && remaining <= 0 && !finished) void finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, finished]);

  const choose = (oi: number) => {
    if (finished || (mode === "practice" && revealed)) return;
    setAnswers((a) => a.map((v, k) => (k === i ? oi : v)));
    if (mode === "practice") setRevealed(true);
  };

  const next = () => {
    setRevealed(false);
    if (i < questions.length - 1) setI(i + 1);
    else void finish();
  };

  // Keyboard: 1-4 to answer, Enter for next.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (finished || (e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      const n = Number(e.key);
      if (n >= 1 && n <= (q?.options.length ?? 0)) choose(n - 1);
      if (e.key === "Enter" && chosen >= 0) next();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const score = useMemo(() => scoreOf(questions, answers), [questions, answers]);

  if (finished) {
    const stats = topicStats([{ questions, answers }]);
    const wrong = questions.filter((qq, k) => answers[k] !== qq.correctIndex);
    return (
      <div className="space-y-5 rise">
        <div className="card p-6 sm:p-8 text-center space-y-3">
          <ScoreRing pct={score} />
          <p className="text-lg font-semibold">
            {questions.length - wrong.length} מתוך {questions.length} נכונות
          </p>
          <p className="text-muted">
            {score >= 90 ? "מלכותי! 👑 שולט בחומר." : score >= 75 ? "יפה מאוד! עוד קצת ליטוש 💪" : score >= 55 ? "בדרך הנכונה. כדאי לחזור על הנושאים החלשים 📖" : "שווה לעבור שוב על הסיכום ולנסות שוב 🌱"}
          </p>
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            {wrong.length > 0 && props.onRetryMistakes && (
              <button className="btn btn-gold" onClick={() => props.onRetryMistakes!(wrong)}>🔁 תרגול רק הטעויות ({wrong.length})</button>
            )}
            {props.onRestart && <button className="btn btn-ghost" onClick={props.onRestart}>נסה שוב</button>}
          </div>
        </div>

        {stats.length > 1 && (
          <div className="card p-5">
            <h3 className="font-display font-bold mb-3">לפי נושאים</h3>
            <div className="space-y-2.5">
              {stats.map((s) => (
                <div key={s.topic} className="grid grid-cols-[1fr_auto] gap-x-3 items-center text-sm">
                  <span className="truncate">{s.topic}</span>
                  <span className={`font-semibold tabular-nums ${s.pct < 60 ? "text-danger" : s.pct < 80 ? "text-warning" : "text-success"}`}>{s.correct}/{s.total}</span>
                  <div className="col-span-2"><Progress value={s.pct / 100} /></div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3">
          <h3 className="font-display font-bold">סקירת התשובות</h3>
          {questions.map((qq, k) => (
            <QuestionCard key={k} q={qq} n={k + 1} chosen={answers[k]} revealed />
          ))}
        </div>
      </div>
    );
  }

  if (!q) return null;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex-1"><Progress value={(i + (chosen >= 0 ? 1 : 0)) / questions.length} /></div>
        <span className="text-sm text-muted tabular-nums">{i + 1}/{questions.length}</span>
        {remaining !== null && (
          <span className={`chip ltr tabular-nums ${remaining < 60 ? "bg-rose-100 text-danger" : "bg-royal-soft text-royal"}`}>⏱ {formatClock(Math.max(0, remaining))}</span>
        )}
      </div>

      <QuestionCard q={q} n={i + 1} chosen={chosen} revealed={mode === "practice" && revealed} onChoose={choose} />

      <div className="flex items-center justify-between gap-2">
        <button className="btn btn-quiet" disabled={i === 0} onClick={() => { setRevealed(mode === "practice" && answers[i - 1] >= 0); setI(i - 1); }}>→ הקודמת</button>
        {mode === "exam" && i === questions.length - 1 ? (
          <button className="btn btn-primary" onClick={() => finish()}>הגשת המבחן</button>
        ) : (
          <button className="btn btn-primary" disabled={chosen < 0} onClick={next}>
            {i === questions.length - 1 ? "לתוצאות" : "הבאה ←"}
          </button>
        )}
      </div>
      {mode === "exam" && (
        <div className="flex flex-wrap gap-1.5 justify-center pt-2" aria-label="ניווט בין שאלות">
          {questions.map((_, k) => (
            <button
              key={k}
              onClick={() => setI(k)}
              className={`w-8 h-8 rounded-lg text-xs font-semibold border ${k === i ? "border-royal bg-royal text-white" : answers[k] >= 0 ? "border-royal/40 bg-royal-soft" : "border-line"}`}
              aria-label={`שאלה ${k + 1}`}
            >
              {k + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function QuestionCard(props: { q: Question; n: number; chosen: number; revealed: boolean; onChoose?: (i: number) => void }) {
  const { q, chosen, revealed } = props;
  return (
    <div className="card p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <h3 className="font-semibold text-lg leading-relaxed">
          <span className="text-muted me-1.5">{props.n}.</span>
          <span dir={textDir(q.question)}>{q.question}</span>
        </h3>
        <span className="chip bg-royal-soft text-royal shrink-0">{q.topic}</span>
      </div>
      <div className="grid gap-2">
        {q.options.map((opt, oi) => {
          const isCorrect = oi === q.correctIndex;
          const isChosen = chosen === oi;
          let cls = "border-line hover:border-royal/50 hover:bg-royal-soft/40";
          if (!revealed && isChosen) cls = "border-royal bg-royal-soft ring-1 ring-royal";
          if (revealed && isCorrect) cls = "border-success bg-emerald-50 dark:bg-emerald-950/50";
          if (revealed && isChosen && !isCorrect) cls = "border-danger bg-rose-50 dark:bg-rose-950/50";
          if (revealed && !isChosen && !isCorrect) cls = "border-line opacity-70";
          return (
            <button
              key={oi}
              disabled={!props.onChoose || revealed}
              onClick={() => props.onChoose?.(oi)}
              className={`flex items-start gap-3 text-start border rounded-xl px-4 py-3 transition min-h-12 ${cls}`}
            >
              <span className="grid place-items-center w-7 h-7 rounded-lg bg-card border border-line text-sm font-bold shrink-0">{LETTERS[oi] ?? oi + 1}</span>
              <span dir={textDir(opt)} className="pt-0.5 flex-1 text-start">{opt}</span>
              {revealed && isCorrect && <span className="text-success font-bold">✓</span>}
              {revealed && isChosen && !isCorrect && <span className="text-danger font-bold">✗</span>}
            </button>
          );
        })}
      </div>
      {revealed && (
        <div className="mt-4 rounded-xl bg-gold-soft p-3.5 text-sm leading-relaxed rise">
          <b>💡 הסבר:</b> {q.explanation}
          {q.lessonTitle && <span className="block text-muted mt-1">מתוך: {q.lessonTitle}</span>}
        </div>
      )}
    </div>
  );
}

function ScoreRing({ pct }: { pct: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const color = pct >= 80 ? "var(--success)" : pct >= 60 ? "var(--gold)" : "var(--danger)";
  return (
    <div className="relative w-36 h-36 mx-auto">
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
        <circle cx="60" cy="60" r={r} stroke="var(--line)" strokeWidth="10" fill="none" />
        <circle cx="60" cy="60" r={r} stroke={color} strokeWidth="10" fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} style={{ transition: "stroke-dashoffset 1s ease" }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className="text-4xl font-bold tabular-nums">{pct}%</span>
      </div>
    </div>
  );
}
