"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, FileText, Pencil, Plus, Trash2, X, Check } from "lucide-react";
import { api, AppShell, getAiRequestHeaders, isPendingRemoval, LoadingCard, notifyAiSetupRequired, scheduleUndoDelete, Subject, useAISettings } from "../../components";
import { MathText } from "../../math-text";

type Topic = { id: string; name: string };
type Resource = { id: string; filename: string; contentType?: string; extractionStatus?: string; summaryStatus?: string; suggestedTopics?: string[] };
type ResourceText = Resource & {
  extractedText: string;
  modelSummary: string;
  summaryStatus: "not_generated" | "pending" | "complete" | "failed";
  summaryProvider?: string | null;
  summaryModel?: string | null;
};
const resourceSummariesInProgress = new Set<string>();

export default function SubjectPage() {
  return <AppShell><SubjectContent /></AppShell>;
}

function SubjectContent() {
  const { subjectId: id } = useParams<{ subjectId: string }>();
  const router = useRouter();
  const aiSettings = useAISettings();
  const [subject, setSubject] = useState<Subject | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [topicName, setTopicName] = useState("");
  const [selectedTopic, setSelectedTopic] = useState("");
  const [editingTopic, setEditingTopic] = useState<string | null>(null);
  const [editedName, setEditedName] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<{ resource: Resource; topics: string[] } | null>(null);
  const [resourceText, setResourceText] = useState<ResourceText | null>(null);
  const [resourceTextLoading, setResourceTextLoading] = useState(false);
  const [resourceTab, setResourceTab] = useState<"summary" | "extracted">("summary");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const detail = await api<{ subject: Subject; topics: Topic[]; resources: Resource[] }>(`/api/subjects/${id}`);
      setSubject(detail.subject);
      setTopics((detail.topics ?? []).filter((topic) => !isPendingRemoval(topic.id)));
      setResources((detail.resources ?? []).filter((resource) => !isPendingRemoval(resource.id)));
      setSelectedTopic((current) => current && detail.topics.some((topic) => topic.id === current && !isPendingRemoval(topic.id)) ? current : "");
      document.title = `Tao - ${detail.subject.name}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load subject");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    refresh();
    const onRefresh = () => refresh();
    const onError = (event: Event) => setError((event as CustomEvent<string>).detail);
    window.addEventListener("tao:refresh", onRefresh);
    window.addEventListener("tao:error", onError);
    return () => {
      window.removeEventListener("tao:refresh", onRefresh);
      window.removeEventListener("tao:error", onError);
    };
  }, [refresh]);

  useEffect(() => {
    if (!resourceText) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setResourceText(null); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [resourceText]);

  async function addTopic(event: React.FormEvent) {
    event.preventDefault();
    const name = topicName.trim();
    if (!name) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/subjects/${id}/topics`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      setTopicName("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add topic");
    } finally {
      setBusy(false);
    }
  }

  async function saveTopic(topic: Topic) {
    const name = editedName.trim();
    if (!name || name === topic.name) { setEditingTopic(null); return; }
    try {
      await api(`/api/topics/${topic.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      setEditingTopic(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rename topic");
    }
  }

  function removeTopic(topic: Topic) {
    setTopics((current) => current.filter((item) => item.id !== topic.id));
    if (selectedTopic === topic.id) setSelectedTopic("");
    scheduleUndoDelete(topic.id, {
      message: `Removed ${topic.name}`,
      commit: async () => { await api(`/api/topics/${topic.id}`, { method: "DELETE" }); },
      restore: () => setTopics((current) => current.some((item) => item.id === topic.id) ? current : [...current, topic]),
    });
  }

  async function uploadFile(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const resource = await api<Resource>(`/api/subjects/${id}/resources`, { method: "POST", body: form });
      await refresh();
      if (resource.suggestedTopics?.length) setSuggestions({ resource, topics: resource.suggestedTopics });
      if (resource.extractionStatus !== "empty" && aiSettings.ready && aiSettings.configured) {
        setResources((current) => current.map((item) => item.id === resource.id ? { ...item, summaryStatus: "pending" } : item));
        void generateResourceSummary(resource.id);
      } else if (resource.extractionStatus !== "empty" && aiSettings.ready) {
        notifyAiSetupRequired();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function removeResource(resource: Resource) {
    setResources((current) => current.filter((item) => item.id !== resource.id));
    scheduleUndoDelete(resource.id, {
      message: `Removed ${resource.filename}`,
      commit: async () => { await api(`/api/resources/${resource.id}`, { method: "DELETE" }); },
      restore: () => setResources((current) => current.some((item) => item.id === resource.id) ? current : [...current, resource]),
    });
  }

  async function showResourceText(resource: Resource) {
    setResourceTextLoading(true);
    setError("");
    setSummaryError("");
    try {
      const detail = await api<ResourceText>(`/api/resources/${resource.id}`);
      setResourceText(detail);
      setResourceTab("summary");
      if (detail.summaryStatus === "not_generated" || detail.summaryStatus === "failed") void generateResourceSummary(resource.id);
    }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load extracted text"); }
    finally { setResourceTextLoading(false); }
  }

  async function generateResourceSummary(resourceId: string) {
    if (!aiSettings.ready) return;
    if (!aiSettings.configured) {
      notifyAiSetupRequired();
      setSummaryError("Configure an AI model in Settings to create a resource summary.");
      return;
    }
    if (resourceSummariesInProgress.has(resourceId)) return;
    resourceSummariesInProgress.add(resourceId);
    setSummaryLoading(true);
    setSummaryError("");
    try {
      const detail = await api<ResourceText>(`/api/resources/${resourceId}`, { method: "POST", headers: getAiRequestHeaders() });
      setResourceText((current) => current?.id === resourceId ? detail : current);
      setResources((current) => current.map((item) => item.id === resourceId ? { ...item, summaryStatus: "complete" } : item));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not create a resource summary";
      setSummaryError(message);
      if (message.includes("Configure an AI model")) notifyAiSetupRequired();
      setResourceText((current) => current?.id === resourceId ? { ...current, summaryStatus: message.includes("Configure an AI model") ? "not_generated" : "failed" } : current);
      setError(message);
    } finally {
      resourceSummariesInProgress.delete(resourceId);
      setSummaryLoading(false);
    }
  }

  async function addSuggestedTopic(name: string) {
    try {
      await api(`/api/subjects/${id}/topics`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      setSuggestions((current) => current && ({ ...current, topics: current.topics.filter((topic) => topic !== name) }));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add topic");
    }
  }

  return <main className="content subject-content">
    <Link href="/" className="back-link"><ArrowLeft size={18} />Subjects</Link>
    {loading ? <LoadingCard /> : !subject ? <p>{error || "Subject not found."}</p> : <>
      <div className="subject-heading"><h1>{subject.name}</h1>
        <div className="practice-actions">
          <label className="visually-hidden" htmlFor="practice-topic">Topic to practice</label>
          <select id="practice-topic" value={selectedTopic} onChange={(event) => setSelectedTopic(event.target.value)} disabled={!topics.length}>
            <option value="">Any topic</option>{topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}
          </select>
          <button className="button button-primary" disabled={!topics.length || !aiSettings.ready} onClick={() => { if (!aiSettings.configured) { notifyAiSetupRequired(); return; } router.push(`/study/${id}${selectedTopic ? `?topic=${encodeURIComponent(selectedTopic)}` : ""}`); }}>Practice</button>
        </div>
      </div>
      {error && <div className="error-message">{error}</div>}

      <section className="simple-section">
        <div className="section-title-row"><h2>Topics</h2><form className="simple-add topic-add" onSubmit={addTopic}><input aria-label="Topic name" value={topicName} maxLength={160} onChange={e => setTopicName(e.target.value)} placeholder="Add a topic" /><button className="button" disabled={!topicName.trim() || busy} aria-label="Add topic"><Plus size={18} /></button></form></div>
        {topics.length > 0 && <ul className="simple-list">{topics.map((topic) => <li key={topic.id}>
          {editingTopic === topic.id ? <form className="topic-edit" onSubmit={(event) => { event.preventDefault(); void saveTopic(topic); }}><input aria-label="Topic name" autoFocus maxLength={160} value={editedName} onChange={(event) => setEditedName(event.target.value)} /><button type="submit" className="icon-action" aria-label="Save topic name"><Check size={18} /></button><button type="button" className="icon-action" aria-label="Cancel editing" onClick={() => setEditingTopic(null)}><X size={18} /></button></form> : <><span>{topic.name}</span><button className="icon-action" aria-label={`Edit ${topic.name}`} title="Edit topic" onClick={() => { setEditingTopic(topic.id); setEditedName(topic.name); }}><Pencil size={16} /></button><button className="icon-action" aria-label={`Remove ${topic.name}`} title="Remove topic" onClick={() => removeTopic(topic)}><Trash2 size={18} /></button></>}
        </li>)}</ul>}
        {topics.length === 0 && <p className="quiet-empty">Add a topic to start practicing.</p>}
      </section>

      <section className="simple-section">
        <div className="section-title-row"><h2>Resources</h2><button className="button" type="button" onClick={() => fileRef.current?.click()} disabled={busy}><Plus size={18} />Add</button></div>
        <input ref={fileRef} type="file" accept=".pdf,.txt,.md,text/plain,application/pdf" hidden onChange={e => uploadFile(e.target.files?.[0])} />
        {resources.length > 0 && <ul className="simple-list resource-list">{resources.map((resource) => <li key={resource.id}><FileText size={18} /><button className="resource-open" type="button" onClick={() => void showResourceText(resource)} disabled={resourceTextLoading} title="View extracted text">{resource.filename}</button><button className="icon-action" aria-label={`Remove ${resource.filename}`} title="Remove resource" onClick={() => removeResource(resource)}><Trash2 size={18} /></button></li>)}</ul>}
      </section>
    </>}

    {suggestions && suggestions.topics.length > 0 && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setSuggestions(null); }}><div className="modal"><div className="modal-head"><h2>Suggested topics</h2><button className="modal-close" aria-label="Close" onClick={() => setSuggestions(null)}>×</button></div><ul className="simple-list">{suggestions.topics.map((topic) => <li key={topic}><span>{topic}</span><button className="button" onClick={() => addSuggestedTopic(topic)}><Plus size={18} />Add</button></li>)}</ul><div className="modal-actions"><button className="button" onClick={() => setSuggestions(null)}>Done</button></div></div></div>}
    {resourceText && <div className="modal-backdrop resource-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setResourceText(null); }}><div className="modal resource-modal" role="dialog" aria-modal="true" aria-label={`Summary and extracted text from ${resourceText.filename}`}>
      <div className="modal-head"><h2>{resourceText.filename}</h2><button className="modal-close" aria-label="Close" onClick={() => setResourceText(null)}><X size={19} /></button></div>
      <div className="resource-tabs" role="tablist" aria-label="Resource content">
        <button type="button" role="tab" aria-selected={resourceTab === "summary"} className={resourceTab === "summary" ? "active" : ""} onFocus={() => setResourceTab("summary")} onKeyDown={(event) => { if (event.key === "ArrowRight") { event.preventDefault(); setResourceTab("extracted"); (event.currentTarget.nextElementSibling as HTMLButtonElement | null)?.focus(); } }} onClick={() => setResourceTab("summary")}>Summary</button>
        <button type="button" role="tab" aria-selected={resourceTab === "extracted"} className={resourceTab === "extracted" ? "active" : ""} onFocus={() => setResourceTab("extracted")} onKeyDown={(event) => { if (event.key === "ArrowLeft") { event.preventDefault(); setResourceTab("summary"); (event.currentTarget.previousElementSibling as HTMLButtonElement | null)?.focus(); } }} onClick={() => setResourceTab("extracted")}>Extracted text <span>{resourceText.extractedText.length.toLocaleString()}</span></button>
      </div>
      {resourceTab === "summary" ? <section className="resource-summary" role="tabpanel" aria-label="Model summary">
        {summaryError && <p className="error-message" role="alert">{summaryError}</p>}
        {summaryLoading || resourceText.summaryStatus === "pending" ? <div className="resource-summary-state"><span className="spinner" /> Summarizing this resource…{!summaryLoading && <button type="button" className="button" onClick={() => void generateResourceSummary(resourceText.id)}>Retry if stalled</button>}</div> : resourceText.summaryStatus === "complete" && resourceText.modelSummary ? <>
          <p className="resource-caption">Model summary{resourceText.summaryProvider ? ` · ${resourceText.summaryProvider}${resourceText.summaryModel ? ` · ${resourceText.summaryModel}` : ""}` : ""}</p>
          <MathText className="resource-summary-text" text={resourceText.modelSummary} />
        </> : <div className="resource-summary-empty">
          <p>{resourceText.summaryStatus === "not_generated" ? "A model summary captures the key definitions, results, methods, and examples in this resource." : "The model could not summarize this resource."}</p>
          {resourceText.extractedText ? <button type="button" className="button" onClick={() => void generateResourceSummary(resourceText.id)} disabled={summaryLoading}>{summaryLoading ? "Summarizing…" : resourceText.summaryStatus === "failed" ? "Try again" : "Create summary"}</button> : <p>No selectable text was found in this file. Scanned PDFs need OCR, which is not available yet.</p>}
        </div>}
      </section> : <section role="tabpanel" aria-label="Extracted text"><p className="resource-caption">Text extracted from this file</p>{resourceText.extractedText ? <pre className="resource-extracted">{resourceText.extractedText}</pre> : <p>No selectable text was found in this file. Scanned PDFs need OCR, which is not available yet.</p>}</section>}
    </div></div>}
  </main>;
}
