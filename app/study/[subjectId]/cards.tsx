"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronDown, List as ListIcon, Pencil, Plus, Sparkles, Upload } from "lucide-react";
import type { Diagram as DiagramData } from "@/lib/diagrams";
import { buildTree, flattenTree, groupPath, type TreeGroup, type TreeTopic } from "@/lib/topic-tree";
import { aiApi, aiStream, api, getAiRequestHeaders, notifyAiSetupRequired, pendingRemovals, scheduleUndoDelete, useAISettings } from "../../components";
import { Chat, type ChatMessage } from "../../chat";
import { Diagram } from "../../diagram";
import { MathLine, MathText } from "../../math-text";
import { Badge, Button, Card, Checkbox, cn, ErrorMessage, Field, IconButton, Modal, Select, Spinner, Textarea } from "../../ui";
import { BrowseDialog } from "./browse";
import { selectionLabel, SelectionDialog, selectionQuery, type StudySelection } from "./selection";

type Rating = 1 | 2 | 3 | 4;
type Figures = { frontDiagram?: DiagramData | null; backDiagram?: DiagramData | null };
type ReviewCard = Figures & { id: string; topicId: string | null; topicName: string | null; front: string; back: string; intervals: Record<Rating, string>; messages: ChatMessage[] };
type Counts = { new: number; learning: number; review: number; total: number; nextDue: string | null };
type StoredCard = Figures & { id: string; archived: boolean; topicId: string | null; topicName: string | null; front: string; back: string; due: string; state: number };
type Draft = Figures & { front: string; back: string };
type GeneratedDraft = Draft & { topicId: string; topicName: string };
type Dialog = { kind: "add" | "import" | "generate" | "browse" } | { kind: "edit"; card: Figures & { id: string; topicId: string | null; front: string; back: string } };
const ratingLabels: { value: Rating; label: string }[] = [{ value: 1, label: "Again" }, { value: 2, label: "Hard" }, { value: 3, label: "Good" }, { value: 4, label: "Easy" }];

const DIAGRAMS_KEY = "tao-card-diagrams";
const DENSITY_KEY = "tao-card-density";
const densities = { brief: "Brief: one small fact, a few-word answer", standard: "Standard: one idea, a short answer", detailed: "Detailed: connected ideas, a fuller answer" };
type Density = keyof typeof densities;

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
  const generation = useGeneration(subjectId);
  const query = selectionQuery(selection);

  // Skips cards whose deletion is waiting on the undo toast.
  const load = useCallback(async () => {
    const exclude = pendingRemovals().slice(0, 100).map((id) => `&exclude=${id}`).join("");
    try {
      const result = await api<{ card: ReviewCard | null; counts: Counts }>(`/api/subjects/${subjectId}/cards/next?${query}${exclude}`);
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
      if (!card || dialog || event.metaKey || event.ctrlKey || event.altKey || document.querySelector("[role='dialog']")) return;
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

  async function askTutor(message: string, signal: AbortSignal) {
    if (!card) throw new Error("No card is open.");
    if (!ai.configured) { notifyAiSetupRequired(); throw new Error("Sign in to an AI account to continue."); }
    return aiApi<{ reply: string; diagram: DiagramData | null }>(`/api/cards/${card.id}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, revealed }), signal })
      .then((result) => ({ text: result.reply, diagram: result.diagram }));
  }
  async function summarizeChat(signal: AbortSignal) {
    if (!card) throw new Error("No card is open.");
    if (!ai.configured) { notifyAiSetupRequired(); throw new Error("Sign in to an AI account to summarize."); }
    return (await aiApi<{ summary: string }>(`/api/cards/${card.id}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ summarize: true }), signal })).summary;
  }


  function removeCard(id: string) {
    setDialog(null);
    scheduleUndoDelete(id, {
      message: "Card deleted.",
      commit: () => api(`/api/cards/${id}`, { method: "DELETE" }).then(() => {}),
      restore: () => void load(),
    });
    void load();
  }

  const defaultTopicId = selection.topicIds.length === 1 && !selection.groupIds.length ? selection.topicIds[0] : card?.topicId ?? null;
  const closeDialog = (changed: boolean) => { setDialog(null); if (changed) void load(); };

  const toolbar = <div className="flex flex-wrap items-center gap-2">
    <Button variant="ghost" className="max-sm:px-2" onClick={() => setDialog({ kind: "add" })}><Plus size={16} />Add</Button>
    <Button variant="ghost" className="max-sm:px-2" onClick={() => setDialog({ kind: "import" })}><Upload size={16} />Import</Button>
    <Button variant="ghost" className="max-sm:px-2" onClick={() => generation || ai.configured ? setDialog({ kind: "generate" }) : notifyAiSetupRequired()} disabled={!topics.length && !generation}
      title={generation ? "Review the generated cards" : undefined}>
      {generation?.running ? <><Spinner />Writing cards · {generation.cards.length}</> : generation ? <><Sparkles size={16} />Review {generation.cards.length} new</> : <><Sparkles size={16} />Generate</>}
    </Button>
    <Button variant="ghost" className="max-sm:px-2" onClick={() => setDialog({ kind: "browse" })} disabled={!counts?.total}><ListIcon size={16} />Browse</Button>
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
      : <div className="grid grid-cols-[minmax(0,1fr)_minmax(280px,360px)] items-start gap-6 max-split:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="p-6 max-sm:p-4">
            <div className="mb-4 flex items-center gap-2">
              {card.topicName && <Badge className="flex-initial" title={card.topicName}>{card.topicName}</Badge>}
              <IconButton size="sm" className="ml-auto" label="Edit card" onClick={() => setDialog({ kind: "edit", card })}><Pencil size={16} /></IconButton>
            </div>
            <MathText className="text-lg leading-relaxed whitespace-pre-wrap" text={card.front} />
            {card.frontDiagram && <Diagram className="mt-6" diagram={card.frontDiagram} />}
            {revealed && <div className="mt-6 border-t border-line pt-6">
              <MathText className="leading-relaxed whitespace-pre-wrap" text={card.back || "(No back)"} />
              {card.backDiagram && <Diagram className="mt-6" diagram={card.backDiagram} />}
            </div>}
          </Card>
          {!revealed ? <Button variant="primary" className="self-center" onClick={() => setRevealed(true)}>Show answer</Button>
            : <div className="grid grid-cols-4 gap-2 max-sm:grid-cols-2" role="group" aria-label="How well did you remember it?">
              {ratingLabels.map(({ value, label }) => <Button key={value} variant={value === 3 ? "primary" : "secondary"} disabled={rating !== null} onClick={() => void rate(value)} title={`${label} (${value})`}>
                {rating === value ? <Spinner /> : label}<span className="text-xs">{card.intervals[value]}</span>
              </Button>)}
            </div>}
        </div>
        <Chat key={card.id} draftKey={`chat:card:${card.id}`} expandable className="max-split:h-[min(32rem,75dvh)] split:sticky split:top-6 split:max-h-[calc(100dvh-48px)]" hint="Can I get a small hint?" initialMessages={card.messages} send={askTutor} summarize={summarizeChat} clear={() => api<void>(`/api/cards/${card.id}/chat`, { method: "DELETE" })} placeholder={revealed ? "Ask about this card…" : "Ask without seeing the answer…"} empty="Ask the tutor about this card, or use the lightbulb for a hint that keeps the answer hidden." />
      </div>}
    {dialog?.kind === "add" && <CardEditor subjectId={subjectId} topics={topics} groups={groups} topicId={defaultTopicId} onClose={closeDialog} />}
    {dialog?.kind === "edit" && <CardEditor subjectId={subjectId} topics={topics} groups={groups} card={dialog.card} topicId={dialog.card.topicId} onClose={closeDialog} onDelete={removeCard} />}
    {dialog?.kind === "import" && <ImportDialog subjectId={subjectId} topics={topics} groups={groups} topicId={defaultTopicId} onClose={closeDialog} />}
    {dialog?.kind === "generate" && <GenerateDialog subjectId={subjectId} topics={topics} groups={groups} selection={selection} onClose={closeDialog} />}
    {dialog?.kind === "browse" && <BrowseDialog<StoredCard> noun="card" url={`/api/subjects/${subjectId}/cards?${query}`} field="cards" endpoint={`/api/subjects/${subjectId}/cards`}
      columns="grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
      filters={{ new: { label: "New", test: (stored) => stored.state === 0 }, due: { label: "Due", test: (stored) => stored.state !== 0 && Date.parse(stored.due) <= Date.now() } }}
      sorts={{ due: { label: "Due soonest", compare: (a, b) => Number(a.state === 0) - Number(b.state === 0) || Date.parse(a.due) - Date.parse(b.due) },
        topic: { label: "By topic", compare: (a, b) => (a.topicName ?? "").localeCompare(b.topicName ?? "") } }}
      searchText={(stored) => `${stored.front}\n${stored.back}\n${stored.topicName ?? ""}`}
      cells={(stored) => <>
        <MathLine text={stored.front} />
        <MathLine className="text-muted" text={stored.back} />
        <span className="text-xs text-muted">{stored.state === 0 ? "New" : `Due ${new Date(stored.due).toLocaleDateString()}`}</span>
      </>}
      onOpen={(stored) => setDialog({ kind: "edit", card: stored })} onChange={() => void load()} onClose={() => closeDialog(false)} />}
  </>;
}

// Topics in tree order, labeled with their folder path.
function useTopicOptions(topics: TreeTopic[], groups: TreeGroup[]) {
  return useMemo(() => flattenTree(buildTree(groups, topics)).flatMap((node) => node.kind === "topic"
    ? [{ id: node.topic.id, label: [...groupPath(groups, node.topic.groupId), node.topic.name].join(" / ") }] : []), [groups, topics]);
}

// The topics a selection covers, in tree order; an empty selection covers every topic.
function selectedTopics({ topicIds, groupIds }: StudySelection, topics: TreeTopic[], groups: TreeGroup[]) {
  const ordered = flattenTree(buildTree(groups, topics)).flatMap((node) => node.kind === "topic" ? [node.topic] : []);
  if (!topicIds.length && !groupIds.length) return ordered;
  const inGroup = (groupId: string | null): boolean => groupId !== null && (groupIds.includes(groupId) || inGroup(groups.find((group) => group.id === groupId)?.parentId ?? null));
  return ordered.filter((topic) => topicIds.includes(topic.id) || inGroup(topic.groupId));
}

function TopicSelect({ topics, groups, value, onChange, allowNone }: { topics: TreeTopic[]; groups: TreeGroup[]; value: string | null; onChange: (id: string | null) => void; allowNone?: boolean }) {
  const options = useTopicOptions(topics, groups);
  return <Select aria-label="Topic" className="w-full" value={value ?? ""} onChange={(event) => onChange(event.target.value || null)}>
    {allowNone && <option value="">No topic</option>}
    {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
  </Select>;
}

// Adds cards one after another (staying open), or edits one card.
function CardEditor({ subjectId, topics, groups, card, topicId: initialTopicId, onClose, onDelete }: {
  subjectId: string; topics: TreeTopic[]; groups: TreeGroup[]; card?: Figures & { id: string; front: string; back: string }; topicId: string | null;
  onClose: (changed: boolean) => void; onDelete?: (id: string) => void;
}) {
  const [front, setFront] = useState(card?.front ?? "");
  const [back, setBack] = useState(card?.back ?? "");
  const [topicId, setTopicId] = useState(initialTopicId);
  const [removed, setRemoved] = useState<{ front?: boolean; back?: boolean }>({});
  const [saving, setSaving] = useState(false);
  const [added, setAdded] = useState(0);
  const [error, setError] = useState("");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!front.trim() || saving) return;
    setSaving(true); setError("");
    try {
      if (card) {
        await api(`/api/cards/${card.id}`, { method: "PATCH", headers: jsonHeaders(), body: JSON.stringify({ front, back, topicId,
          ...(removed.front ? { frontDiagram: null } : {}), ...(removed.back ? { backDiagram: null } : {}) }) });
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
      {card?.frontDiagram && !removed.front && <FigureRow diagram={card.frontDiagram} onRemove={() => setRemoved((current) => ({ ...current, front: true }))} />}
      <Field label="Back"><Textarea rows={4} value={back} maxLength={8000} onChange={(event) => setBack(event.target.value)} placeholder="Answer" /></Field>
      {card?.backDiagram && !removed.back && <FigureRow diagram={card.backDiagram} onRemove={() => setRemoved((current) => ({ ...current, back: true }))} />}
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

// A card's figure in the editor, which can be removed but not edited.
function FigureRow({ diagram, onRemove }: { diagram: DiagramData; onRemove: () => void }) {
  return <div className="flex items-start gap-2">
    <Diagram className="min-w-0 flex-1 rounded-md border border-line p-2" diagram={diagram} />
    <Button size="sm" variant="ghost" onClick={onRemove}>Remove figure</Button>
  </div>;
}

// A preview of cards before saving. With `kept`, each card has a checkbox; `showTopics` labels each with its topic.
function DraftList({ drafts, showTopics, kept, onToggle }: { drafts: (Draft & { topicName?: string })[]; showTopics?: boolean; kept?: Set<number>; onToggle?: (index: number) => void }) {
  const shown = kept ? drafts : drafts.slice(0, 50);
  return <>
    <ul className="max-h-[50vh] overflow-auto border-t border-line">
      {shown.map((draft, index) => <li key={index} className="border-b border-line">
        <label className={cn("flex gap-3 py-3 text-sm", kept && "cursor-pointer")}>
          {kept && <Checkbox className="mt-1" checked={kept.has(index)} onChange={() => onToggle?.(index)} />}
          <span className="grid min-w-0 flex-1 grid-cols-2 gap-4 max-sm:grid-cols-1">
            <span className="min-w-0">
              {showTopics && <span className="mb-1 block text-xs text-muted">{draft.topicName}</span>}
              <MathText className="whitespace-pre-wrap" text={draft.front} />
              {draft.frontDiagram && <Diagram className="mt-2" diagram={draft.frontDiagram} />}
            </span>
            <span className="min-w-0 text-muted">
              <MathText className="whitespace-pre-wrap" text={draft.back} />
              {draft.backDiagram && <Diagram className="mt-2" diagram={draft.backDiagram} />}
            </span>
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
      <Textarea rows={6} mathPreview={false} className="font-mono text-sm" value={text} onChange={(event) => setText(event.target.value)} placeholder={"One card per line, front and back separated by a tab or comma:\nWhat is \\(\\lim_{x\\to 0} \\frac{\\sin x}{x}\\)?\t1"} />
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

// Drafts cards for each topic the selection covers, a few topics at a time, showing each topic's drafts as they arrive,
// then saves the kept ones under their topics. Closing the dialog, Back, or Stop cancels the topics still being written.
// Cards being generated, per subject. They live outside the dialog and the page's components, so closing the dialog,
// changing the selection, or moving around the app keeps them coming; reloading the page loses them.
type Generation = { cards: GeneratedDraft[]; dropped: Set<number>; done: number; total: number; running: boolean; stopped: boolean; error: string; metadata: object; controller: AbortController };
const generations = new Map<string, Generation>();
const generationListeners = new Set<() => void>();

function setGeneration(subjectId: string, change: (current: Generation) => Partial<Generation>) {
  const current = generations.get(subjectId);
  if (!current) return;
  generations.set(subjectId, { ...current, ...change(current) });
  generationListeners.forEach((listener) => listener());
}

function clearGeneration(subjectId: string) {
  generations.get(subjectId)?.controller.abort();
  generations.delete(subjectId);
  generationListeners.forEach((listener) => listener());
}

function useGeneration(subjectId: string) {
  return useSyncExternalStore((listener) => { generationListeners.add(listener); return () => generationListeners.delete(listener); },
    () => generations.get(subjectId) ?? null, () => null);
}

// Writes cards for each topic, up to three topics at once, adding each card to the preview as soon as the model
// finishes it (with Claude; other models send a topic's cards together).
async function startGeneration(subjectId: string, topics: { id: string; name: string }[], options: { count: number | "auto"; diagrams: boolean; density: Density; instructions: string }) {
  clearGeneration(subjectId);
  const controller = new AbortController();
  generations.set(subjectId, { cards: [], dropped: new Set(), done: 0, total: topics.length, running: true, stopped: false, error: "", metadata: {}, controller });
  generationListeners.forEach((listener) => listener());
  const mine = () => generations.get(subjectId)?.controller === controller;
  let failure = "";
  let next = 0;
  const worker = async () => {
    for (let index = next++; index < topics.length && !controller.signal.aborted; index = next++) {
      const topic = topics[index];
      try {
        await aiStream<{ card?: Draft; done?: boolean; metadata?: object; error?: string }>(`/api/subjects/${subjectId}/cards/generate`, {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ topicId: topic.id, count: options.count, diagrams: options.diagrams, density: options.density, instructions: options.instructions.trim(),
            avoidFronts: generations.get(subjectId)?.cards.map((card) => card.front) ?? [] }),
        }, (event) => {
          if (event.error) throw new Error(event.error);
          if (!mine()) return;
          if (event.card) { const card = { ...event.card, topicId: topic.id, topicName: topic.name }; setGeneration(subjectId, (current) => ({ cards: [...current.cards, card] })); }
          if (event.metadata) { const metadata = event.metadata; setGeneration(subjectId, () => ({ metadata })); }
        });
      } catch (e) {
        if (!controller.signal.aborted) failure = `${topic.name}: ${e instanceof Error ? e.message : "Could not generate cards"}`;
      }
      if (mine()) setGeneration(subjectId, (current) => ({ done: current.done + 1 }));
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, topics.length) }, worker));
  if (mine()) setGeneration(subjectId, () => ({ running: false, error: failure }));
}

function GenerateDialog({ subjectId, topics, groups, selection: initialSelection, onClose }: { subjectId: string; topics: TreeTopic[]; groups: TreeGroup[]; selection: StudySelection; onClose: (changed: boolean) => void }) {
  const [selection, setSelection] = useState(initialSelection);
  const [choosing, setChoosing] = useState(false);
  const [count, setCount] = useState<number | "auto">("auto");
  const [instructions, setInstructions] = useState("");
  // Whether the model should draw figures on the cards; remembered in this browser.
  const [diagrams, setDiagrams] = useState(() => { try { return localStorage.getItem(DIAGRAMS_KEY) === "true"; } catch { return false; } });
  // How much each card holds; remembered in this browser.
  const [density, setDensity] = useState<Density>(() => {
    try { const stored = localStorage.getItem(DENSITY_KEY); return stored && stored in densities ? stored as Density : "standard"; } catch { return "standard"; }
  });
  const result = useGeneration(subjectId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const chosen = selectedTopics(selection, topics, groups);
  const progress = result?.running ? { done: result.done, total: result.total } : null;
  const dropped = result?.dropped ?? new Set<number>();
  const stop = () => { result?.controller.abort(); setGeneration(subjectId, () => ({ running: false, stopped: true })); };

  async function save() {
    if (!result) return;
    setSaving(true); setError("");
    const byTopic = new Map<string, Draft[]>();
    result.cards.forEach((card, index) => { if (!dropped.has(index)) byTopic.set(card.topicId, [...(byTopic.get(card.topicId) ?? []), card]); });
    try {
      for (const [topicId, cards] of byTopic) await saveDrafts(subjectId, cards, topicId, "ai", result.metadata);
      clearGeneration(subjectId);
      onClose(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save these cards"); setSaving(false); }
  }

  const several = chosen.length > 1;
  const keptCount = (result?.cards.length ?? 0) - dropped.size;
  const shownTopics = result ? result.total > 1 : several;
  // Closing the dialog leaves generation running; the toolbar shows its progress and reopens it.
  return <Modal title="Generate cards" subtitle={result ? (result.running ? "Cards keep coming if you close this. Uncheck any you don’t want." : "Uncheck any card you don’t want to keep.") : "From each topic’s coverage summary and linked resources."} onClose={() => onClose(false)} wide={Boolean(result)}>
    {!result ? <div className="flex flex-col gap-4">
      <Field label="Topics"><Button className="w-full justify-between" onClick={() => setChoosing(true)}>
        <span className="truncate">{selectionLabel(selection, topics, groups)}</span><ChevronDown size={16} className="flex-none" />
      </Button></Field>
      <Field label={several ? "How many per topic" : "How many"}><Select value={count} onChange={(event) => setCount(event.target.value === "auto" ? "auto" : Number(event.target.value))}>
        <option value="auto">Auto: as many as the material needs</option>
        {Array.from({ length: 30 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}</option>)}
      </Select></Field>
      <Field label="Card density"><Select value={density} onChange={(event) => {
        const value = event.target.value as Density;
        setDensity(value);
        try { localStorage.setItem(DENSITY_KEY, value); } catch { /* Keep it for this dialog only. */ }
      }}>
        {Object.entries(densities).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </Select></Field>
      <label className="flex cursor-pointer items-center gap-2 text-sm" title="Mermaid for structure such as processes and timelines, SVG for drawings such as geometry. Generated figures can be wrong.">
        <Checkbox checked={diagrams} onChange={(event) => {
          setDiagrams(event.target.checked);
          try { localStorage.setItem(DIAGRAMS_KEY, String(event.target.checked)); } catch { /* Keep it for this dialog only. */ }
        }} />
        Draw diagrams where they help
      </label>
      <Field label="Instructions (optional)"><Textarea rows={2} value={instructions} maxLength={1000} onChange={(event) => setInstructions(event.target.value)}
        placeholder="For example: focus on proofs, or use examples from the lecture notes" /></Field>
      {error && <ErrorMessage className="my-0">{error}</ErrorMessage>}
      <div className="flex justify-end gap-2">
        <Button onClick={() => onClose(false)}>Cancel</Button>
        <Button variant="primary" disabled={!chosen.length} onClick={() => void startGeneration(subjectId, chosen, { count, diagrams, density, instructions })}>{several ? `Generate for ${chosen.length} topics` : "Generate"}</Button>
      </div>
      {choosing && <SelectionDialog value={selection} topics={topics} groups={groups} applyLabel="Use selected" onClose={() => setChoosing(false)} onApply={(next) => { setChoosing(false); setSelection(next); }} />}
    </div> : <div className="flex flex-col gap-4">
      {progress && <div className="flex items-center gap-2 text-sm text-muted">
        <Spinner />{progress.total > 1 ? `Writing cards… ${progress.done} of ${progress.total} topics` : "Writing cards…"}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={stop}>Stop</Button>
      </div>}
      {result.cards.length > 0 ? <DraftList drafts={result.cards} showTopics={shownTopics} kept={new Set(result.cards.flatMap((_, index) => dropped.has(index) ? [] : [index]))}
        onToggle={(index) => setGeneration(subjectId, (current) => { const next = new Set(current.dropped); if (!next.delete(index)) next.add(index); return { dropped: next }; })} />
        : !progress && !result.error && !error && <p className="text-muted">{result.stopped ? "Stopped before any cards were written." : `Your existing cards already cover ${shownTopics ? "these topics" : "this topic"}.`}</p>}
      {(error || result.error) && <ErrorMessage className="my-0">{error || result.error}</ErrorMessage>}
      <div className="flex justify-end gap-2">
        <Button onClick={() => { clearGeneration(subjectId); setError(""); }} disabled={saving}>Discard</Button>
        <Button variant="primary" onClick={() => void save()} disabled={Boolean(progress) || saving || !keptCount}>{saving ? <><Spinner />Saving…</> : `Keep ${keptCount} cards`}</Button>
      </div>
    </div>}
  </Modal>;
}
