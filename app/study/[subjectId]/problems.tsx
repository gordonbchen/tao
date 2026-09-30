"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, CircleHelp, List as ListIcon, RotateCcw, ThumbsUp, TriangleAlert } from "lucide-react";
import type { Diagram as DiagramData } from "@/lib/diagrams";
import { api, notifyAiSetupRequired, useAISettings } from "../../components";
import { Chat, type ChatMessage } from "../../chat";
import { Diagram } from "../../diagram";
import { MathText } from "../../math-text";
import { Badge, Button, Card, cn, ErrorMessage, Input, Modal, Spinner, Textarea, ToggleButton } from "../../ui";
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
  const [generating, setGenerating] = useState(true);
  const [error, setError] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const autoStarted = useRef(false);
  // Counts problem loads so a slow generation cannot replace a problem opened from Browse meanwhile.
  const loadCount = useRef(0);
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
    setProblem(next); setFeedback(attempt); setShowSolution(false); setAnswer(attempt?.answer ?? ""); setRating(attempt?.rating ?? "okay");
    setFeedbackMode(null); setProblemFeedbackTags([]); setProblemFeedbackNote(""); setProblemFeedbackSaved(false);
  }, []);

  const generate = useCallback(async (skipReuse = false) => {
    if (!ai.configured) {
      setGenerating(false);
      setError("Sign in to Codex or Claude to practice.");
      notifyAiSetupRequired();
      return;
    }
    const load = ++loadCount.current;
    setWorking(true); setGenerating(true); setError("");
    try {
      const result = await api<{ problem: Problem }>(`/api/subjects/${subjectId}/problems`, { method: "POST", headers: aiHeaders(), body: JSON.stringify({ ...selection, ...(skipReuse ? { skipReuse: true } : {}) }) });
      if (load === loadCount.current) show(result.problem, null);
    } catch (e) { if (load === loadCount.current) setError(e instanceof Error ? e.message : "Could not create a problem"); }
    finally { if (load === loadCount.current) { setWorking(false); setGenerating(false); } }
  }, [ai.configured, aiHeaders, subjectId, selection, show]);

  // Opens a past problem with its chat and latest attempt, replacing any problem still being generated.
  async function open(id: string) {
    setBrowsing(false);
    const load = ++loadCount.current;
    setWorking(true); setError("");
    try {
      const result = await api<{ problem: Problem; attempt: Attempt | null }>(`/api/problems/${id}`);
      if (load === loadCount.current) show(result.problem, result.attempt);
    } catch (e) { if (load === loadCount.current) setError(e instanceof Error ? e.message : "Could not open the problem"); }
    finally { if (load === loadCount.current) { setWorking(false); setGenerating(false); } }
  }

  // The ref prevents React Strict Mode from generating duplicate first problems.
  useEffect(() => {
    if (!ai.ready || autoStarted.current) return;
    autoStarted.current = true;
    void generate();
  }, [ai.ready, generate]);

  async function askTutor(message: string) {
    if (!problem) throw new Error("No problem is open.");
    if (!ai.configured) { notifyAiSetupRequired(); throw new Error("Sign in to Codex or Claude to continue."); }
    const result = await api<{ hint: string; diagram: DiagramData | null }>(`/api/problems/${problem.id}/hints`, { method: "POST", headers: aiHeaders(), body: JSON.stringify({ message }) });
    return { text: result.hint, diagram: result.diagram };
  }

  async function submitAttempt(e: React.FormEvent) {
    e.preventDefault(); if (!problem || !answer.trim()) return;
    if (!ai.ready || !ai.configured) { notifyAiSetupRequired(); setError("Sign in to Codex or Claude to continue."); return; }
    setWorking(true); setError("");
    try {
      const result = await api<Feedback>(`/api/problems/${problem.id}/attempts`, { method: "POST", headers: aiHeaders(), body: JSON.stringify({ answer: answer.trim(), difficulty: rating }) });
      setFeedback(result); setShowSolution(false); setFeedbackMode(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not check your answer"); }
    finally { setWorking(false); }
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

  const toolbar = <div className="mb-4 flex justify-end">
    <Button variant="ghost" onClick={() => setBrowsing(true)}><ListIcon size={16} />Browse</Button>
  </div>;
  const browseDialog = browsing && <BrowseDialog subjectId={subjectId} selection={selection} onOpen={open} onClose={() => setBrowsing(false)} />;

  if (!problem) return <>{toolbar}<div className="flex flex-col items-start gap-4 py-8">{generating ? <p className="inline-flex items-center gap-3 text-muted"><Spinner />Making a problem…</p> : <>
    {error && <ErrorMessage className="my-0 w-full">{error}</ErrorMessage>}
    <Button variant="primary" onClick={() => ai.configured ? generate() : notifyAiSetupRequired()} disabled={working}>{ai.configured ? "Try again" : "Connect AI"}</Button>
  </>}</div>{browseDialog}</>;

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
        <Textarea ref={answerInput} rows={4} className="min-h-32 border-0 px-0 hover:border-0" aria-label="Your answer" value={answer} onChange={e => setAnswer(e.target.value)} placeholder="Write your answer…" />
        {answer.includes("\\(") || answer.includes("\\[") ? <div className="mt-2 border-t border-line pt-3"><span className="text-xs text-muted">Math preview</span><MathText className="mt-1 whitespace-pre-wrap" text={answer} /></div> : null}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="How hard was it?">{ratings.map(option => <ToggleButton key={option.value} pressed={rating === option.value} onClick={() => setRating(option.value)}>{option.label}</ToggleButton>)}</div>
          <Button type="submit" size="sm" variant="primary" disabled={!answer.trim() || working}>{working ? <><Spinner />Checking…</> : <>Check answer <ArrowRight size={16} /></>}</Button>
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
          <Button variant="primary" onClick={() => generate()} disabled={working}>{working ? <><Spinner />Making a problem…</> : <>Next problem <ArrowRight size={16} /></>}</Button>
        </div>
      </section>}
    </div>
    <Chat key={problem.id} className="max-lg:h-[min(32rem,75dvh)] lg:sticky lg:top-6 lg:max-h-[calc(100dvh-48px)]" hint="Can I get a small hint?" initialMessages={problem.messages} send={askTutor} placeholder="Where are you stuck?" empty="Tell the tutor where you are stuck, or use the lightbulb for a hint." />
  </div>{browseDialog}</>;
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

  return <Modal title="Problems" subtitle={problems ? `${problems.length.toLocaleString()} in this selection` : undefined} onClose={onClose} wide>
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
