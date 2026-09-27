"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, CircleHelp, Send, ThumbsUp, TriangleAlert } from "lucide-react";
import { api, AppShell, LoadingCard, Subject } from "../../components";
import { MathText } from "../../math-text";

type Topic = { id: string; name: string };
type Problem = { id: string; topicId: string; prompt: string; difficulty: string };
type Message = { role: "assistant" | "user"; text: string };
type Feedback = { feedback: string; correctness: "correct" | "partial" | "incorrect" | "uncertain"; solution?: string };
const ratings = [{ value: "easy", label: "Easy" }, { value: "okay", label: "Okay" }, { value: "hard", label: "Hard" }, { value: "could_not_solve", label: "Couldn’t solve" }];

function AIKeySettings({ apiKey, providerLabel, onChange, show, onToggle }: { apiKey: string; providerLabel: string; onChange: (value: string) => void; show: boolean; onToggle: () => void }) {
  return <details className="api-key-details"><summary>AI settings <span>{apiKey.trim() ? "OpenAI key entered" : providerLabel}</span></summary><div className="api-key-row"><label htmlFor="openai-key">OpenAI API key <span>Optional</span></label><div className="api-key-input"><input id="openai-key" type={show ? "text" : "password"} autoComplete="off" spellCheck={false} value={apiKey} onChange={e => onChange(e.target.value)} placeholder="sk-…" /><button type="button" onClick={onToggle}>{show ? "Hide" : "Show"}</button></div><p>Held in page memory only. Sent to this app when you request AI help and not saved in this browser. Leave it blank to use the configured provider.</p></div></details>;
}

export default function StudyPage() {
  const params = useParams<{ subjectId: string }>();
  const subjectId = params.subjectId;
  const [subject, setSubject] = useState<Subject | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicId, setTopicId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [providerLabel, setProviderLabel] = useState("Checking provider…");
  const [showApiKey, setShowApiKey] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [answer, setAnswer] = useState("");
  const [rating, setRating] = useState("okay");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [showSolution, setShowSolution] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatText, setChatText] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(true);
  const autoStarted = useRef(false);

  const aiHeaders = useCallback(() => {
    return { "Content-Type": "application/json", ...(apiKey.trim() ? { "x-openai-api-key": apiKey.trim() } : {}) };
  }, [apiKey]);

  const generate = useCallback(async (requestedTopic = topicId) => {
    setWorking(true); setGenerating(true); setError("");
    try {
      const result = await api<{ problem: Problem }>(`/api/subjects/${subjectId}/problems`, { method: "POST", headers: aiHeaders(), body: JSON.stringify(requestedTopic ? { topicId: requestedTopic } : {}) });
      setProblem(result.problem); setFeedback(null); setShowSolution(false); setAnswer(""); setRating("okay"); setChatText(""); setMessages([]);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create a problem"); }
    finally { setWorking(false); setGenerating(false); }
  }, [aiHeaders, subjectId, topicId]);

  // The ref prevents React Strict Mode from generating a duplicate first problem.
  useEffect(() => {
    api<{ label: string }>("/api/ai/status").then((status) => setProviderLabel(status.label)).catch(() => setProviderLabel("Provider unavailable"));
    if (autoStarted.current) return;
    autoStarted.current = true;
    const requestedTopic = new URLSearchParams(window.location.search).get("topic") ?? "";
    setTopicId(requestedTopic);
    api<{ subject: Subject; topics: Topic[] }>(`/api/subjects/${subjectId}`).then(async data => {
      setSubject(data.subject);
      document.title = `Tao - ${data.subject.name}`;
      setTopics(data.topics ?? []);
      if (!data.topics?.length) { setError("Add a topic before practicing."); setGenerating(false); return; }
      await generate(requestedTopic);
    }).catch(e => { setError(e.message); setGenerating(false); }).finally(() => setLoading(false));
  }, [subjectId, generate]);

  async function askTutor(e?: React.FormEvent, suggested?: string) {
    e?.preventDefault(); const content = (suggested ?? chatText).trim(); if (!content || !problem || chatBusy) return;
    setChatText(""); setMessages(items => [...items, { role: "user", text: content }]); setChatBusy(true);
    try {
      const result = await api<{ hint: string; index?: number }>(`/api/problems/${problem.id}/hints`, { method: "POST", headers: aiHeaders(), body: JSON.stringify({ message: content }) });
      setMessages(items => [...items, { role: "assistant", text: result.hint }]);
    } catch (e) { setMessages(items => [...items, { role: "assistant", text: e instanceof Error ? e.message : "I couldn’t get a hint just now. Try again in a moment." }]); }
    finally { setChatBusy(false); }
  }

  async function submitAttempt(e: React.FormEvent) {
    e.preventDefault(); if (!problem || !answer.trim()) return; setWorking(true); setError("");
    try {
      const result = await api<Feedback>(`/api/problems/${problem.id}/attempts`, { method: "POST", headers: aiHeaders(), body: JSON.stringify({ answer: answer.trim(), difficulty: rating }) });
      setFeedback(result); setShowSolution(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not check your answer"); }
    finally { setWorking(false); }
  }

  const correctnessLabel = feedback?.correctness === "correct" ? "That’s right" : feedback?.correctness === "partial" ? "Good progress" : feedback?.correctness === "incorrect" ? "Let’s work through it" : "Let’s take a closer look";
  const FeedbackIcon = feedback?.correctness === "correct" ? CheckCircle2 : feedback?.correctness === "incorrect" ? TriangleAlert : feedback?.correctness === "uncertain" ? CircleHelp : ThumbsUp;

  return <AppShell>
    <div className="content study-content">
      <Link href={`/subjects/${subjectId}`} className="study-back"><ArrowLeft size={18} />{subject?.name || "Subject"}</Link>
      {loading ? <LoadingCard /> : <>
        {!problem ? <div className="empty-state">{generating ? <p><span className="spinner" /> Making a problem…</p> : <>
          {error && <div className="error-message">{error}</div>}
          <AIKeySettings apiKey={apiKey} providerLabel={providerLabel} onChange={setApiKey} show={showApiKey} onToggle={() => setShowApiKey(v => !v)} />
          {topics.length > 0 && <button className="button button-primary" onClick={() => generate()} disabled={working}>{working ? <><span className="spinner" />Making a problem…</> : "Try again"}</button>}
          <p><Link className="back-link" href={`/subjects/${subjectId}`}><ArrowLeft size={18} />Back to subject</Link></p>
        </>}</div> : <div className="study-layout">
          <div className="problem-column">
            <AIKeySettings apiKey={apiKey} providerLabel={providerLabel} onChange={setApiKey} show={showApiKey} onToggle={() => setShowApiKey(v => !v)} />
            <section className="card problem-card"><div className="problem-meta"><span className="topic-chip">{topics.find(t => t.id === problem.topicId)?.name || "Your course"}</span><span className="difficulty-chip">{problem.difficulty === "easy" ? "Easy" : problem.difficulty === "hard" ? "Hard" : "Medium"}</span></div><MathText className="problem-prompt" text={problem.prompt} /></section>
            {!feedback ? <form className="card answer-panel" onSubmit={submitAttempt}><textarea className="answer-box" aria-label="Your answer" value={answer} onChange={e => setAnswer(e.target.value)} placeholder="Write your answer…" />
              <div className="rating-label">Difficulty</div><div className="rating-row">{ratings.map(option => <button type="button" key={option.value} className={`rating-option ${rating === option.value ? "active" : ""}`} onClick={() => setRating(option.value)}>{option.label}</button>)}</div>
              <div className="answer-actions"><button className="button button-primary" disabled={!answer.trim() || working}>{working ? <><span className="spinner" />Checking…</> : <>Check answer <ArrowRight size={13} /></>}</button></div>{error && <div className="error-message">{error}</div>}
            </form> : <section className={`feedback-card ${feedback.correctness}`}><div className="feedback-title"><FeedbackIcon size={15} />{correctnessLabel}</div><MathText className="feedback-copy" text={feedback.feedback} />{feedback.solution && <button className="solution-toggle" onClick={() => setShowSolution(v => !v)}>{showSolution ? "Hide worked solution" : "Show worked solution"}</button>}{showSolution && feedback.solution && <MathText className="math-block" text={feedback.solution} />}<div className="next-problem"><button className="button button-primary button-small" onClick={() => generate()} disabled={working}>{working ? <span className="spinner" /> : <>Try another problem <ArrowRight size={12} /></>}</button></div></section>}
          </div>
          <aside className="card chat-card"><div className="chat-head"><strong>Ask for a hint</strong></div><div className="chat-messages">{messages.map((message, i) => <MathText key={i} className={`chat-msg ${message.role}`} text={message.text} />)}{chatBusy && <div className="chat-msg assistant"><span className="spinner" />Thinking…</div>}</div><div className="chat-suggestions"><button className="suggestion" onClick={() => askTutor(undefined, "Can I get a small hint?")} disabled={chatBusy}>Hint</button></div><form className="chat-input-wrap" onSubmit={askTutor}><textarea className="chat-input" rows={2} value={chatText} onChange={e => setChatText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} placeholder="Where are you stuck?" /><button className="send-button" aria-label="Send message" disabled={!chatText.trim() || chatBusy}><Send size={17} /></button></form></aside>
        </div>}
      </>}
    </div>
  </AppShell>;
}
