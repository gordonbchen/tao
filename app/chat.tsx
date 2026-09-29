"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Lightbulb, Send } from "lucide-react";
import { MathText } from "./math-text";
import { Card, cn, IconButton, Spinner, Textarea } from "./ui";

export type ChatMessage = { role: "assistant" | "user"; text: string };

// Tutor conversation shared by problems and flashcards. Remount it with a new `key` for each item.
// `send` returns the tutor's reply. Enter sends; Shift+Enter starts a new line.
export function Chat({ initialMessages = [], send, placeholder, empty }: {
  initialMessages?: ChatMessage[];
  send: (text: string) => Promise<string>;
  placeholder: string;
  empty: string;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
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
    setBusy(true);
    try {
      const reply = await send(content);
      setMessages((items) => [...items, { role: "assistant", text: reply }]);
    } catch (error) {
      setMessages((items) => [...items, { role: "assistant", text: error instanceof Error ? error.message : "I couldn’t reply just now. Try again in a moment." }]);
    } finally { setBusy(false); }
  }

  return <Card className="flex min-h-80 flex-col lg:sticky lg:top-6 lg:max-h-[calc(100dvh-48px)]">
    <div ref={log} className="flex flex-1 flex-col gap-3 overflow-auto p-4">
      {!messages.length && !busy && <p className="text-sm text-muted">{empty}</p>}
      {messages.map((message, i) => <MathText key={i} className={cn("max-w-[90%] rounded-lg px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap", message.role === "user" ? "self-end bg-accent-soft" : "self-start bg-subtle")} text={message.text} />)}
      {busy && <div className="inline-flex items-center gap-2 self-start rounded-lg bg-subtle px-3 py-2 text-sm text-muted"><Spinner />Thinking…</div>}
    </div>
    <form className="flex items-end gap-2 border-t border-line p-3" onSubmit={(event) => { event.preventDefault(); void ask(text); }}>
      {/* py-1.75 with a 24px line makes one line exactly h-control, so the buttons line up with it. */}
      <Textarea ref={input} rows={1} aria-label="Message the tutor" className="max-h-40 resize-none py-1.75 text-sm leading-6" value={text} onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask(text); } }} placeholder={placeholder} />
      <IconButton label="Get a hint" onClick={() => void ask("Can I get a small hint?")} disabled={busy}><Lightbulb size={18} /></IconButton>
      <IconButton type="submit" label="Send message" className="text-accent" disabled={!text.trim() || busy}><Send size={18} /></IconButton>
    </form>
  </Card>;
}
