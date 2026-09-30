"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, CircleHelp, List as ListIcon, RotateCcw, Sparkles, ThumbsUp, TriangleAlert } from "lucide-react";
import type { Diagram as DiagramData } from "@/lib/diagrams";
import { aiApi, api, isAbort, notifyAiSetupRequired, readDraft, saveDraft, useAISettings } from "../../components";
import { Chat, type ChatMessage } from "../../chat";
import { Diagram } from "../../diagram";
import { MathText } from "../../math-text";
import { Badge, Button, Card, cn, ErrorMessage, Field, Input, Modal, Select, Spinner, Textarea, ToggleButton } from "../../ui";
import { selectionQuery, type StudySelection } from "./selection";

type Problem = { id: string; topicId: string; prompt: string; difficulty: string; diagram?: DiagramData | null; isReview?: boolean; messages?: ChatMessage[] };
type Correctness = "correct" | "partial" | "incorrect" | "uncertain";
type Feedback = { feedback: string; correctness: Correctness; solution?: string; solutionDiagram?: DiagramData | null };
type Attempt = Feedback & { answer: string; rating: string };
type PastProblem = { id: string; topicName: string | null; prompt: string; difficulty: string; createdAt: string; attempts: number; correctness: Correctness | null; skipped: boolean };
const resultLabels: Record<Correctness, string> = { correct: "Correct", partial: "Partly right", incorrect: "Incorrect", uncertain: "Unsure" };
const ratings = [{ value: "easy", label: "Easy" }, { value: "okay", label: "Okay" }, { value: "hard", label: "Hard" }, { value: "could_not_solve", label: "Couldn’t solve" }];
const skipReasons = [
  { value: "too_easy", label: "Too easy" },
  { value: "repetitive", label: "Repetitive" },
  { value: "incorrect", label: "Incorrect" },
  { value: "outside_coverage", label: "Outside my course" },
  { value: "other", label: "Other" },
];
const difficulties = { auto: "Auto: from your review history", easy: "Easy", okay: "Medium", hard: "Hard" };
const answerDepths = { short: "Short: a value or a line or two", standard: "Standard: a few steps of working", full: "Full: a complete proof or derivation" };
type Settings = { difficulty: keyof typeof difficulties; answerDepth: keyof typeof answerDepths };
const SETTINGS_KEY = "tao-problem-settings";

// The difficulty and answer length new problems ask for; remembered in this browser.
function readSettings(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    return { difficulty: stored.difficulty in difficulties ? stored.difficulty : "auto", answerDepth: stored.answerDepth in answerDepths ? stored.answerDepth : "standard" };
  } catch { return { difficulty: "auto", answerDepth: "standard" }; }
}

// One generated problem at a time for the selection, with answer checking and the tutor chat.
// The parent remounts it when the selection changes.
export function Problems({ subjectId, topics, selection }: { subjectId: string; topics: { id: string; name: string }[]; selection: StudySelection }) {
  const ai = useAISettings();
  const [problem, setProblem] = useState<Problem | null>(null);
  const [answer, setAnswer] = useState("");
  const [rating, setRating] = useState("okay");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [showSolution, setShowSolution] = useState(false);
  const [feedbackMode, setFeedbackMode] = useState<"skip" | "feedback" | null>(null);
  const [problemFeedbackTags, setProblemFeedbackTags] = useState<string[]>([]);
  const [problemFeedbackNote, setProblemFeedbackNote] = useState("");
  const [savingProblemFeedback, setSavingProblemFeedback] = useState(false);
  const [problemFeedbackSaved, setProblemFeedbackSaved] = useState(false);
  const [working, setWorking] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [settings, setSettings] = useState(readSettings);
  const [choosingSettings, setChoosingSettings] = useState(false);
  // Counts problem loads so a slow generation cannot replace a problem opened from Browse meanwhile.
  const loadCount = useRef(0);
  // Stops the problem being made or the answer being checked.
  const stopper = useRef<AbortController | null>(null);
  const stop = () => stopper.current?.abort();
  const answerInput = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const input = answerInput.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  }, [answer]);

  const aiHeaders = useCallback(() => {
    const headers = new Headers(ai.requestHeaders);
    headers.set("Content-Type", "application/json");
    return headers;
  }, [ai.requestHeaders]);

  const show = useCallback((next: Problem, attempt: Attempt | null) => {
    setProblem(next); setFeedback(attempt); setShowSolution(false); setAnswer(readDraft(`answer:${next.id}`) || attempt?.answer || ""); setRating(attempt?.rating ?? "okay");
    setFeedbackMode(null); setProblemFeedbackTags([]); setProblemFeedbackNote(""); setProblemFeedbackSaved(false);
  }, []);

  // Problems are made only when the student asks, with the chosen settings.
  const generate = useCallback(async (skipReuse = false) => {
    if (!ai.configured) {
      setGenerating(false);
      setError("Sign in to an AI account to practice.");
      notifyAiSetupRequired();
      return;
    }
    const load = ++loadCount.current;
    const controller = new AbortController();
    stopper.current = controller;
    // The spinner and Stop take the problem's place while the next one is made.
    setProblem(null); setWorking(true); setGenerating(true); setError("");
    try {
      const result = await aiApi<{ problem: Problem }>(`/api/subjects/${subjectId}/problems`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...selection, ...settings, ...(skipReuse ? { skipReuse: true } : {}) }), signal: controller.signal });
      if (load === loadCount.current) show(result.problem, null);
    } catch (e) {
      if (load === loadCount.current && !isAbort(e)) setError(e instanceof Error ? e.message : "Could not create a problem");
    }
    finally { if (load === loadCount.current) { setWorking(false); setGenerating(false); stopper.current = null; } }
  }, [ai.configured, subjectId, selection, settings, show]);

  // Opens a past problem with its chat and latest attempt, replacing any problem still being generated.
  async function open(id: string) {
    setBrowsing(false);
    stop();
    const load = ++loadCount.current;
    setWorking(true); setError("");
    try {
      const result = await api<{ problem: Problem; attempt: Attempt | null }>(`/api/problems/${id}`);
      if (load === loadCount.current) show(result.problem, result.attempt);
    } catch (e) { if (load === loadCount.current) setError(e instanceof Error ? e.message : "Could not open the problem"); }
    finally { if (load === loadCount.current) { setWorking(false); setGenerating(false); } }
  }

  // Returns to the problem left unanswered in this selection, if any; otherwise the student makes one.
  useEffect(() => {
    const load = ++loadCount.current;
    api<{ problem: Problem | null }>(`/api/subjects/${subjectId}/problems/current?${selectionQuery(selection)}`)
      .then((result) => { if (load === loadCount.current && result.problem) show(result.problem, null); })
      .catch((e) => { if (load === loadCount.current) setError(e instanceof Error ? e.message : "Could not load practice"); })
      .finally(() => setLoading(false));
  }, [subjectId, selection, show]);

  function saveSettings(next: Settings) {
    setSettings(next);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* Keep them for this visit only. */ }
  }

  async function askTutor(message: string, signal: AbortSignal) {
    if (!problem) throw new Error("No problem is open.");
    if (!ai.configured) { notifyAiSetupRequired(); throw new Error("Sign in to an AI account to continue."); }
    const result = await aiApi<{ hint: string; diagram: DiagramData | null }>(`/api/problems/${problem.id}/hints`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }), signal });
    return { text: result.hint, diagram: result.diagram };
  }

  async function submitAttempt(e: React.FormEvent) {
    e.preventDefault(); if (!problem || !answer.trim()) return;
    if (!ai.ready || !ai.configured) { notifyAiSetupRequired(); setError("Sign in to an AI account to continue."); return; }
    const controller = new AbortController();
    stopper.current = controller;
    setWorking(true); setError("");
    try {
      const result = await aiApi<Feedback>(`/api/problems/${problem.id}/attempts`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: answer.trim(), difficulty: rating }), signal: controller.signal });
      setFeedback(result); setShowSolution(false); setFeedbackMode(null); saveDraft(`answer:${problem.id}`, "");
    } catch (e) { if (!isAbort(e)) setError(e instanceof Error ? e.message : "Could not check your answer"); }
    finally { setWorking(false); stopper.current = null; }
  }

  async function submitProblemFeedback(e: React.FormEvent) {
    e.preventDefault();
    if (!problem || savingProblemFeedback || working) return;
    setSavingProblemFeedback(true); setError("");
    try {
      const result = await api<{ saved: boolean }>(`/api/problems/${problem.id}/feedback`, {
        method: "POST", headers: aiHeaders(),
        body: JSON.stringify({ tags: problemFeedbackTags, note: problemFeedbackNote.trim(), skipped: feedbackMode === "skip" }),
      });
      const skipped = feedbackMode === "skip";
      setFeedbackMode(null);
      setProblemFeedbackSaved(result.saved);
      if (skipped) await generate(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save problem feedback"); }
    finally { setSavingProblemFeedback(false); }
  }

  function openProblemFeedback(mode: "skip" | "feedback") {
    setFeedbackMode(mode); setProblemFeedbackTags([]); setProblemFeedbackNote(""); setProblemFeedbackSaved(false);
  }

  const settingsFields = <>
    <Field label="Difficulty"><Select value={settings.difficulty} onChange={(event) => saveSettings({ ...settings, difficulty: event.target.value as Settings["difficulty"] })}>
      {Object.entries(difficulties).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </Select></Field>
    <Field label="Answer"><Select value={settings.answerDepth} onChange={(event) => saveSettings({ ...settings, answerDepth: event.target.value as Settings["answerDepth"] })}>
      {Object.entries(answerDepths).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </Select></Field>
  </>;
  const toolbar = <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
    {problem && <Button variant="ghost" onClick={() => ai.configured ? setChoosingSettings(true) : notifyAiSetupRequired()} disabled={working}><Sparkles size={16} />New problem</Button>}
    <Button variant="ghost" onClick={() => setBrowsing(true)}><ListIcon size={16} />Browse</Button>
  </div>;
  const dialogs = <>
    {browsing && <BrowseDialog subjectId={subjectId} selection={selection} onOpen={open} onClose={() => setBrowsing(false)} />}
    {choosingSettings && <Modal title="New problem" onClose={() => setChoosingSettings(false)}>
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); setChoosingSettings(false); void generate(true); }}>
        {settingsFields}
        <div className="flex justify-end gap-2"><Button onClick={() => setChoosingSettings(false)}>Cancel</Button><Button type="submit" variant="primary" autoFocus>Make problem</Button></div>
      </form>
    </Modal>}
  </>;

  if (!problem) return <>{toolbar}{loading ? <p className="inline-flex items-center gap-3 py-8 text-muted"><Spinner />Loading practice…</p>
    : generating ? <div className="flex items-center gap-3 py-8 text-muted"><Spinner />Making a problem…<Button size="sm" variant="ghost" onClick={stop}>Stop</Button></div>
    : <Card className="max-w-md p-6 max-sm:p-4">
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (ai.configured) void generate(); else notifyAiSetupRequired(); }}>
        {settingsFields}
        {error && <ErrorMessage className="my-0">{error}</ErrorMessage>}
        <Button type="submit" variant="primary" className="self-start">{ai.configured ? <><Sparkles size={16} />Make a problem</> : "Connect AI"}</Button>
      </form>
    </Card>}{dialogs}</>;

  const correctnessLabel = feedback?.correctness === "correct" ? "That’s right" : feedback?.correctness === "partial" ? "Good progress" : feedback?.correctness === "incorrect" ? "Let’s work through it" : "Let’s take a closer look";
  const FeedbackIcon = feedback?.correctness === "correct" ? CheckCircle2 : feedback?.correctness === "incorrect" ? TriangleAlert : feedback?.correctness === "uncertain" ? CircleHelp : ThumbsUp;
  const feedbackTone = feedback?.correctness === "correct" ? "border-success-line bg-success-soft" : feedback?.correctness === "incorrect" ? "border-danger-line bg-danger-soft" : "border-warning-line bg-warning-soft";

  return <>{toolbar}<div className="grid grid-cols-[minmax(0,1fr)_minmax(280px,360px)] items-start gap-6 max-lg:grid-cols-1">
    <div className="flex min-w-0 flex-col gap-4">
      <Card className="p-6 max-sm:p-4">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge title={topics.find(t => t.id === problem.topicId)?.name}>{topics.find(t => t.id === problem.topicId)?.name || "Your course"}</Badge>
          {problem.isReview && <Badge tone="neutral">Review again</Badge>}
          <Badge tone="neutral">{problem.difficulty === "easy" ? "Easy" : problem.difficulty === "hard" ? "Hard" : "Medium"}</Badge>
          <Button size="sm" variant="ghost" className="ml-auto text-muted" onClick={() => openProblemFeedback(feedback ? "feedback" : "skip")} disabled={working || feedbackMode !== null}>{feedback ? "Give feedback" : "Skip"}</Button>
        </div>
        <MathText className="text-lg leading-relaxed whitespace-pre-wrap" text={problem.prompt} />
        {problem.diagram && <Diagram className="mt-6" diagram={problem.diagram} />}
      </Card>
      {feedbackMode && <Card className="p-4"><form onSubmit={submitProblemFeedback}>
        <div className="mb-3 text-sm font-semibold">What should change? <span className="font-normal text-muted">Optional</span></div>
        <div className="mb-3 flex flex-wrap gap-2">{skipReasons.map(reason => <ToggleButton key={reason.value} pressed={problemFeedbackTags.includes(reason.value)} onClick={() => setProblemFeedbackTags(current => current.includes(reason.value) ? current.filter(tag => tag !== reason.value) : [...current, reason.value])}>{reason.label}</ToggleButton>)}</div>
        <Textarea className="text-sm" rows={2} value={problemFeedbackNote} onChange={e => setProblemFeedbackNote(e.target.value)} maxLength={2000} placeholder="How could this problem be better?" />
        <div className="mt-3 flex justify-end gap-2"><Button onClick={() => setFeedbackMode(null)} disabled={savingProblemFeedback}>Cancel</Button><Button type="submit" variant="primary" disabled={savingProblemFeedback}>{savingProblemFeedback ? <><Spinner />Saving…</> : feedbackMode === "skip" ? "Skip and continue" : "Save feedback"}</Button></div>
      </form></Card>}
      {problemFeedbackSaved && <p className="text-sm text-muted" role="status">Thanks, your feedback will guide future questions on this topic.</p>}
      {error && <ErrorMessage className="my-0">{error}</ErrorMessage>}
      {!feedback ? <Card className="p-4"><form onSubmit={submitAttempt}>
        <Textarea ref={answerInput} rows={4} className="min-h-32 border-0 px-0 hover:border-0" aria-label="Your answer" value={answer} onChange={e => { setAnswer(e.target.value); saveDraft(`answer:${problem.id}`, e.target.value); }} placeholder="Write your answer…" />
        {answer.includes("\\(") || answer.includes("\\[") ? <div className="mt-2 border-t border-line pt-3"><span className="text-xs text-muted">Math preview</span><MathText className="mt-1 whitespace-pre-wrap" text={answer} /></div> : null}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="How hard was it?">{ratings.map(option => <ToggleButton key={option.value} pressed={rating === option.value} onClick={() => setRating(option.value)}>{option.label}</ToggleButton>)}</div>
          <div className="flex items-center gap-2">
            {working && <Button size="sm" variant="ghost" onClick={stop}>Stop</Button>}
            <Button type="submit" size="sm" variant="primary" disabled={!answer.trim() || working}>{working ? <><Spinner />Checking…</> : <>Check answer <ArrowRight size={16} /></>}</Button>
          </div>
        </div>
      </form></Card> : <section className={cn("rounded-lg border p-6 max-sm:p-4", feedbackTone)}>
        <div className="mb-3 inline-flex items-center gap-2 font-semibold"><FeedbackIcon size={18} />{correctnessLabel}</div>
        <MathText className="leading-relaxed whitespace-pre-wrap" text={feedback.feedback} />
        {showSolution && feedback.solution && <div className="mt-4 border-t border-line pt-4">
          <MathText className="leading-relaxed whitespace-pre-wrap" text={feedback.solution} />
          {feedback.solutionDiagram && <Diagram className="mt-4" diagram={feedback.solutionDiagram} />}
        </div>}
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          {feedback.solution && <Button variant="ghost" onClick={() => setShowSolution(v => !v)}>{showSolution ? "Hide solution" : "Show solution"}</Button>}
          <Button variant="ghost" onClick={() => { setFeedback(null); setShowSolution(false); }} disabled={working}><RotateCcw size={16} />Try again</Button>
          <Button variant="primary" onClick={() => generate()} disabled={working}>Next problem <ArrowRight size={16} /></Button>
        </div>
      </section>}
    </div>
    <Chat key={problem.id} draftKey={`chat:problem:${problem.id}`} className="max-lg:h-[min(32rem,75dvh)] lg:sticky lg:top-6 lg:max-h-[calc(100dvh-48px)]" hint="Can I get a small hint?" initialMessages={problem.messages} send={askTutor} placeholder="Where are you stuck?" empty="Tell the tutor where you are stuck, or use the lightbulb for a hint." />
  </div>{dialogs}</>;
}

function BrowseDialog({ subjectId, selection, onOpen, onClose }: { subjectId: string; selection: StudySelection; onOpen: (id: string) => void; onClose: () => void }) {
  const [problems, setProblems] = useState<PastProblem[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ problems: PastProblem[] }>(`/api/subjects/${subjectId}/problems?${selectionQuery(selection)}`).then((result) => setProblems(result.problems)).catch((e) => setError(e.message));
  }, [subjectId, selection]);
  const needle = search.trim().toLocaleLowerCase();
  const shown = (problems ?? []).filter((problem) => !needle || `${problem.prompt}\n${problem.topicName ?? ""}`.toLocaleLowerCase().includes(needle));

  return <Modal title="Problems" subtitle={problems ? `${problems.length.toLocaleString()} in this selection` : "Loading…"} onClose={onClose} wide>
    <Input className="mb-4 w-full" aria-label="Search problems" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" autoFocus />
    {error && <ErrorMessage>{error}</ErrorMessage>}
    {!problems ? <p className="inline-flex items-center gap-3 text-muted"><Spinner />Loading problems…</p> : <ul className="border-t border-line">
      {shown.slice(0, 300).map((problem) => <li key={problem.id} className="border-b border-line">
        <button type="button" className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,12rem)_auto] items-center gap-4 py-3 text-left text-sm transition-colors hover:bg-hover max-sm:grid-cols-1" onClick={() => onOpen(problem.id)}>
          <span className="truncate">{problem.prompt}</span>
          <span className="truncate text-muted">{problem.topicName ?? "No topic"}</span>
          <span className="text-xs text-muted">{problem.correctness ? resultLabels[problem.correctness] : problem.skipped ? "Skipped" : "Not answered"} · {new Date(problem.createdAt).toLocaleDateString()}</span>
        </button>
      </li>)}
      {shown.length > 300 && <li className="py-3 text-sm text-muted">Showing 300 of {shown.length.toLocaleString()}. Search to narrow the list.</li>}
      {!shown.length && <li className="py-3 text-sm text-muted">{problems.length ? "No problems match." : "No problems yet."}</li>}
    </ul>}
  </Modal>;
}
