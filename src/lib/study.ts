import type { Flashcard, Question, QuizAttempt } from "./types";

/* ---------- Spaced repetition (Leitner boxes) ---------- */

const BOX_DAYS = [0, 1, 3, 7, 14, 30]; // index = box

export function reviewCard(card: Pick<Flashcard, "box">, knew: boolean) {
  const box = knew ? Math.min(5, card.box + 1) : 1;
  const due = knew
    ? new Date(Date.now() + BOX_DAYS[box] * 86_400_000)
    : new Date(Date.now() + 10 * 60_000); // see it again in this session
  return { box, due_at: due.toISOString() };
}

export const isDue = (c: Pick<Flashcard, "due_at">) => new Date(c.due_at).getTime() <= Date.now();

/* ---------- Quiz helpers ---------- */

/** Drops malformed questions and normalises the rest (models occasionally slip). */
export function sanitizeQuestions(qs: Question[] | null | undefined): Question[] {
  if (!Array.isArray(qs)) return [];
  return qs
    .filter(
      (q) =>
        q &&
        typeof q.question === "string" &&
        Array.isArray(q.options) &&
        q.options.length >= 2 &&
        Number.isInteger(q.correctIndex) &&
        q.correctIndex >= 0 &&
        q.correctIndex < q.options.length,
    )
    .map((q) => ({
      ...q,
      options: q.options.map(String),
      explanation: q.explanation ?? "",
      topic: (q.topic || "כללי").trim(),
    }));
}

export function scoreOf(questions: Question[], answers: number[]) {
  if (!questions.length) return 0;
  const correct = questions.filter((q, i) => answers[i] === q.correctIndex).length;
  return Math.round((correct / questions.length) * 100);
}

export interface TopicStat {
  topic: string;
  correct: number;
  total: number;
  pct: number;
}

export function topicStats(attempts: Pick<QuizAttempt, "questions" | "answers">[]): TopicStat[] {
  const map = new Map<string, { correct: number; total: number }>();
  for (const a of attempts) {
    a.questions.forEach((q, i) => {
      const t = (q.topic || "כללי").trim();
      const s = map.get(t) ?? { correct: 0, total: 0 };
      s.total++;
      if (a.answers[i] === q.correctIndex) s.correct++;
      map.set(t, s);
    });
  }
  return [...map.entries()]
    .map(([topic, s]) => ({ topic, ...s, pct: Math.round((s.correct / s.total) * 100) }))
    .sort((a, b) => a.pct - b.pct);
}

export const weakTopics = (stats: TopicStat[]) =>
  stats.filter((s) => s.total >= 2 && s.pct < 70).map((s) => s.topic);

/** Wrong answers from recent attempts, newest first, de-duplicated. */
export function collectMistakes(attempts: Pick<QuizAttempt, "questions" | "answers">[], max = 20): Question[] {
  const seen = new Set<string>();
  const out: Question[] = [];
  for (const a of attempts) {
    a.questions.forEach((q, i) => {
      if (a.answers[i] !== q.correctIndex && !seen.has(q.question)) {
        seen.add(q.question);
        out.push(q);
      }
    });
  }
  return out.slice(0, max);
}

/** Shuffle option order so retakes aren't memorised by position. */
export function shuffleQuestion(q: Question): Question {
  const order = q.options.map((_, i) => i).sort(() => Math.random() - 0.5);
  return {
    ...q,
    options: order.map((i) => q.options[i]),
    correctIndex: order.indexOf(q.correctIndex),
  };
}
