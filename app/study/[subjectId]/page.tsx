"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, CircleHelp, Send, ThumbsUp, TriangleAlert } from "lucide-react";
import { api, AppShell, LoadingCard, notifyAiSetupRequired, Subject, useAISettings } from "../../components";
import { MathText } from "../../math-text";

type Topic = { id: string; name: string };
type Problem = { id: string; topicId: string; prompt: string; difficulty: string; isReview?: boolean };
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
  const [topicId, setTopicId] = useState("");
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

  const generate = useCallback(async (requestedTopic = topicId, skipReuse = false) => {
    if (!ai.ready) return;
    if (!ai.configured) {
      setGenerating(false);
      setError("Sign in to Codex or Claude to practice.");
      notifyAiSetupRequired();
      return;
    }
    setWorking(true); setGenerating(true); setError("");
    try {
      const result = await api<{ problem: Problem }>(`/api/subjects/${subjectId}/problems`, { method: "POST", headers: aiHeaders(), body: JSON.stringify({ ...(requestedTopic ? { topicId: requestedTopic } : {}), ...(skipReuse ? { skipReuse: true } : {}) }) });
      setProblem(result.problem); setFeedback(null); setShowSolution(false); setAnswer(""); setRating("okay"); setChatText(""); setMessages([]);
      setShowProblemFeedback(false); setProblemFeedbackTags([]); setProblemFeedbackNote(""); setProblemFeedbackSaved(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create a problem"); }
    finally { setWorking(false); setGenerating(false); }
  }, [ai.configured, ai.ready, aiHeaders, subjectId, topicId]);

  // Load subject data independently so provider setup can finish before generation.
  useEffect(() => {
    const requestedTopic = new URLSearchParams(window.location.search).get("topic") ?? "";
    setTopicId(requestedTopic);
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
    void generate(topicId);
  }, [ai.configured, ai.ready, generate, loading, subjectLoaded, topicId, topics.length]);

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
      if (feedbackMode === "skip") await generate(topicId, true);
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
  const problemFeedbackForm = showProblemFeedback && <form className="card skip-feedback" onSubmit={submitProblemFeedback}>
    <div className="skip-feedback-heading">What should change? <span>Optional</span></div>
    <div className="skip-reasons">{skipReasons.map(reason => <button key={reason.value} type="button" className={`skip-reason ${problemFeedbackTags.includes(reason.value) ? "selected" : ""}`} aria-pressed={problemFeedbackTags.includes(reason.value)} onClick={() => setProblemFeedbackTags(current => current.includes(reason.value) ? current.filter(tag => tag !== reason.value) : [...current, reason.value])}>{reason.label}</button>)}</div>
    <textarea className="skip-note" rows={2} value={problemFeedbackNote} onChange={e => setProblemFeedbackNote(e.target.value)} maxLength={2000} placeholder="How could this problem be better?" />
    <div className="skip-actions"><button type="button" className="button" onClick={() => setShowProblemFeedback(false)} disabled={savingProblemFeedback}>Cancel</button><button className="button button-primary" disabled={savingProblemFeedback}>{savingProblemFeedback ? <><span className="spinner" />Saving…</> : feedbackMode === "skip" ? "Skip and continue" : "Save feedback"}</button></div>
  </form>;

  return <div className="content study-content">
      <Link href={`/subjects/${subjectId}`} className="study-back"><ArrowLeft size={18} />{subject?.name || "Subject"}</Link>
      {loading ? <LoadingCard /> : <>
        {!problem ? <div className="empty-state">{generating ? <p><span className="spinner" /> Making a problem…</p> : <>
          {error && <div className="error-message">{error}</div>}
          {topics.length > 0 && <button className="button button-primary" onClick={() => ai.ready && ai.configured ? generate() : notifyAiSetupRequired()} disabled={working}>{working ? <><span className="spinner" />Making a problem…</> : ai.ready && ai.configured ? "Try again" : "Configure AI"}</button>}
          <p><Link className="back-link" href={`/subjects/${subjectId}`}><ArrowLeft size={18} />Back to subject</Link></p>
        </>}</div> : <div className="study-layout">
          <div className="problem-column">
            <section className="card problem-card"><div className="problem-meta"><span className="topic-chip">{topics.find(t => t.id === problem.topicId)?.name || "Your course"}</span>{problem.isReview && <span className="review-chip">Review again</span>}<span className="difficulty-chip">{problem.difficulty === "easy" ? "Easy" : problem.difficulty === "hard" ? "Hard" : "Medium"}</span></div><MathText className="problem-prompt" text={problem.prompt} /></section>
            {error && <div className="error-message">{error}</div>}
            {!feedback ? <><form className="card answer-panel" onSubmit={submitAttempt}><textarea ref={answerInput} rows={4} className="answer-box" aria-label="Your answer" value={answer} onChange={e => setAnswer(e.target.value)} placeholder="Write your answer…" />
              {answer.includes("\\(") || answer.includes("\\[") ? <div className="answer-preview"><span>Math preview</span><MathText className="answer-preview-content" text={answer} /></div> : null}
              <div className="answer-control-row"><div className="difficulty-control"><div className="rating-label">Difficulty</div><div className="rating-row">{ratings.map(option => <button type="button" key={option.value} className={`rating-option ${rating === option.value ? "active" : ""}`} onClick={() => setRating(option.value)}>{option.label}</button>)}</div></div>
                <button className="button button-primary answer-submit" disabled={!answer.trim() || working}>{working ? <><span className="spinner" />Checking…</> : <>Check answer <ArrowRight size={13} /></>}</button></div>
            </form>
              {!showProblemFeedback ? <button type="button" className="skip-question" onClick={() => openProblemFeedback("skip")} disabled={working}>Skip question</button> : problemFeedbackForm}</> : <><section className={`feedback-card ${feedback.correctness}`}><div className="feedback-title"><FeedbackIcon size={15} />{correctnessLabel}</div><MathText className="feedback-copy" text={feedback.feedback} />{feedback.solution && <button className="solution-toggle" onClick={() => setShowSolution(v => !v)}>{showSolution ? "Hide worked solution" : "Show worked solution"}</button>}{showSolution && feedback.solution && <MathText className="math-block" text={feedback.solution} />}<div className="next-problem"><button className="button button-primary button-small" onClick={() => generate()} disabled={working}>{working ? <span className="spinner" /> : <>Try another problem <ArrowRight size={12} /></>}</button></div></section>
                {problemFeedbackSaved && <p className="feedback-saved" role="status">Thanks, your feedback will guide future questions on this topic.</p>}
                {!showProblemFeedback ? <button type="button" className="skip-question" onClick={() => openProblemFeedback("feedback")}>Give feedback on this problem</button> : problemFeedbackForm}
              </>}
          </div>
          <aside className="card chat-card"><div className="chat-head"><strong>Ask for a hint</strong></div><div className="chat-messages">{messages.map((message, i) => <MathText key={i} className={`chat-msg ${message.role}`} text={message.text} />)}{chatBusy && <div className="chat-msg assistant"><span className="spinner" />Thinking…</div>}</div><div className="chat-suggestions"><button className="suggestion" onClick={() => askTutor(undefined, "Can I get a small hint?")} disabled={chatBusy}>Hint</button></div><form className="chat-input-wrap" onSubmit={askTutor}><textarea className="chat-input" rows={2} value={chatText} onChange={e => setChatText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} placeholder="Where are you stuck?" /><button className="send-button" aria-label="Send message" disabled={!chatText.trim() || chatBusy}><Send size={17} /></button></form></aside>
        </div>}
      </>}
    </div>;
}
