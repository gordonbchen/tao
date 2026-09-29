"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Eraser, Lightbulb, ListCollapse, Send } from "lucide-react";
import { recentMessages, sinceSummary } from "@/lib/chat-context";
import { api, getAiRequestHeaders, notifyAiSetupRequired, useAISettings } from "./components";
import { MathText } from "./math-text";
import { Button, Card, cn, ErrorMessage, IconButton, Spinner, Textarea } from "./ui";

// A summary stands in for the messages before it when the tutor replies.
export type ChatMessage = { role: "assistant" | "user" | "summary"; text: string };

// Tutor conversation for problems, flashcards, topics, folders, and resources. Remount it with a new `key` for each item.
// `send` returns the tutor's reply. Enter sends; Shift+Enter starts a new line. `hint` adds a lightbulb that sends
// that message, `summarize` adds a button that condenses the conversation so far, and `clear` one that deletes it.
export function Chat({ initialMessages = [], send, placeholder, empty, hint, summarize, clear, className }: {
  initialMessages?: ChatMessage[];
  send: (text: string) => Promise<string>;
  placeholder: string;
  empty: string;
  hint?: string;
  summarize?: () => Promise<string>;
  clear?: () => Promise<void>;
  className?: string;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [text, setText] = useState("");
  // What the chat is waiting for, shown beside a spinner; empty when idle.
  const [busy, setBusy] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);

  // Grow with the text from one line; max-h-40 then scrolls.
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight + element.offsetHeight - element.clientHeight}px`;
  }, [text]);

  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [messages, busy]);

  async function ask(content: string) {
    content = content.trim();
    if (!content || busy) return;
    setText("");
    setMessages((items) => [...items, { role: "user", text: content }]);
    setBusy("Thinking…");
    try {
      const reply = await send(content);
      setMessages((items) => [...items, { role: "assistant", text: reply }]);
    } catch (error) {
      setMessages((items) => [...items, { role: "assistant", text: error instanceof Error ? error.message : "I couldn’t reply just now. Try again in a moment." }]);
    } finally { setBusy(""); }
  }

  // Runs a chat-wide action, showing a failure as a tutor message.
  async function act(action: () => Promise<void>, label: string, failure: string) {
    if (busy) return;
    setBusy(label);
    try { await action(); }
    catch (error) { setMessages((items) => [...items, { role: "assistant", text: error instanceof Error ? error.message : failure }]); }
    finally { setBusy(""); }
  }

  const unsummarized = sinceSummary(messages).messages;
  // The server sends the tutor only what fits `recentMessages`; say when older messages no longer do.
  const leftOut = unsummarized.length > recentMessages(unsummarized).length;
  const summarizeChat = () => {
    if (summarize) void act(async () => { const text = await summarize(); setMessages((items) => [...items, { role: "summary", text }]); }, "Summarizing the chat…", "The chat could not be summarized.");
  };

  return <Card className={cn("flex min-h-80 flex-col", className)}>
    <div ref={log} className="flex flex-1 flex-col gap-3 overflow-auto p-4">
      {!messages.length && !busy && <p className="text-sm text-muted">{empty}</p>}
      {messages.map((message, i) => message.role === "summary"
        ? <div key={i} className="border-y border-line py-3 text-sm"><p className="mb-1 text-xs text-muted">Summary of the conversation above; the tutor now reads this instead</p><MathText className="leading-relaxed whitespace-pre-wrap" text={message.text} /></div>
        : <MathText key={i} className={cn("max-w-[90%] rounded-lg px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap", message.role === "user" ? "self-end bg-accent-soft" : "self-start bg-subtle")} text={message.text} />)}
      {busy && <div className="inline-flex items-center gap-2 self-start rounded-lg bg-subtle px-3 py-2 text-sm text-muted"><Spinner />{busy}</div>}
    </div>
    {summarize && leftOut && !busy && <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-1 text-xs text-muted">
      <span>Older messages no longer reach the tutor.</span><Button variant="ghost" size="sm" onClick={summarizeChat}>Summarize</Button>
    </div>}
    <form className="flex items-end gap-2 border-t border-line p-3" onSubmit={(event) => { event.preventDefault(); void ask(text); }}>
      {/* py-1.75 with a 24px line makes one line exactly h-control, so the buttons line up with it. */}
      <Textarea ref={input} rows={1} aria-label="Message the tutor" className="max-h-40 resize-none py-1.75 text-sm leading-6" value={text} onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask(text); } }} placeholder={placeholder} />
      {hint && <IconButton label="Get a hint" onClick={() => void ask(hint)} disabled={!!busy}><Lightbulb size={18} /></IconButton>}
      {summarize && unsummarized.length >= 2 && <IconButton label="Summarize chat" onClick={summarizeChat} disabled={!!busy}><ListCollapse size={18} /></IconButton>}
      {clear && messages.length > 0 && <IconButton label="Clear chat" onClick={() => void act(async () => { await clear(); setMessages([]); }, "Clearing…", "The chat could not be cleared.")} disabled={!!busy}><Eraser size={18} /></IconButton>}
      <IconButton type="submit" label="Send message" className="text-accent" disabled={!text.trim() || !!busy}><Send size={18} /></IconButton>
    </form>
  </Card>;
}

// A saved chat about a topic, folder, or resource: `path` is its chat endpoint. Remount it with a new `key` for each item.
export function SavedChat({ path, name }: { path: string; name: string }) {
  const ai = useAISettings();
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ messages: ChatMessage[] }>(path).then((result) => setMessages(result.messages), (reason: Error) => setError(reason.message));
  }, [path]);

  async function send(message: string) {
    if (!ai.configured) { notifyAiSetupRequired(); throw new Error("Sign in to Codex or Claude to chat."); }
    const result = await api<{ reply: string }>(path, { method: "POST", headers: { ...getAiRequestHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
    return result.reply;
  }

  async function summarize() {
    if (!ai.configured) { notifyAiSetupRequired(); throw new Error("Sign in to Codex or Claude to summarize."); }
    const result = await api<{ summary: string }>(path, { method: "POST", headers: { ...getAiRequestHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ summarize: true }) });
    return result.summary;
  }

  if (error) return <ErrorMessage>{error}</ErrorMessage>;
  if (!messages) return <p className="flex items-center gap-2 text-sm text-muted"><Spinner />Loading the chat…</p>;
  return <Chat className="mx-auto h-[min(36rem,calc(100dvh-240px))] max-w-3xl" initialMessages={messages} send={send} summarize={summarize} clear={() => api<void>(path, { method: "DELETE" })}
    placeholder={`Ask about ${name}…`} empty="Ask a question, request an example, or ask to be quizzed. Answers draw on your course material." />;
}
