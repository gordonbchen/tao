"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { List as ListIcon, Pencil, Plus, Sparkles, Upload } from "lucide-react";
import { buildTree, flattenTree, groupPath, type TreeGroup, type TreeTopic } from "@/lib/topic-tree";
import { api, getAiRequestHeaders, notifyAiSetupRequired, scheduleUndoDelete, useAISettings } from "../../components";
import { Chat, type ChatMessage } from "../../chat";
import { MathText } from "../../math-text";
import { Badge, Button, Card, cn, ErrorMessage, IconButton, Input, Modal, Select, Spinner, Textarea } from "../../ui";
import type { StudySelection } from "./selection";

type Rating = 1 | 2 | 3 | 4;
type ReviewCard = { id: string; topicId: string | null; topicName: string | null; front: string; back: string; intervals: Record<Rating, string>; messages: ChatMessage[] };
type Counts = { new: number; learning: number; review: number; total: number; nextDue: string | null };
type StoredCard = { id: string; topicId: string | null; topicName: string | null; front: string; back: string; due: string; state: number };
type Draft = { front: string; back: string };
type Dialog = { kind: "add" | "import" | "generate" | "browse" } | { kind: "edit"; card: { id: string; topicId: string | null; front: string; back: string } };
const ratingLabels: { value: Rating; label: string }[] = [{ value: 1, label: "Again" }, { value: 2, label: "Hard" }, { value: 3, label: "Good" }, { value: 4, label: "Easy" }];

const selectionQuery = ({ topicIds, groupIds }: StudySelection) =>
  new URLSearchParams([...topicIds.map((id) => ["topic", id]), ...groupIds.map((id) => ["group", id])]).toString();

const jsonHeaders = () => ({ ...getAiRequestHeaders(), "Content-Type": "application/json" });

function when(date: string) {
  const days = Math.round((Date.parse(date) - Date.now()) / 86_400_000);
  if (days < 1) return `at ${new Date(date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  return days === 1 ? "tomorrow" : `in ${days} days`;
}

// Flashcard review for the selection, with FSRS ratings and the tutor chat. The parent remounts it when the selection changes.
export function Cards({ subjectId, topics, groups, selection }: { subjectId: string; topics: TreeTopic[]; groups: TreeGroup[]; selection: StudySelection }) {
  const ai = useAISettings();
  const [card, setCard] = useState<ReviewCard | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState<Rating | null>(null);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const query = selectionQuery(selection);

  // `exclude` skips a card whose deletion is waiting on the undo toast.
  const load = useCallback(async (exclude?: string) => {
    try {
      const result = await api<{ card: ReviewCard | null; counts: Counts }>(`/api/subjects/${subjectId}/cards/next?${query}${exclude ? `&exclude=${exclude}` : ""}`);
      setCard(result.card); setCounts(result.counts); setRevealed(false); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load cards"); }
    finally { setLoading(false); }
  }, [subjectId, query]);

  useEffect(() => { void load(); }, [load]);

  const rate = useCallback(async (value: Rating) => {
    if (!card || rating) return;
    setRating(value);
    try {
      await api(`/api/cards/${card.id}/reviews`, { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ rating: value }) });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save the rating"); }
    finally { setRating(null); }
  }, [card, load, rating]);

  // Space or Enter shows the answer; 1–4 rate it, as in Anki. Keys typed in fields and dialogs are left alone.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!card || dialog || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (!revealed && (event.key === " " || event.key === "Enter")) {
        if (target?.closest("button")) return; // A focused button handles Space and Enter itself.
        event.preventDefault(); setRevealed(true);
      }
      else if (revealed && ["1", "2", "3", "4"].includes(event.key)) { event.preventDefault(); void rate(Number(event.key) as Rating); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [card, dialog, rate, revealed]);

  async function askTutor(message: string) {
    if (!card) throw new Error("No card is open.");
    if (!ai.configured) { notifyAiSetupRequired(); throw new Error("Sign in to Codex or Claude to continue."); }
    const result = await api<{ reply: string }>(`/api/cards/${card.id}/chat`, { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ message, revealed }) });
    return result.reply;
  }

  function removeCard(id: string) {
    setDialog(null);
    scheduleUndoDelete(id, {
      message: "Card deleted.",
      commit: () => api(`/api/cards/${id}`, { method: "DELETE" }).then(() => {}),
      restore: () => void load(),
    });
    void load(id);
  }

  const defaultTopicId = selection.topicIds.length === 1 && !selection.groupIds.length ? selection.topicIds[0] : card?.topicId ?? null;
  const closeDialog = (changed: boolean) => { setDialog(null); if (changed) void load(); };

  const toolbar = <div className="flex flex-wrap items-center gap-2">
    <Button variant="ghost" onClick={() => setDialog({ kind: "add" })}><Plus size={16} />Add</Button>
    <Button variant="ghost" onClick={() => setDialog({ kind: "import" })}><Upload size={16} />Import</Button>
    <Button variant="ghost" onClick={() => ai.configured ? setDialog({ kind: "generate" }) : notifyAiSetupRequired()} disabled={!topics.length}><Sparkles size={16} />Generate</Button>
    <Button variant="ghost" onClick={() => setDialog({ kind: "browse" })} disabled={!counts?.total}><ListIcon size={16} />Browse</Button>
  </div>;

  return <>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
      {counts && counts.total > 0 ? <p className="text-sm text-muted" aria-label="Cards due">
        <span className="text-accent">{counts.new} new</span> · {counts.learning} learning · {counts.review} to review
      </p> : <span />}
      {toolbar}
    </div>
    {error && <ErrorMessage className="mt-0">{error}</ErrorMessage>}
    {loading ? <p className="inline-flex items-center gap-3 py-8 text-muted"><Spinner />Loading cards…</p>
      : !card ? <p className="py-8 text-muted">{!counts?.total
        ? "No cards yet. Add your own, import a deck, or generate cards from a topic."
        : `No cards are due${counts.nextDue ? `. The next one is due ${when(counts.nextDue)}.` : "."}`}</p>
      : <div className="grid grid-cols-[minmax(0,1fr)_minmax(280px,360px)] items-start gap-6 max-lg:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="p-6 max-sm:p-4">
            <div className="mb-4 flex items-center gap-2">
              {card.topicName && <Badge>{card.topicName}</Badge>}
              <IconButton size="sm" className="ml-auto" label="Edit card" onClick={() => setDialog({ kind: "edit", card })}><Pencil size={16} /></IconButton>
            </div>
            <MathText className="text-lg leading-relaxed whitespace-pre-wrap" text={card.front} />
            {revealed && <MathText className="mt-6 border-t border-line pt-6 leading-relaxed whitespace-pre-wrap" text={card.back || "(No back)"} />}
          </Card>
          {!revealed ? <Button variant="primary" className="self-center" onClick={() => setRevealed(true)}>Show answer</Button>
            : <div className="grid grid-cols-4 gap-2 max-sm:grid-cols-2" role="group" aria-label="How well did you remember it?">
              {ratingLabels.map(({ value, label }) => <Button key={value} variant={value === 3 ? "primary" : "secondary"} disabled={rating !== null} onClick={() => void rate(value)} title={`${label} (${value})`}>
                {rating === value ? <Spinner /> : label}<span className="text-xs">{card.intervals[value]}</span>
              </Button>)}
            </div>}
        </div>
        <Chat key={card.id} initialMessages={card.messages} send={askTutor} placeholder={revealed ? "Ask about this card…" : "Ask without seeing the answer…"} empty="Ask the tutor about this card, or use the lightbulb for a hint that keeps the answer hidden." />
      </div>}
    {dialog?.kind === "add" && <CardEditor subjectId={subjectId} topics={topics} groups={groups} topicId={defaultTopicId} onClose={closeDialog} />}
    {dialog?.kind === "edit" && <CardEditor subjectId={subjectId} topics={topics} groups={groups} card={dialog.card} topicId={dialog.card.topicId} onClose={closeDialog} onDelete={removeCard} />}
    {dialog?.kind === "import" && <ImportDialog subjectId={subjectId} topics={topics} groups={groups} topicId={defaultTopicId} onClose={closeDialog} />}
    {dialog?.kind === "generate" && <GenerateDialog subjectId={subjectId} topics={topics} groups={groups} topicId={defaultTopicId ?? selectedTopics(selection, topics, groups)[0]?.id ?? topics[0]?.id} onClose={closeDialog} />}
    {dialog?.kind === "browse" && <BrowseDialog subjectId={subjectId} query={query} onEdit={(edited) => setDialog({ kind: "edit", card: edited })} onClose={() => closeDialog(false)} />}
  </>;
}

// Topics in tree order, labeled with their folder path.
function useTopicOptions(topics: TreeTopic[], groups: TreeGroup[]) {
  return useMemo(() => flattenTree(buildTree(groups, topics)).flatMap((node) => node.kind === "topic"
    ? [{ id: node.topic.id, label: [...groupPath(groups, node.topic.groupId), node.topic.name].join(" / ") }] : []), [groups, topics]);
}

function selectedTopics({ topicIds, groupIds }: StudySelection, topics: TreeTopic[], groups: TreeGroup[]) {
  const inGroup = (groupId: string | null): boolean => groupId !== null && (groupIds.includes(groupId) || inGroup(groups.find((group) => group.id === groupId)?.parentId ?? null));
  return topics.filter((topic) => topicIds.includes(topic.id) || inGroup(topic.groupId));
}

function TopicSelect({ topics, groups, value, onChange, allowNone }: { topics: TreeTopic[]; groups: TreeGroup[]; value: string | null; onChange: (id: string | null) => void; allowNone?: boolean }) {
  const options = useTopicOptions(topics, groups);
  return <Select aria-label="Topic" className="w-full" value={value ?? ""} onChange={(event) => onChange(event.target.value || null)}>
    {allowNone && <option value="">No topic</option>}
    {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
  </Select>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-2 text-sm"><span className="text-muted">{label}</span>{children}</label>;
}

// Adds cards one after another (staying open), or edits one card.
function CardEditor({ subjectId, topics, groups, card, topicId: initialTopicId, onClose, onDelete }: {
  subjectId: string; topics: TreeTopic[]; groups: TreeGroup[]; card?: { id: string; front: string; back: string }; topicId: string | null;
  onClose: (changed: boolean) => void; onDelete?: (id: string) => void;
}) {
  const [front, setFront] = useState(card?.front ?? "");
  const [back, setBack] = useState(card?.back ?? "");
  const [topicId, setTopicId] = useState(initialTopicId);
  const [saving, setSaving] = useState(false);
  const [added, setAdded] = useState(0);
  const [error, setError] = useState("");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!front.trim() || saving) return;
    setSaving(true); setError("");
    try {
      if (card) {
        await api(`/api/cards/${card.id}`, { method: "PATCH", headers: jsonHeaders(), body: JSON.stringify({ front, back, topicId }) });
        onClose(true);
      } else {
        await api(`/api/subjects/${subjectId}/cards`, { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ cards: [{ front, back }], topicId, source: "manual" }) });
        setFront(""); setBack(""); setAdded((count) => count + 1);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save the card"); }
    finally { setSaving(false); }
  }

  return <Modal title={card ? "Edit card" : "Add cards"} onClose={() => onClose(added > 0)}>
    <form className="flex flex-col gap-4" onSubmit={save}>
      <Field label="Topic"><TopicSelect topics={topics} groups={groups} value={topicId} onChange={setTopicId} allowNone /></Field>
      <Field label="Front"><Textarea rows={3} value={front} maxLength={4000} onChange={(event) => setFront(event.target.value)} autoFocus placeholder="Question or prompt. Use \( … \) for math." /></Field>
      <Field label="Back"><Textarea rows={4} value={back} maxLength={8000} onChange={(event) => setBack(event.target.value)} placeholder="Answer" /></Field>
      {error && <ErrorMessage className="my-0">{error}</ErrorMessage>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {added > 0 && <span className="mr-auto text-sm text-muted" role="status">{added} added</span>}
        {card && onDelete && <Button variant="ghost" className="mr-auto hover:enabled:bg-danger-soft hover:enabled:text-danger" onClick={() => onDelete(card.id)}>Delete</Button>}
        <Button onClick={() => onClose(added > 0)}>{added ? "Done" : "Cancel"}</Button>
        <Button type="submit" variant="primary" disabled={!front.trim() || saving}>{saving ? <><Spinner />Saving…</> : card ? "Save" : "Add card"}</Button>
      </div>
    </form>
  </Modal>;
}

// A preview of cards before saving. With `kept`, each card has a checkbox.
function DraftList({ drafts, kept, onToggle }: { drafts: Draft[]; kept?: Set<number>; onToggle?: (index: number) => void }) {
  const shown = kept ? drafts : drafts.slice(0, 50);
  return <>
    <ul className="max-h-[50vh] overflow-auto border-t border-line">
      {shown.map((draft, index) => <li key={index} className="border-b border-line">
        <label className={cn("flex gap-3 py-3 text-sm", kept && "cursor-pointer")}>
          {kept && <input type="checkbox" className="mt-1 size-4 flex-none accent-accent" checked={kept.has(index)} onChange={() => onToggle?.(index)} />}
          <span className="grid min-w-0 flex-1 grid-cols-2 gap-4 max-sm:grid-cols-1">
            <MathText className="min-w-0 whitespace-pre-wrap" text={draft.front} />
            <MathText className="min-w-0 whitespace-pre-wrap text-muted" text={draft.back} />
          </span>
        </label>
      </li>)}
    </ul>
    {shown.length < drafts.length && <p className="mt-2 text-sm text-muted">And {(drafts.length - shown.length).toLocaleString()} more.</p>}
  </>;
}

async function saveDrafts(subjectId: string, cards: Draft[], topicId: string | null, source: "import" | "ai", metadata?: object) {
  return api<{ created: number }>(`/api/subjects/${subjectId}/cards`, { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ cards, topicId, source, metadata }) });
}

function ImportDialog({ subjectId, topics, groups, topicId: initialTopicId, onClose }: { subjectId: string; topics: TreeTopic[]; groups: TreeGroup[]; topicId: string | null; onClose: (changed: boolean) => void }) {
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [topicId, setTopicId] = useState(initialTopicId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function read(body: FormData) {
    setBusy(true); setError("");
    try { setDrafts((await api<{ cards: Draft[] }>(`/api/subjects/${subjectId}/cards/import`, { method: "POST", body })).cards); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not read these cards"); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!drafts) return;
    setBusy(true); setError("");
    try { await saveDrafts(subjectId, drafts, topicId, "import"); onClose(true); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not import these cards"); setBusy(false); }
  }

  return <Modal title="Import cards" subtitle={drafts ? `${drafts.length.toLocaleString()} cards found` : "An Anki .apkg deck, a .txt, .csv, or .tsv file, or pasted lines."} onClose={() => onClose(false)} wide={Boolean(drafts)}>
    {!drafts ? <div className="flex flex-col gap-4">
      <Textarea rows={6} className="font-mono text-sm" value={text} onChange={(event) => setText(event.target.value)} placeholder={"One card per line, front and back separated by a tab or comma:\nWhat is \\(\\lim_{x\\to 0} \\frac{\\sin x}{x}\\)?\t1"} />
      {error && <ErrorMessage className="my-0">{error}</ErrorMessage>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button className="mr-auto" onClick={() => fileRef.current?.click()} disabled={busy}><Upload size={16} />Choose file</Button>
        <input ref={fileRef} type="file" hidden accept=".apkg,.colpkg,.txt,.csv,.tsv" onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          const body = new FormData(); body.set("file", file); void read(body);
        }} />
        <Button onClick={() => onClose(false)}>Cancel</Button>
        <Button variant="primary" disabled={!text.trim() || busy} onClick={() => { const body = new FormData(); body.set("text", text); void read(body); }}>{busy ? <><Spinner />Reading…</> : "Read pasted cards"}</Button>
      </div>
    </div> : <div className="flex flex-col gap-4">
      <Field label="Add them to"><TopicSelect topics={topics} groups={groups} value={topicId} onChange={setTopicId} allowNone /></Field>
      <DraftList drafts={drafts} />
      {error && <ErrorMessage className="my-0">{error}</ErrorMessage>}
      <div className="flex justify-end gap-2">
        <Button onClick={() => setDrafts(null)} disabled={busy}>Back</Button>
        <Button variant="primary" onClick={() => void save()} disabled={busy}>{busy ? <><Spinner />Importing…</> : `Import ${drafts.length.toLocaleString()} cards`}</Button>
      </div>
    </div>}
  </Modal>;
}

function GenerateDialog({ subjectId, topics, groups, topicId: initialTopicId, onClose }: { subjectId: string; topics: TreeTopic[]; groups: TreeGroup[]; topicId?: string; onClose: (changed: boolean) => void }) {
  const [topicId, setTopicId] = useState<string | null>(initialTopicId ?? null);
  const [count, setCount] = useState(10);
  const [result, setResult] = useState<{ cards: Draft[]; metadata: object } | null>(null);
  const [kept, setKept] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    if (!topicId) return;
    setBusy(true); setError("");
    try {
      const generated = await api<{ cards: Draft[]; metadata: object }>(`/api/subjects/${subjectId}/cards/generate`, { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ topicId, count }) });
      setResult(generated); setKept(new Set(generated.cards.map((_, index) => index)));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not generate cards"); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!result) return;
    setBusy(true); setError("");
    try { await saveDrafts(subjectId, result.cards.filter((_, index) => kept.has(index)), topicId, "ai", result.metadata); onClose(true); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save these cards"); setBusy(false); }
  }

  return <Modal title="Generate cards" subtitle={result ? "Uncheck any card you don’t want to keep." : "From the topic’s coverage summary and linked resources."} onClose={() => onClose(false)} wide={Boolean(result)}>
    {!result ? <div className="flex flex-col gap-4">
      <Field label="Topic"><TopicSelect topics={topics} groups={groups} value={topicId} onChange={setTopicId} /></Field>
      <Field label="How many"><Select value={count} onChange={(event) => setCount(Number(event.target.value))}>{[5, 10, 20, 30].map((value) => <option key={value} value={value}>{value}</option>)}</Select></Field>
      {error && <ErrorMessage className="my-0">{error}</ErrorMessage>}
      <div className="flex justify-end gap-2">
        <Button onClick={() => onClose(false)}>Cancel</Button>
        <Button variant="primary" disabled={!topicId || busy} onClick={() => void generate()}>{busy ? <><Spinner />Writing cards…</> : "Generate"}</Button>
      </div>
    </div> : <div className="flex flex-col gap-4">
      <DraftList drafts={result.cards} kept={kept} onToggle={(index) => setKept((current) => { const next = new Set(current); if (!next.delete(index)) next.add(index); return next; })} />
      {error && <ErrorMessage className="my-0">{error}</ErrorMessage>}
      <div className="flex justify-end gap-2">
        <Button onClick={() => setResult(null)} disabled={busy}>Back</Button>
        <Button variant="primary" onClick={() => void save()} disabled={busy || !kept.size}>{busy ? <><Spinner />Saving…</> : `Keep ${kept.size} cards`}</Button>
      </div>
    </div>}
  </Modal>;
}

function BrowseDialog({ subjectId, query, onEdit, onClose }: { subjectId: string; query: string; onEdit: (card: StoredCard) => void; onClose: () => void }) {
  const [cards, setCards] = useState<StoredCard[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ cards: StoredCard[] }>(`/api/subjects/${subjectId}/cards?${query}`).then((result) => setCards(result.cards)).catch((e) => setError(e.message));
  }, [subjectId, query]);
  const needle = search.trim().toLocaleLowerCase();
  const shown = (cards ?? []).filter((card) => !needle || `${card.front}\n${card.back}\n${card.topicName ?? ""}`.toLocaleLowerCase().includes(needle));

  return <Modal title="Cards" subtitle={cards ? `${cards.length.toLocaleString()} in this selection` : undefined} onClose={onClose} wide>
    <Input className="mb-4 w-full" aria-label="Search cards" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" autoFocus />
    {error && <ErrorMessage>{error}</ErrorMessage>}
    {!cards ? <p className="inline-flex items-center gap-3 text-muted"><Spinner />Loading cards…</p> : <ul className="border-t border-line">
      {shown.slice(0, 300).map((card) => <li key={card.id} className="border-b border-line">
        <button type="button" className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-4 py-3 text-left text-sm transition-colors hover:bg-hover max-sm:grid-cols-1" onClick={() => onEdit(card)}>
          <span className="truncate">{card.front}</span>
          <span className="truncate text-muted">{card.back}</span>
          <span className="text-xs text-muted">{card.state === 0 ? "New" : `Due ${new Date(card.due).toLocaleDateString()}`}</span>
        </button>
      </li>)}
      {shown.length > 300 && <li className="py-3 text-sm text-muted">Showing 300 of {shown.length.toLocaleString()}. Search to narrow the list.</li>}
      {!shown.length && <li className="py-3 text-sm text-muted">No cards match.</li>}
    </ul>}
  </Modal>;
}
