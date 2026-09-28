"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, CircleHelp, Send, ThumbsUp, TriangleAlert } from "lucide-react";
import { api, AppShell, LoadingCard, notifyAiSetupRequired, Subject, useAISettings } from "../../components";
import { MathText } from "../../math-text";
import { Badge, Button, Card, cn, ErrorMessage, IconButton, Page, Spinner, Textarea, ToggleButton } from "../../ui";

type Topic = { id: string; name: string };
type Problem = { id: string; topicId: string; prompt: string; difficulty: string; isReview?: boolean; messages?: Message[] };
type Message = { role: "assistant" | "user"; text: string };
type Feedback = { feedback: string; correctness: "correct" | "partial" | "incorrect" | "uncertain"; solution?: string };
const ratings = [{ value: "easy", label: "Easy" }, { value: "okay", label: "Okay" }, { value: "hard", label: "Hard" }, { value: "could_not_solve", label: "Couldn’t solve" }];
const skipReasons = [
  { value: "too_easy", label: "Too easy" },
  { value: "repetitive", label: "Repetitive" },
  { value: "incorrect", label: "Incorrect" },
  { value: "outside_coverage", label: "Outside my course" },
  { value: "other", label: "Other" },
];

export default function StudyPage() {
  return <AppShell><StudyContent /></AppShell>;
}

function StudyContent() {
  const params = useParams<{ subjectId: string }>();
  const subjectId = params.subjectId;
  const ai = useAISettings();
  const [subject, setSubject] = useState<Subject | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  // One topic, a folder, or neither for any topic.
  const [selection, setSelection] = useState<{ topicId?: string; groupId?: string }>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const [answer, setAnswer] = useState("");
  const [rating, setRating] = useState("okay");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [showSolution, setShowSolution] = useState(false);
  const [showProblemFeedback, setShowProblemFeedback] = useState(false);
  const [feedbackMode, setFeedbackMode] = useState<"skip" | "feedback">("skip");
  const [problemFeedbackTags, setProblemFeedbackTags] = useState<string[]>([]);
  const [problemFeedbackNote, setProblemFeedbackNote] = useState("");
  const [savingProblemFeedback, setSavingProblemFeedback] = useState(false);
  const [problemFeedbackSaved, setProblemFeedbackSaved] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatText, setChatText] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(true);
  const [subjectLoaded, setSubjectLoaded] = useState(false);
  const autoStarted = useRef(false);
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

  const generate = useCallback(async (requested = selection, skipReuse = false) => {
    if (!ai.ready) return;
    if (!ai.configured) {
      setGenerating(false);
      setError("Sign in to Codex or Claude to practice.");
      notifyAiSetupRequired();
      return;
    }
    setWorking(true); setGenerating(true); setError("");
    try {
      const result = await api<{ problem: Problem }>(`/api/subjects/${subjectId}/problems`, { method: "POST", headers: aiHeaders(), body: JSON.stringify({ ...requested, ...(skipReuse ? { skipReuse: true } : {}) }) });
      setProblem(result.problem); setFeedback(null); setShowSolution(false); setAnswer(""); setRating("okay"); setChatText(""); setMessages(result.problem.messages ?? []);
      setShowProblemFeedback(false); setProblemFeedbackTags([]); setProblemFeedbackNote(""); setProblemFeedbackSaved(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create a problem"); }
    finally { setWorking(false); setGenerating(false); }
  }, [ai.configured, ai.ready, aiHeaders, subjectId, selection]);

  // Load subject data independently so provider setup can finish before generation.
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const topicId = search.get("topic");
    const groupId = search.get("group");
    setSelection(topicId ? { topicId } : groupId ? { groupId } : {});
    api<{ subject: Subject; topics: Topic[] }>(`/api/subjects/${subjectId}`).then(data => {
      setSubject(data.subject);
      document.title = `Tao - ${data.subject.name}`;
      setTopics(data.topics ?? []);
      if (!data.topics?.length) { setError("Add a topic before practicing."); setGenerating(false); }
      setSubjectLoaded(true);
    }).catch(e => { setError(e.message); setGenerating(false); }).finally(() => setLoading(false));
  }, [subjectId]);

  // The ref prevents React Strict Mode from generating duplicate first problems.
  useEffect(() => {
    if (!subjectLoaded || loading || !ai.ready || !topics.length || autoStarted.current) return;
    if (!ai.configured) {
      setGenerating(false);
      setError("Sign in to Codex or Claude to practice.");
      return;
    }
    autoStarted.current = true;
    void generate(selection);
  }, [ai.configured, ai.ready, generate, loading, subjectLoaded, selection, topics.length]);

  async function askTutor(e?: React.FormEvent, suggested?: string) {
    e?.preventDefault(); const content = (suggested ?? chatText).trim(); if (!content || !problem || chatBusy) return;
    if (!ai.ready || !ai.configured) { notifyAiSetupRequired(); setError("Sign in to Codex or Claude to continue."); return; }
    setChatText(""); setMessages(items => [...items, { role: "user", text: content }]); setChatBusy(true);
    try {
      const result = await api<{ hint: string; index?: number }>(`/api/problems/${problem.id}/hints`, { method: "POST", headers: aiHeaders(), body: JSON.stringify({ message: content }) });
      setMessages(items => [...items, { role: "assistant", text: result.hint }]);
    } catch (e) { setMessages(items => [...items, { role: "assistant", text: e instanceof Error ? e.message : "I couldn’t get a hint just now. Try again in a moment." }]); }
    finally { setChatBusy(false); }
  }

  async function submitAttempt(e: React.FormEvent) {
    e.preventDefault(); if (!problem || !answer.trim()) return;
    if (!ai.ready || !ai.configured) { notifyAiSetupRequired(); setError("Sign in to Codex or Claude to continue."); return; }
    setWorking(true); setError("");
    try {
      const result = await api<Feedback>(`/api/problems/${problem.id}/attempts`, { method: "POST", headers: aiHeaders(), body: JSON.stringify({ answer: answer.trim(), difficulty: rating }) });
      setFeedback(result); setShowSolution(false);
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
      setShowProblemFeedback(false);
      setProblemFeedbackSaved(result.saved);
      if (feedbackMode === "skip") await generate(selection, true);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save problem feedback"); }
    finally { setSavingProblemFeedback(false); }
  }

  function openProblemFeedback(mode: "skip" | "feedback") {
    setFeedbackMode(mode);
    setProblemFeedbackTags([]);
    setProblemFeedbackNote("");
    setProblemFeedbackSaved(false);
    setShowProblemFeedback(true);
  }

  const correctnessLabel = feedback?.correctness === "correct" ? "That’s right" : feedback?.correctness === "partial" ? "Good progress" : feedback?.correctness === "incorrect" ? "Let’s work through it" : "Let’s take a closer look";
  const FeedbackIcon = feedback?.correctness === "correct" ? CheckCircle2 : feedback?.correctness === "incorrect" ? TriangleAlert : feedback?.correctness === "uncertain" ? CircleHelp : ThumbsUp;
  const feedbackTone = feedback?.correctness === "correct" ? "border-success-line bg-success-soft" : feedback?.correctness === "incorrect" ? "border-danger-line bg-danger-soft" : "border-warning-line bg-warning-soft";
  const textLink = "inline-flex items-center gap-2 text-sm text-muted underline-offset-4 hover:text-ink hover:underline disabled:opacity-55";
  const problemFeedbackForm = showProblemFeedback && <Card className="p-4"><form onSubmit={submitProblemFeedback}>
    <div className="mb-3 text-sm font-semibold">What should change? <span className="font-normal text-muted">Optional</span></div>
    <div className="mb-3 flex flex-wrap gap-2">{skipReasons.map(reason => <ToggleButton key={reason.value} pressed={problemFeedbackTags.includes(reason.value)} onClick={() => setProblemFeedbackTags(current => current.includes(reason.value) ? current.filter(tag => tag !== reason.value) : [...current, reason.value])}>{reason.label}</ToggleButton>)}</div>
    <Textarea className="text-sm" rows={2} value={problemFeedbackNote} onChange={e => setProblemFeedbackNote(e.target.value)} maxLength={2000} placeholder="How could this problem be better?" />
    <div className="mt-3 flex justify-end gap-2"><Button onClick={() => setShowProblemFeedback(false)} disabled={savingProblemFeedback}>Cancel</Button><Button type="submit" variant="primary" disabled={savingProblemFeedback}>{savingProblemFeedback ? <><Spinner />Saving…</> : feedbackMode === "skip" ? "Skip and continue" : "Save feedback"}</Button></div>
  </form></Card>;

  return <Page className="max-w-6xl pt-8">
      <Link href={`/subjects/${subjectId}`} className={cn(textLink, "mb-6")}><ArrowLeft size={18} />{subject?.name || "Subject"}</Link>
      {loading ? <LoadingCard /> : <>
        {!problem ? <div className="flex flex-col items-start gap-4 py-8">{generating ? <p className="inline-flex items-center gap-3 text-muted"><Spinner />Making a problem…</p> : <>
          {error && <ErrorMessage className="w-full">{error}</ErrorMessage>}
          {topics.length > 0 && <Button variant="primary" onClick={() => ai.ready && ai.configured ? generate() : notifyAiSetupRequired()} disabled={working}>{working ? <><Spinner />Making a problem…</> : ai.ready && ai.configured ? "Try again" : "Configure AI"}</Button>}
          <Link className={textLink} href={`/subjects/${subjectId}`}><ArrowLeft size={18} />Back to subject</Link>
        </>}</div> : <div className="grid grid-cols-[minmax(0,1fr)_minmax(280px,360px)] items-start gap-6 max-lg:grid-cols-1">
          <div className="flex min-w-0 flex-col gap-4">
            <Card className="p-6 max-sm:p-4"><div className="mb-4 flex flex-wrap gap-2"><Badge>{topics.find(t => t.id === problem.topicId)?.name || "Your course"}</Badge>{problem.isReview && <Badge tone="neutral">Review again</Badge>}<Badge tone="neutral">{problem.difficulty === "easy" ? "Easy" : problem.difficulty === "hard" ? "Hard" : "Medium"}</Badge></div><MathText className="text-lg leading-relaxed whitespace-pre-wrap" text={problem.prompt} /></Card>
            {error && <ErrorMessage className="my-0">{error}</ErrorMessage>}
            {!feedback ? <><Card className="p-4"><form onSubmit={submitAttempt}><Textarea ref={answerInput} rows={4} className="min-h-32 border-0 px-0 hover:border-0" aria-label="Your answer" value={answer} onChange={e => setAnswer(e.target.value)} placeholder="Write your answer…" />
              {answer.includes("\\(") || answer.includes("\\[") ? <div className="mt-2 border-t border-line pt-3"><span className="text-xs text-muted">Math preview</span><MathText className="mt-1 whitespace-pre-wrap" text={answer} /></div> : null}
              <div className="mt-4 flex items-end justify-between gap-4 border-t border-line pt-4 max-sm:flex-col max-sm:items-stretch"><div><div className="mb-2 text-xs text-muted">Difficulty</div><div className="flex flex-wrap gap-2">{ratings.map(option => <ToggleButton key={option.value} pressed={rating === option.value} onClick={() => setRating(option.value)}>{option.label}</ToggleButton>)}</div></div>
                <Button type="submit" variant="primary" disabled={!answer.trim() || working}>{working ? <><Spinner />Checking…</> : <>Check answer <ArrowRight size={16} /></>}</Button></div>
            </form></Card>
              {!showProblemFeedback ? <button type="button" className={cn(textLink, "self-start")} onClick={() => openProblemFeedback("skip")} disabled={working}>Skip question</button> : problemFeedbackForm}</> : <><section className={cn("rounded-lg border p-6 max-sm:p-4", feedbackTone)}><div className="mb-3 inline-flex items-center gap-2 font-semibold"><FeedbackIcon size={18} />{correctnessLabel}</div><MathText className="leading-relaxed whitespace-pre-wrap" text={feedback.feedback} />{feedback.solution && <button type="button" className={cn(textLink, "mt-4")} onClick={() => setShowSolution(v => !v)}>{showSolution ? "Hide worked solution" : "Show worked solution"}</button>}{showSolution && feedback.solution && <MathText className="mt-3 border-t border-line pt-3 leading-relaxed whitespace-pre-wrap" text={feedback.solution} />}<div className="mt-4 flex justify-end"><Button variant="primary" onClick={() => generate()} disabled={working}>{working ? <Spinner /> : <>Try another problem <ArrowRight size={16} /></>}</Button></div></section>
                {problemFeedbackSaved && <p className="text-sm text-muted" role="status">Thanks, your feedback will guide future questions on this topic.</p>}
                {!showProblemFeedback ? <button type="button" className={cn(textLink, "self-start")} onClick={() => openProblemFeedback("feedback")}>Give feedback on this problem</button> : problemFeedbackForm}
              </>}
          </div>
          <Card className="flex flex-col lg:sticky lg:top-6 lg:max-h-[calc(100dvh-48px)]"><div className="border-b border-line px-4 py-3 text-sm font-semibold">Ask for a hint</div>
            <div className="flex min-h-24 flex-1 flex-col gap-3 overflow-auto p-4">{messages.map((message, i) => <MathText key={i} className={cn("max-w-[90%] rounded-lg px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap", message.role === "user" ? "self-end bg-accent-soft" : "self-start bg-subtle")} text={message.text} />)}{chatBusy && <div className="inline-flex items-center gap-2 self-start rounded-lg bg-subtle px-3 py-2 text-sm text-muted"><Spinner />Thinking…</div>}</div>
            <div className="px-4 pb-2"><Button size="sm" onClick={() => askTutor(undefined, "Can I get a small hint?")} disabled={chatBusy}>Hint</Button></div>
            <form className="flex items-end gap-2 border-t border-line p-3" onSubmit={askTutor}><Textarea className="text-sm" rows={2} value={chatText} onChange={e => setChatText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} placeholder="Where are you stuck?" /><IconButton type="submit" label="Send message" className="text-accent" disabled={!chatText.trim() || chatBusy}><Send size={18} /></IconButton></form>
          </Card>
        </div>}
      </>}
    </Page>;
}
