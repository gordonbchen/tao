"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, FileText, Pencil, Plus, Trash2, X, Check } from "lucide-react";
import { api, AppShell, isPendingRemoval, LoadingCard, scheduleUndoDelete, Subject } from "../../components";

type Topic = { id: string; name: string };
type Resource = { id: string; filename: string; contentType?: string; extractionStatus?: string; suggestedTopics?: string[] };
type ResourceText = Resource & { extractedText: string };

export default function SubjectPage() {
  const { subjectId: id } = useParams<{ subjectId: string }>();
  const router = useRouter();
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
    try { setResourceText(await api<ResourceText>(`/api/resources/${resource.id}`)); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load extracted text"); }
    finally { setResourceTextLoading(false); }
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

  return <AppShell><main className="content subject-content">
    <Link href="/" className="back-link"><ArrowLeft size={18} />Subjects</Link>
    {loading ? <LoadingCard /> : !subject ? <p>{error || "Subject not found."}</p> : <>
      <div className="subject-heading"><h1>{subject.name}</h1>
        <div className="practice-actions">
          <label className="visually-hidden" htmlFor="practice-topic">Topic to practice</label>
          <select id="practice-topic" value={selectedTopic} onChange={(event) => setSelectedTopic(event.target.value)} disabled={!topics.length}>
            <option value="">Any topic</option>{topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}
          </select>
          <button className="button button-primary" disabled={!topics.length} onClick={() => router.push(`/study/${id}${selectedTopic ? `?topic=${encodeURIComponent(selectedTopic)}` : ""}`)}>Practice</button>
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
    {resourceText && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setResourceText(null); }}><div className="modal resource-modal" role="dialog" aria-modal="true" aria-label={`Extracted text from ${resourceText.filename}`}><div className="modal-head"><h2>{resourceText.filename}</h2><button className="modal-close" aria-label="Close" onClick={() => setResourceText(null)}><X size={19} /></button></div><p className="resource-caption">Extracted text · {resourceText.extractedText.length.toLocaleString()} characters</p>{resourceText.extractedText ? <pre className="resource-extracted">{resourceText.extractedText}</pre> : <p>No selectable text was found in this file. Scanned PDFs need OCR, which is not available yet.</p>}</div></div>}
  </main></AppShell>;
}
