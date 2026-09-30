"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, History, Lightbulb, ListCollapse, MessageSquarePlus, Send } from "lucide-react";
import { recentMessages, sinceSummary } from "@/lib/chat-context";
import { api, getAiRequestHeaders, notifyAiSetupRequired, useAISettings } from "./components";
import type { Diagram as DiagramData } from "@/lib/diagrams";
import { Diagram } from "./diagram";
import { MathText } from "./math-text";
import { Button, Card, cn, ErrorMessage, IconButton, Spinner, Textarea } from "./ui";

// A summary stands in for the messages before it when the tutor replies.
export type ChatMessage = { role: "assistant" | "user" | "summary"; text: string; diagram?: DiagramData | null };
// A tutor reply: text and an optional figure.
export type ChatReply = { text: string; diagram?: DiagramData | null };
// A conversation set aside by starting a new chat.
export type PastChat = { clearedAt: string; messages: ChatMessage[] };

const when = (date: string) => new Date(date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

// Tutor conversation for problems, flashcards, topics, folders, and resources. Remount it with a new `key` for each item.
// `send` returns the tutor's reply. Enter sends; Shift+Enter starts a new line. `hint` adds a lightbulb that sends
// that message, `summarize` adds a button that condenses the conversation so far, `clear` one that starts a new chat,
// and `history` one that lists earlier chats to read.
export function Chat({ initialMessages = [], send, placeholder, empty, hint, summarize, clear, history, className }: {
  initialMessages?: ChatMessage[];
  send: (text: string) => Promise<ChatReply>;
  placeholder: string;
  empty: string;
  hint?: string;
  summarize?: () => Promise<string>;
  clear?: () => Promise<void>;
  history?: () => Promise<PastChat[]>;
  className?: string;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [text, setText] = useState("");
  // What the chat is waiting for, shown beside a spinner; empty when idle.
  const [busy, setBusy] = useState("");
  // Earlier chats while browsing them, and the one being read.
  const [past, setPast] = useState<PastChat[] | null>(null);
  const [reading, setReading] = useState<PastChat | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);

  // Grow with the text from one line; max-h-40 then scrolls.
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight + element.offsetHeight - element.clientHeight}px`;
  }, [text]);

  useEffect(() => { log.current?.scrollTo({ top: past && !reading ? 0 : log.current.scrollHeight }); }, [messages, busy, past, reading]);

  async function ask(content: string) {
    content = content.trim();
    if (!content || busy) return;
    setText("");
    setMessages((items) => [...items, { role: "user", text: content }]);
    setBusy("Thinking…");
    try {
      const reply = await send(content);
      setMessages((items) => [...items, { role: "assistant", ...reply }]);
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

  const showHistory = () => {
    if (history) void act(async () => { setPast(await history()); }, "Loading earlier chats…", "Earlier chats could not be loaded.");
  };
  const render = (message: ChatMessage, i: number) => message.role === "summary"
    ? <div key={i} className="border-y border-line py-3 text-sm"><p className="mb-1 text-xs text-muted">Summary of the conversation above; the tutor now reads this instead</p><MathText className="leading-relaxed whitespace-pre-wrap" text={message.text} /></div>
    : <div key={i} className={cn("flex max-w-[90%] flex-col gap-2 rounded-lg px-3 py-2 text-sm", message.role === "user" ? "self-end bg-accent-soft" : "self-start bg-subtle")}>
      <MathText className="leading-relaxed whitespace-pre-wrap" text={message.text} />
      {message.diagram && <Diagram diagram={message.diagram} />}
    </div>;

  if (past) return <Card className={cn("flex min-h-80 flex-col", className)}>
    <div className="flex items-center gap-2 border-b border-line p-1">
      <Button variant="ghost" size="sm" onClick={() => reading ? setReading(null) : setPast(null)}><ArrowLeft size={16} />{reading ? "Earlier chats" : "Current chat"}</Button>
      {reading && <span className="truncate text-xs text-muted">Set aside {when(reading.clearedAt)}</span>}
    </div>
    <div ref={log} className="flex flex-1 flex-col gap-3 overflow-auto p-4">
      {reading ? reading.messages.map(render)
        : !past.length ? <p className="text-sm text-muted">No earlier chats. Starting a new chat keeps the old one here.</p>
        : <ul className="-mx-2 flex flex-col">{past.map((chat) => {
          const opening = chat.messages.find((message) => message.role === "user")?.text ?? chat.messages[0]?.text ?? "";
          return <li key={chat.clearedAt}><button type="button" className="flex w-full flex-col rounded-md px-2 py-2 text-left transition-colors hover:bg-hover" onClick={() => setReading(chat)}>
            <span className="truncate text-sm">{opening}</span><span className="text-xs text-muted">{when(chat.clearedAt)} · {chat.messages.length} messages</span>
          </button></li>;
        })}</ul>}
    </div>
  </Card>;

  return <Card className={cn("flex min-h-80 flex-col", className)}>
    {(history || clear) && <div className="flex items-center justify-end gap-1 border-b border-line p-1">
      {history && <IconButton size="sm" label="Earlier chats" onClick={showHistory} disabled={!!busy}><History size={16} /></IconButton>}
      {clear && <IconButton size="sm" label="Start a new chat" onClick={() => void act(async () => { await clear(); setMessages([]); }, "Starting a new chat…", "A new chat could not be started.")} disabled={!!busy || !messages.length}><MessageSquarePlus size={16} /></IconButton>}
    </div>}
    <div ref={log} className="flex flex-1 flex-col gap-3 overflow-auto p-4">
      {!messages.length && !busy && <p className="text-sm text-muted">{empty}</p>}
      {messages.map(render)}
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
      <IconButton type="submit" label="Send message" className="text-accent" disabled={!text.trim() || !!busy}><Send size={18} /></IconButton>
    </form>
  </Card>;
}

// A saved chat about a subject, topic, folder, or resource: `path` is its chat endpoint. Remount it with a new `key` for each item.
export function SavedChat({ path, name, empty = "Ask a question, request an example, or ask to be quizzed. Answers draw on your course material.", className }: { path: string; name: string; empty?: string; className?: string }) {
  const ai = useAISettings();
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ messages: ChatMessage[] }>(path).then((result) => setMessages(result.messages), (reason: Error) => setError(reason.message));
  }, [path]);

  async function send(message: string) {
    if (!ai.configured) { notifyAiSetupRequired(); throw new Error("Sign in to Codex or Claude to chat."); }
    const result = await api<{ reply: string; diagram: DiagramData | null }>(path, { method: "POST", headers: { ...getAiRequestHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
    return { text: result.reply, diagram: result.diagram };
  }

  async function summarize() {
    if (!ai.configured) { notifyAiSetupRequired(); throw new Error("Sign in to Codex or Claude to summarize."); }
    const result = await api<{ summary: string }>(path, { method: "POST", headers: { ...getAiRequestHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ summarize: true }) });
    return result.summary;
  }

  if (error) return <ErrorMessage>{error}</ErrorMessage>;
  if (!messages) return <p className="flex items-center gap-2 text-sm text-muted"><Spinner />Loading the chat…</p>;
  return <Chat className={cn("h-[min(36rem,calc(100dvh-240px))]", className)} initialMessages={messages} send={send} summarize={summarize} clear={() => api<void>(path, { method: "DELETE" })}
    history={async () => (await api<{ chats: PastChat[] }>(`${path}?archived=1`)).chats}
    placeholder={`Ask about ${name}…`} empty={empty} />;
}
