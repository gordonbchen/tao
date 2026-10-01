"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, History, Lightbulb, ListCollapse, Maximize2, MessageSquarePlus, Minimize2, Pencil, Send, Square } from "lucide-react";
import { recentMessages, sinceSummary } from "@/lib/chat-context";
import { aiApi, api, isAbort, notifyAiSetupRequired, readDraft, saveDraft, useAISettings } from "./components";
import type { Diagram as DiagramData } from "@/lib/diagrams";
import { Diagram } from "./diagram";
import { hasMath, MathText } from "./math-text";
import { Button, Card, cn, ErrorMessage, IconButton, Input, Modal, Spinner, Textarea } from "./ui";

// A summary stands in for the messages before it when the tutor replies.
export type ChatMessage = { role: "assistant" | "user" | "summary"; text: string; diagram?: DiagramData | null };
// A tutor reply: text, an optional figure, and the chat's new name when the tutor just named it.
export type ChatReply = { text: string; diagram?: DiagramData | null; name?: string };
// A conversation set aside by starting a new chat or switching to another. `clearedAt` identifies it; `lastAt` is its last message.
export type PastChat = { clearedAt: string; lastAt: string; name: string; messages: ChatMessage[] };

const bubble = "flex max-w-[90%] flex-col gap-2 rounded-lg px-3 py-2 text-sm";
const when = (date: string) => new Date(date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

// Tutor conversation for problems, flashcards, topics, folders, and resources. Remount it with a new `key` for each item.
// `send` returns the tutor's reply; its signal aborts when the student presses Stop. Enter sends; Shift+Enter starts a new line. `hint` adds a lightbulb that sends
// that message, `summarize` adds a button that condenses the conversation so far, and `clear` one that starts a new chat.
// `history` adds a list of all chats; `resume` switches to an earlier one, setting the current chat aside. `rename` makes
// the chat's name editable. `draftKey` keeps the unsent message in this browser as it is typed. `expandable` adds a button,
// on wide screens, that enlarges the chat to a modal; use it where the chat sits beside other content.
export function Chat({ initialMessages = [], initialName = "", draftKey, send, placeholder, empty, hint, summarize, clear, history, resume, rename, expandable, className }: {
  initialName?: string;
  draftKey?: string;
  initialMessages?: ChatMessage[];
  send: (text: string, signal: AbortSignal) => Promise<ChatReply>;
  placeholder: string;
  empty: string;
  hint?: string;
  summarize?: (signal: AbortSignal) => Promise<string>;
  clear?: () => Promise<void>;
  history?: () => Promise<PastChat[]>;
  resume?: (clearedAt: string) => Promise<void>;
  rename?: (name: string) => Promise<void>;
  expandable?: boolean;
  className?: string;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [name, setName] = useState(initialName);
  // A failed rename or switch, shown under the top bar.
  const [barError, setBarError] = useState("");
  // Chats render only in the browser, after their messages load, so the draft can be read on the first render.
  const [text, setTextState] = useState(() => readDraft(draftKey));
  const setText = (value: string) => { setTextState(value); saveDraft(draftKey, value); };
  // What the chat is waiting for, shown beside a spinner; empty when idle.
  const [busy, setBusy] = useState("");
  // Stops the reply or summary being written; Send becomes Stop meanwhile.
  const [stopper, setStopper] = useState<AbortController | null>(null);
  // Earlier chats while the chat list is open.
  const [past, setPast] = useState<PastChat[] | null>(null);
  // Whether the chat is enlarged to a modal. Its state lives here, so only its frame changes.
  const [expanded, setExpanded] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);

  // Grow with the text from one line; max-h-40 then scrolls. Enlarging or shrinking the chat makes a new field.
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight + element.offsetHeight - element.clientHeight}px`;
  }, [text, expanded]);

  useEffect(() => { log.current?.scrollTo({ top: past ? 0 : log.current.scrollHeight }); }, [messages, busy, past, expanded]);
  const toggleExpanded = () => { setExpanded((value) => !value); requestAnimationFrame(() => input.current?.focus()); };

  async function ask(content: string) {
    content = content.trim();
    if (!content || busy) return;
    setText("");
    setMessages((items) => [...items, { role: "user", text: content }]);
    setBusy("Thinking…");
    const controller = new AbortController();
    setStopper(controller);
    try {
      const reply = await send(content, controller.signal);
      setMessages((items) => [...items, { role: "assistant", text: reply.text, diagram: reply.diagram }]);
      if (reply.name) setName(reply.name);
    } catch (error) {
      // A stopped question was never saved, so it goes back to the input.
      if (isAbort(error)) { setMessages((items) => items.slice(0, -1)); if (content !== hint) setText(content); }
      else setMessages((items) => [...items, { role: "assistant", text: error instanceof Error ? error.message : "I couldn’t reply just now. Try again in a moment." }]);
    } finally { setBusy(""); setStopper(null); }
  }

  // Runs a chat-wide action, showing a failure as a tutor message. With `controller`, Stop aborts it.
  async function act(action: () => Promise<void>, label: string, failure: string, controller?: AbortController) {
    if (busy) return;
    setBusy(label);
    setStopper(controller ?? null);
    try { await action(); }
    catch (error) { if (!isAbort(error)) setMessages((items) => [...items, { role: "assistant", text: error instanceof Error ? error.message : failure }]); }
    finally { setBusy(""); setStopper(null); }
  }

  const unsummarized = sinceSummary(messages).messages;
  // The server sends the tutor only what fits `recentMessages`; say when older messages no longer do.
  const leftOut = unsummarized.length > recentMessages(unsummarized).length;
  const summarizeChat = () => {
    if (!summarize) return;
    const controller = new AbortController();
    void act(async () => { const text = await summarize(controller.signal); setMessages((items) => [...items, { role: "summary", text }]); }, "Summarizing the chat…", "The chat could not be summarized.", controller);
  };

  const showHistory = () => {
    if (history) void act(async () => { setPast(await history()); }, "Loading chats…", "Chats could not be loaded.");
  };
  const newChat = clear && (() => void act(async () => { await clear(); setMessages([]); setName(""); setBarError(""); setPast(null); }, "Starting a new chat…", "A new chat could not be started."));
  // Opens an earlier chat in place of the current one, which joins the list.
  const switchTo = (chat: PastChat) => {
    if (!resume || busy) return;
    setBusy("Opening the chat…");
    resume(chat.clearedAt).then(() => {
      setMessages(chat.messages);
      setName(chat.name);
      setBarError("");
      setPast(null);
    }, (error) => setBarError(error instanceof Error ? error.message : "The chat could not be opened.")).finally(() => setBusy(""));
  };
  const renameTo = rename && (async (value: string) => {
    try { await rename(value); setName(value); setBarError(""); }
    catch (error) { setBarError(error instanceof Error ? error.message : "The chat could not be renamed."); }
  });
  const barFailure = barError && <ErrorMessage className="mx-3 my-2">{barError}</ErrorMessage>;
  const opening = (list: ChatMessage[]) => list.find((message) => message.role === "user")?.text ?? list[0]?.text ?? "";
  const chatRow = (key: string, title: string, detail: string, onClick: () => void, current = false) => <li key={key}>
    <button type="button" className={cn("flex w-full flex-col rounded-md px-2 py-2 text-left transition-colors", current ? "bg-accent-soft" : "hover:bg-hover")} onClick={onClick} disabled={!!busy} aria-current={current || undefined}>
      <span className="truncate text-sm">{title}</span><span className="text-xs text-muted">{detail}</span>
    </button>
  </li>;
  const expandButton = expandable && (expanded
    ? <IconButton size="sm" label="Shrink chat" onClick={toggleExpanded}><Minimize2 size={16} /></IconButton>
    : <IconButton size="sm" className="max-lg:hidden" label="Enlarge chat" onClick={toggleExpanded}><Maximize2 size={16} /></IconButton>);
  // The chat's card, beside other content or enlarged in a modal.
  const frame = (children: ReactNode) => expanded
    ? <Modal bare title="Chat" label={name || "Chat"} onClose={toggleExpanded}><Card className="flex min-h-0 flex-1 flex-col max-sm:rounded-none max-sm:border-0">{children}</Card></Modal>
    : <Card className={cn("flex min-h-80 flex-col", className)}>{children}</Card>;
  const newChatButton = newChat && <IconButton size="sm" label="Start a new chat" onClick={newChat} disabled={!!busy || !messages.length}><MessageSquarePlus size={16} /></IconButton>;

  const render = (message: ChatMessage, i: number) => message.role === "summary"
    ? <div key={i} className="border-y border-line py-3 text-sm"><p className="mb-1 text-xs text-muted">Summary of the conversation above; the tutor now reads this instead</p><MathText className="leading-relaxed whitespace-pre-wrap" text={message.text} /></div>
    : <div key={i} className={cn(bubble, message.role === "user" ? "self-end bg-accent-soft" : "self-start bg-subtle")}>
      <MathText className="leading-relaxed whitespace-pre-wrap" text={message.text} />
      {message.diagram && <Diagram diagram={message.diagram} />}
    </div>;

  if (past) return frame(<>
    <div className="flex items-center gap-1 border-b border-line p-1">
      <IconButton size="sm" label="Back to the chat" onClick={() => { setBarError(""); setPast(null); }}><ArrowLeft size={16} /></IconButton>
      <span className="flex-1 px-2 text-sm">Chats</span>
      {newChatButton}
      {expandButton}
    </div>
    {barFailure}
    <div ref={log} className="flex flex-1 flex-col gap-3 overflow-auto p-4">
      {busy && <p className="flex items-center gap-2 text-sm text-muted"><Spinner />{busy}</p>}
      {!messages.length && !past.length ? <p className="text-sm text-muted">No chats yet.</p>
        : <ul className="-mx-2 flex flex-col">
          {messages.length > 0 && chatRow("current", name || opening(messages), `Current · ${messages.length} messages`, () => setPast(null), true)}
          {past.map((chat) => chatRow(chat.clearedAt, chat.name || opening(chat.messages), `${when(chat.lastAt)} · ${chat.messages.length} messages`, () => switchTo(chat)))}
        </ul>}
    </div>
  </>);

  return frame(<>
    {history || clear ? <div className="flex items-center gap-1 border-b border-line p-1">
      <ChatName name={name} fallback={opening(messages) || "New chat"} rename={messages.length ? renameTo : undefined} />
      {history && <IconButton size="sm" label="Chats" onClick={showHistory} disabled={!!busy}><History size={16} /></IconButton>}
      {newChatButton}
      {expandButton}
    </div> : expandButton && <div className={cn("flex justify-end border-b border-line p-1", !expanded && "max-lg:hidden")}>{expandButton}</div>}
    {barFailure}
    <div ref={log} className="flex flex-1 flex-col gap-3 overflow-auto p-4">
      {!messages.length && !busy && <p className="text-sm text-muted">{empty}</p>}
      {messages.map(render)}
      {busy && <div className="inline-flex items-center gap-2 self-start rounded-lg bg-subtle px-3 py-2 text-sm text-muted"><Spinner />{busy}</div>}
    </div>
    {summarize && leftOut && !busy && <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-1 text-xs text-muted">
      <span>Older messages no longer reach the tutor.</span><Button variant="ghost" size="sm" onClick={summarizeChat}>Summarize</Button>
    </div>}
    {/* The unsent message with its math typeset: the shape of the student's message it will become, but an outline
        with muted text, where sent messages are filled. */}
    {hasMath(text) && <div className="flex flex-col px-4 pb-3"><MathText className={cn(bubble, "block max-h-40 self-end overflow-auto border border-dashed border-line-strong leading-relaxed whitespace-pre-wrap text-muted")} text={text} /></div>}
    <form className="flex items-end gap-2 border-t border-line p-3" onSubmit={(event) => { event.preventDefault(); void ask(text); }}>
      {/* py-1.75 with a 24px line makes one line exactly h-control, so the buttons line up with it. */}
      <Textarea ref={input} rows={1} mathPreview={false} aria-label="Message the tutor" className="max-h-40 resize-none py-1.75 text-sm leading-6" value={text} onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask(text); } }} placeholder={placeholder} />
      {hint && <IconButton label="Get a hint" onClick={() => void ask(hint)} disabled={!!busy}><Lightbulb size={18} /></IconButton>}
      {summarize && unsummarized.length >= 2 && <IconButton label="Summarize chat" onClick={summarizeChat} disabled={!!busy}><ListCollapse size={18} /></IconButton>}
      {stopper ? <IconButton label="Stop" className="text-accent" onClick={() => stopper.abort()}><Square size={16} fill="currentColor" /></IconButton>
        : <IconButton type="submit" label="Send message" className="text-accent" disabled={!text.trim() || !!busy}><Send size={18} /></IconButton>}
    </form>
  </>);
}

// A chat's name in its top bar. The pencil turns it into a field; Enter or leaving the field saves, and Escape cancels.
function ChatName({ name, fallback, rename }: { name: string; fallback: string; rename?: (name: string) => Promise<void> }) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  function finish() {
    const value = draft?.replace(/\s+/g, " ").trim();
    setDraft(null);
    if (!cancelled.current && value && value !== name) void rename?.(value);
  }
  if (draft !== null) return <Input autoFocus aria-label="Chat name" maxLength={80} className="h-control-sm min-w-0 flex-1 px-2" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={finish}
    onKeyDown={(event) => {
      if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
      // Stopped here so an enclosing viewer does not close too.
      else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelled.current = true; event.currentTarget.blur(); }
    }} />;
  return <div className="flex min-w-0 flex-1 items-center gap-1">
    <span className={cn("truncate px-2 text-sm", !name && "text-muted")} title={name || fallback}>{name || fallback}</span>
    {rename && <IconButton size="sm" label="Rename chat" onClick={() => { cancelled.current = false; setDraft(name); }}><Pencil size={14} /></IconButton>}
  </div>;
}

const savedChatHeight = "h-[min(36rem,calc(100dvh-240px))]";

// A saved chat about a subject, topic, folder, or resource: `path` is its chat endpoint. Remount it with a new `key` for each item.
export function SavedChat({ path, name, empty = "Ask a question, request an example, or ask to be quizzed. Answers draw on your course material.", expandable, className }: { path: string; name: string; empty?: string; expandable?: boolean; className?: string }) {
  const ai = useAISettings();
  const [chat, setChat] = useState<{ messages: ChatMessage[]; name: string } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ messages: ChatMessage[]; name: string }>(path).then(setChat, (reason: Error) => setError(reason.message));
  }, [path]);

  async function send(message: string, signal: AbortSignal) {
    if (!ai.configured) { notifyAiSetupRequired(); throw new Error("Sign in to an AI account to chat."); }
    const result = await aiApi<{ reply: string; diagram: DiagramData | null; name?: string }>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }), signal });
    return { text: result.reply, diagram: result.diagram, name: result.name };
  }

  async function summarize(signal: AbortSignal) {
    if (!ai.configured) { notifyAiSetupRequired(); throw new Error("Sign in to an AI account to summarize."); }
    const result = await aiApi<{ summary: string }>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ summarize: true }), signal });
    return result.summary;
  }

  if (error) return <ErrorMessage>{error}</ErrorMessage>;
  // The placeholder takes the chat's size, so nothing moves when the messages arrive.
  if (!chat) return <Card className={cn("flex min-h-80 items-center justify-center gap-2 text-sm text-muted", savedChatHeight, className)}><Spinner />Loading the chat…</Card>;
  return <Chat className={cn(savedChatHeight, className)} initialMessages={chat.messages} initialName={chat.name} draftKey={`chat:${path}`} send={send} summarize={summarize} clear={() => api<void>(path, { method: "DELETE" })}
    history={async () => (await api<{ chats: PastChat[] }>(`${path}?archived=1`)).chats}
    resume={(clearedAt) => api<void>(`${path}?restore=${encodeURIComponent(clearedAt)}`, { method: "DELETE" })}
    rename={async (name) => { await api(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }); }}
    placeholder={`Ask about ${name}…`} empty={empty} expandable={expandable} />;
}
