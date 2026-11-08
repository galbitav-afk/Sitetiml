"use client";

import { useEffect, useRef, useState } from "react";
import { askChat } from "@/lib/ai-client";
import Markdown from "./markdown";
import { Spinner } from "./ui";

type Msg = { role: "user" | "assistant"; content: string };

/** "Ask the lesson / course" chat. Context is built lazily on first question. */
export default function ChatPanel(props: {
  storageKey: string;
  courseName: string;
  buildContext: () => Promise<string>;
  suggestions: string[];
  intro: string;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const contextRef = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(props.storageKey);
      if (saved) setMessages(JSON.parse(saved));
    } catch {
      /* ignore */
    }
  }, [props.storageKey]);

  useEffect(() => {
    try {
      sessionStorage.setItem(props.storageKey, JSON.stringify(messages.slice(-40)));
    } catch {
      /* ignore */
    }
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, props.storageKey]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    const history: Msg[] = [...messages, { role: "user", content: q }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      contextRef.current ??= await props.buildContext();
      await askChat(
        { courseName: props.courseName, context: contextRef.current, messages: history.slice(-20) },
        (full) => setMessages([...history, { role: "assistant", content: full }]),
        ac.signal,
      );
    } catch (e) {
      if (!ac.signal.aborted) {
        setMessages([...history, { role: "assistant", content: `⚠️ ${e instanceof Error ? e.message : e}` }]);
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="card flex flex-col h-[min(70vh,44rem)]">
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
        {!messages.length && (
          <div className="text-center py-6 space-y-4">
            <div className="text-4xl" aria-hidden>💬</div>
            <p className="text-muted max-w-md mx-auto">{props.intro}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {props.suggestions.map((s) => (
                <button key={s} className="btn btn-ghost btn-sm" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}>
            <div
              className={`max-w-[88%] rounded-2xl px-4 py-2.5 ${
                m.role === "user" ? "bg-royal text-white rounded-ss-sm" : "bg-royal-soft/60 rounded-se-sm"
              }`}
            >
              {m.role === "assistant" ? (
                m.content ? <Markdown>{m.content}</Markdown> : <span className="flex items-center gap-2 text-muted"><Spinner className="w-4 h-4" /> חושב…</span>
              ) : (
                <p className="whitespace-pre-wrap">{m.content}</p>
              )}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form
        className="border-t border-line p-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input className="input" placeholder="שאל כל דבר על החומר…" value={input} onChange={(e) => setInput(e.target.value)} />
        {busy ? (
          <button type="button" className="btn btn-ghost" onClick={() => abortRef.current?.abort()}>עצור</button>
        ) : (
          <button className="btn btn-primary" disabled={!input.trim()}>שלח</button>
        )}
        {messages.length > 0 && !busy && (
          <button type="button" className="btn btn-quiet" onClick={() => setMessages([])} title="שיחה חדשה" aria-label="שיחה חדשה">🗑</button>
        )}
      </form>
    </div>
  );
}
