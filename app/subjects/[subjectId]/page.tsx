"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, BookOpen, FileText, Pencil, Plus, Trash2, X, Check, Unlink } from "lucide-react";
import { api, AppShell, getAiRequestHeaders, isPendingRemoval, LoadingCard, notifyAiSetupRequired, scheduleUndoDelete, Subject, useAISettings } from "../../components";
import { MarkdownMathText } from "../../math-text";

type Topic = { id: string; name: string; summaryStatus?: string };
type Resource = { id: string; filename: string; contentType?: string; extractionStatus?: string; summaryStatus?: string; topicIds?: string[]; suggestedTopics?: string[] };
type LinkedTopic = { id: string; name: string };
type LinkedResource = { id: string; filename: string };
type TopicDetail = Topic & { subjectId: string; coverageSummary: string; summaryProvider?: string | null; summaryModel?: string | null; resources: LinkedResource[] };
type ResourceText = Resource & {
  extractedText: string;
  modelSummary: string;
  summaryStatus: "not_generated" | "pending" | "complete" | "failed";
  summaryProvider?: string | null;
  summaryModel?: string | null;
  topics: LinkedTopic[];
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
  const [uploadProgress, setUploadProgress] = useState("");
  const [suggestionQueue, setSuggestionQueue] = useState<{ resource: Resource; topics: string[] }[]>([]);
  const suggestions = suggestionQueue[0] ?? null;
  const [resourceText, setResourceText] = useState<ResourceText | null>(null);
  const [resourceTextLoading, setResourceTextLoading] = useState(false);
  const [resourceTab, setResourceTab] = useState<"summary" | "extracted">("summary");
  const [topicDetail, setTopicDetail] = useState<TopicDetail | null>(null);
  const [topicTab, setTopicTab] = useState<"summary" | "resources">("summary");
  const [summarizingTopicIds, setSummarizingTopicIds] = useState<string[]>([]);
  const [topicSummaryErrors, setTopicSummaryErrors] = useState<Record<string, string>>({});
  const [topicEditingSummary, setTopicEditingSummary] = useState(false);
  const [selectedTopicResources, setSelectedTopicResources] = useState<string[]>([]);
  const [resourceSearch, setResourceSearch] = useState("");
  const [savingTopicIds, setSavingTopicIds] = useState<string[]>([]);
  const [resourceTopicChoice, setResourceTopicChoice] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const activeTopicIdRef = useRef<string | null>(null);
  const summariesInProgress = useRef(new Set<string>());
  const summariesQueued = useRef(new Set<string>());

  useEffect(() => { activeTopicIdRef.current = topicDetail?.id ?? null; }, [topicDetail?.id]);
  function setTopicSummaryError(topicId: string, message: string) {
    setTopicSummaryErrors((current) => ({ ...current, [topicId]: message }));
  }

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
    if (!resourceText && !topicDetail) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { setResourceText(null); setTopicDetail(null); } };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [resourceText, topicDetail]);

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

  async function uploadFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (!files.length) return;
    setBusy(true);
    setError("");
    const uploaded: Resource[] = [];
    const failed: string[] = [];
    try {
      for (const [index, file] of files.entries()) {
        setUploadProgress(`Adding ${index + 1} of ${files.length}…`);
        try {
          const form = new FormData();
          form.append("file", file);
          const resource = await api<Resource>(`/api/subjects/${id}/resources`, { method: "POST", headers: getAiRequestHeaders(), body: form });
          uploaded.push(resource);
          if (resource.suggestedTopics?.length) setSuggestionQueue((current) => [...current, { resource, topics: resource.suggestedTopics! }]);
          await refresh();
        } catch (e) {
          failed.push(`${file.name}: ${e instanceof Error ? e.message : "Upload failed"}`);
        }
      }
    } finally {
      setBusy(false);
      setUploadProgress("");
      if (fileRef.current) fileRef.current.value = "";
    }
    if (failed.length) setError(failed.join("\n"));
    if (aiSettings.ready && aiSettings.configured) {
      void (async () => {
        for (const resource of uploaded.filter((item) => item.extractionStatus !== "empty")) await generateResourceSummary(resource.id);
      })();
    } else if (uploaded.some((item) => item.extractionStatus !== "empty") && aiSettings.ready) {
      notifyAiSetupRequired();
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
    setTopicDetail(null);
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

  async function showTopic(topic: Topic) {
    setResourceText(null);
    setTopicSummaryError(topic.id, "");
    setSelectedTopicResources([]);
    setResourceSearch("");
    setTopicEditingSummary(false);
    try {
      const detail = await api<TopicDetail>(`/api/topics/${topic.id}`);
      setTopicDetail(detail);
      setSelectedTopicResources(detail.resources.map((resource) => resource.id));
      setTopicTab("summary");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load topic"); }
  }

  async function refreshTopic(topicId: string) {
    const detail = await api<TopicDetail>(`/api/topics/${topicId}`);
    if (activeTopicIdRef.current === topicId) {
      setTopicDetail(detail);
      setSelectedTopicResources(detail.resources.map((resource) => resource.id));
    }
    return detail;
  }

  async function saveTopicResources() {
    if (!topicDetail || savingTopicIds.includes(topicDetail.id) || summarizingTopicIds.includes(topicDetail.id)) return;
    const topicId = topicDetail.id;
    const resourceIds = [...selectedTopicResources];
    setSavingTopicIds((current) => [...current, topicId]);
    setTopicSummaryError(topicId, "");
    try {
      const result = await api<{ changed: boolean }>(`/api/topics/${topicId}/resources`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resourceIds }),
      });
      await refreshTopic(topicId);
      setResources((current) => current.map((resource) => ({ ...resource,
        topicIds: resourceIds.includes(resource.id)
          ? [...new Set([...(resource.topicIds ?? []), topicId])]
          : (resource.topicIds ?? []).filter((linkedId) => linkedId !== topicId),
      })));
      if (activeTopicIdRef.current === topicId) setTopicTab("summary");
      if (result.changed && resourceIds.length) void generateTopicSummary(topicId);
    } catch (e) { setTopicSummaryError(topicId, e instanceof Error ? e.message : "Could not save linked resources"); }
    finally { setSavingTopicIds((current) => current.filter((id) => id !== topicId)); }
  }

  async function generateTopicSummary(topicId: string) {
    if (!aiSettings.ready) return;
    if (!aiSettings.configured) { notifyAiSetupRequired(); setTopicSummaryError(topicId, "Connect a local Codex or Claude sidecar to create a topic summary."); return; }
    if (summariesInProgress.current.has(topicId)) { summariesQueued.current.add(topicId); return; }
    summariesInProgress.current.add(topicId);
    setSummarizingTopicIds((current) => [...current, topicId]);
    setTopicSummaryError(topicId, "");
    try {
      do {
        summariesQueued.current.delete(topicId);
        try {
          const summary = await api<Pick<TopicDetail, "id" | "name" | "coverageSummary" | "summaryProvider" | "summaryModel" | "summaryStatus">>(`/api/topics/${topicId}/summary`, { method: "POST", headers: getAiRequestHeaders() });
          setTopicDetail((current) => current?.id === topicId ? { ...current, ...summary } : current);
          setTopics((current) => current.map((topic) => topic.id === topicId ? { ...topic, summaryStatus: "complete" } : topic));
        } catch (e) {
          const message = e instanceof Error ? e.message : "Could not create a topic summary";
          setTopicSummaryError(topicId, message);
          if (/(Codex|Claude) sidecar|(Codex|Claude) is (unavailable|not signed in)/i.test(message)) notifyAiSetupRequired();
          setTopicDetail((current) => current?.id === topicId ? { ...current, summaryStatus: "failed" } : current);
          break;
        }
      } while (summariesQueued.current.has(topicId));
    } finally {
      summariesInProgress.current.delete(topicId);
      setSummarizingTopicIds((current) => current.filter((id) => id !== topicId));
    }
  }

  async function saveTopicSummary() {
    if (!topicDetail) return;
    const topicId = topicDetail.id;
    try {
      const updated = await api<Pick<TopicDetail, "id" | "coverageSummary" | "summaryStatus" | "summaryProvider" | "summaryModel">>(`/api/topics/${topicId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ coverageSummary: topicDetail.coverageSummary }) });
      setTopicDetail((current) => current?.id === topicId ? { ...current, ...updated } : current);
      setTopics((current) => current.map((topic) => topic.id === updated.id ? { ...topic, summaryStatus: "complete" } : topic));
      if (activeTopicIdRef.current === topicId) setTopicEditingSummary(false);
    } catch (e) { setTopicSummaryError(topicId, e instanceof Error ? e.message : "Could not save topic summary"); }
  }

  async function attachResource(topicId: string, resourceId: string) {
    if (!resourceId) return;
    try {
      await api(`/api/topics/${topicId}/resources`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resourceId }) });
      await refreshTopic(topicId);
      setResources((current) => current.map((resource) => resource.id === resourceId ? { ...resource, topicIds: [...new Set([...(resource.topicIds ?? []), topicId])] } : resource));
      setResourceText((current) => current ? { ...current, topics: current.topics.some((topic) => topic.id === topicId) ? current.topics : [...current.topics, { id: topicId, name: topics.find((topic) => topic.id === topicId)?.name ?? "Topic" }] } : current);
      setResourceTopicChoice("");
      void generateTopicSummary(topicId);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not link resource"); }
  }

  async function unlinkResource(topicId: string, resourceId: string) {
    try {
      await api(`/api/topics/${topicId}/resources/${resourceId}`, { method: "DELETE" });
      const detail = await api<TopicDetail>(`/api/topics/${topicId}`);
      if (topicDetail?.id === topicId) { setTopicDetail(detail); setSelectedTopicResources(detail.resources.map((resource) => resource.id)); }
      setResources((current) => current.map((resource) => resource.id === resourceId ? { ...resource, topicIds: (resource.topicIds ?? []).filter((id) => id !== topicId) } : resource));
      setResourceText((current) => current ? { ...current, topics: current.topics.filter((topic) => topic.id !== topicId) } : current);
      if (detail.resources.length) void generateTopicSummary(topicId);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not unlink resource"); }
  }

  async function generateResourceSummary(resourceId: string) {
    if (!aiSettings.ready) return;
    if (!aiSettings.configured) {
      notifyAiSetupRequired();
      setSummaryError("Connect a local Codex or Claude sidecar to create a resource summary.");
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
      const setupRequired = /(Codex|Claude) sidecar|(Codex|Claude) is (unavailable|not signed in)/i.test(message);
      if (setupRequired) notifyAiSetupRequired();
      setResourceText((current) => current?.id === resourceId ? { ...current, summaryStatus: setupRequired ? "not_generated" : "failed" } : current);
      setError(message);
    } finally {
      resourceSummariesInProgress.delete(resourceId);
      setSummaryLoading(false);
    }
  }

  async function addSuggestedTopic(name: string) {
    const sourceResource = suggestions?.resource;
    if (!sourceResource) return;
    try {
      const topic = await api<Topic>(`/api/subjects/${id}/topics`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      await api(`/api/topics/${topic.id}/resources`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resourceId: sourceResource.id }) });
      setResources((current) => current.map((resource) => resource.id === sourceResource.id ? { ...resource, topicIds: [...new Set([...(resource.topicIds ?? []), topic.id])] } : resource));
      setSuggestionQueue((current) => {
        if (!current.length || current[0].resource.id !== sourceResource.id) return current;
        const remaining = current[0].topics.filter((topic) => topic !== name);
        return remaining.length ? [{ ...current[0], topics: remaining }, ...current.slice(1)] : current.slice(1);
      });
      await refresh();
      void generateTopicSummary(topic.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add topic");
    }
  }

  const selectedResources = resources.filter((resource) => selectedTopicResources.includes(resource.id));
  const availableResources = resources.filter((resource) => !selectedTopicResources.includes(resource.id)
    && resource.filename.toLocaleLowerCase().includes(resourceSearch.trim().toLocaleLowerCase()));

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
          {editingTopic === topic.id ? <form className="topic-edit" onSubmit={(event) => { event.preventDefault(); void saveTopic(topic); }}><input aria-label="Topic name" autoFocus maxLength={160} value={editedName} onChange={(event) => setEditedName(event.target.value)} /><button type="submit" className="icon-action" aria-label="Save topic name"><Check size={18} /></button><button type="button" className="icon-action" aria-label="Cancel editing" onClick={() => setEditingTopic(null)}><X size={18} /></button></form> : <><button type="button" className="topic-open" onClick={() => void showTopic(topic)} title="View topic summary and linked resources"><BookOpen size={17} /><span>{topic.name}</span></button><button className="icon-action" aria-label={`Edit ${topic.name}`} title="Edit topic" onClick={() => { setEditingTopic(topic.id); setEditedName(topic.name); }}><Pencil size={16} /></button><button className="icon-action" aria-label={`Remove ${topic.name}`} title="Remove topic" onClick={() => removeTopic(topic)}><Trash2 size={18} /></button></>}
        </li>)}</ul>}
        {topics.length === 0 && <p className="quiet-empty">Add a topic to start practicing.</p>}
      </section>

      <section className="simple-section">
        <div className="section-title-row"><h2>Resources</h2><button className="button" type="button" onClick={() => fileRef.current?.click()} disabled={busy}><Plus size={18} />{uploadProgress || "Add"}</button></div>
        <input ref={fileRef} type="file" accept=".pdf,.txt,.md,text/plain,application/pdf" multiple hidden onChange={e => void uploadFiles(e.currentTarget.files)} />
        {resources.length > 0 && <ul className="simple-list resource-list">{resources.map((resource) => <li key={resource.id}><FileText size={18} /><button className="resource-open" type="button" onClick={() => void showResourceText(resource)} disabled={resourceTextLoading} title="View extracted text">{resource.filename}</button><button className="icon-action" aria-label={`Remove ${resource.filename}`} title="Remove resource" onClick={() => removeResource(resource)}><Trash2 size={18} /></button></li>)}</ul>}
      </section>
    </>}

    {suggestions && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setSuggestionQueue((current) => current.slice(1)); }}><div className="modal"><div className="modal-head"><div><h2>Suggested topics</h2><p className="suggestion-source">{suggestions.resource.filename}</p></div><button className="modal-close" aria-label="Close" onClick={() => setSuggestionQueue((current) => current.slice(1))}>×</button></div><ul className="simple-list">{suggestions.topics.map((topic) => <li key={topic}><span>{topic}</span><button className="button" onClick={() => addSuggestedTopic(topic)}><Plus size={18} />Add</button></li>)}</ul><div className="modal-actions"><button className="button" onClick={() => setSuggestionQueue((current) => current.slice(1))}>{suggestionQueue.length > 1 ? "Next resource" : "Done"}</button></div></div></div>}
    {resourceText && <div className="modal-backdrop resource-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setResourceText(null); }}><div className="modal resource-modal" role="dialog" aria-modal="true" aria-label={`Summary and extracted text from ${resourceText.filename}`}>
      <div className="modal-head"><h2>{resourceText.filename}</h2><button className="modal-close" aria-label="Close" onClick={() => setResourceText(null)}><X size={19} /></button></div>
      <div className="content-links"><span>Topics</span>{resourceText.topics.map((topic) => <span className="content-link-chip" key={topic.id}>{topic.name}<button type="button" className="icon-action" title={`Unlink ${topic.name}`} aria-label={`Unlink ${topic.name}`} onClick={() => void unlinkResource(topic.id, resourceText.id)}><Unlink size={14} /></button></span>)}
        {topics.some((topic) => !resourceText.topics.some((linked) => linked.id === topic.id)) && <div className="link-picker"><select aria-label="Topic to link" value={resourceTopicChoice} onChange={(event) => setResourceTopicChoice(event.target.value)}><option value="">Link to topic…</option>{topics.filter((topic) => !resourceText.topics.some((linked) => linked.id === topic.id)).map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select><button type="button" className="button" disabled={!resourceTopicChoice} onClick={() => void attachResource(resourceTopicChoice, resourceText.id)}><Plus size={16} />Link</button></div>}
      </div>
      <div className="resource-tabs" role="tablist" aria-label="Resource content">
        <button type="button" role="tab" aria-selected={resourceTab === "summary"} className={resourceTab === "summary" ? "active" : ""} onFocus={() => setResourceTab("summary")} onKeyDown={(event) => { if (event.key === "ArrowRight") { event.preventDefault(); setResourceTab("extracted"); (event.currentTarget.nextElementSibling as HTMLButtonElement | null)?.focus(); } }} onClick={() => setResourceTab("summary")}>Summary</button>
        <button type="button" role="tab" aria-selected={resourceTab === "extracted"} className={resourceTab === "extracted" ? "active" : ""} onFocus={() => setResourceTab("extracted")} onKeyDown={(event) => { if (event.key === "ArrowLeft") { event.preventDefault(); setResourceTab("summary"); (event.currentTarget.previousElementSibling as HTMLButtonElement | null)?.focus(); } }} onClick={() => setResourceTab("extracted")}>Extracted text <span>{resourceText.extractedText.length.toLocaleString()}</span></button>
      </div>
      {resourceTab === "summary" ? <section className="resource-summary" role="tabpanel" aria-label="Model summary">
        {summaryError && <p className="error-message" role="alert">{summaryError}</p>}
        {summaryLoading || resourceText.summaryStatus === "pending" ? <div className="resource-summary-state"><span className="spinner" /> Summarizing this resource…{!summaryLoading && <button type="button" className="button" onClick={() => void generateResourceSummary(resourceText.id)}>Retry if stalled</button>}</div> : resourceText.summaryStatus === "complete" && resourceText.modelSummary ? <>
          <p className="resource-caption">Model summary{resourceText.summaryProvider ? ` · ${resourceText.summaryProvider}${resourceText.summaryModel ? ` · ${resourceText.summaryModel}` : ""}` : ""}</p>
          <MarkdownMathText className="resource-summary-text" text={resourceText.modelSummary} />
        </> : <div className="resource-summary-empty">
          <p>{resourceText.summaryStatus === "not_generated" ? "A model summary captures the key definitions, results, methods, and examples in this resource." : "The model could not summarize this resource."}</p>
          {resourceText.extractedText ? <button type="button" className="button" onClick={() => void generateResourceSummary(resourceText.id)} disabled={summaryLoading}>{summaryLoading ? "Summarizing…" : resourceText.summaryStatus === "failed" ? "Try again" : "Create summary"}</button> : <p>No selectable text was found in this file. Scanned PDFs need OCR, which is not available yet.</p>}
        </div>}
      </section> : <section role="tabpanel" aria-label="Extracted text"><p className="resource-caption">Text extracted from this file</p>{resourceText.extractedText ? <pre className="resource-extracted">{resourceText.extractedText}</pre> : <p>No selectable text was found in this file. Scanned PDFs need OCR, which is not available yet.</p>}</section>}
    </div></div>}
    {topicDetail && <div className="modal-backdrop resource-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setTopicDetail(null); }}><div className="modal resource-modal topic-modal" role="dialog" aria-modal="true" aria-label={`Topic summary for ${topicDetail.name}`}>
      <div className="modal-head"><h2>{topicDetail.name}</h2><button className="modal-close" aria-label="Close" onClick={() => setTopicDetail(null)}><X size={19} /></button></div>
      <div className="resource-tabs" role="tablist" aria-label="Topic content">
        <button type="button" role="tab" aria-selected={topicTab === "summary"} className={topicTab === "summary" ? "active" : ""} onClick={() => setTopicTab("summary")}>Summary</button>
        <button type="button" role="tab" aria-selected={topicTab === "resources"} className={topicTab === "resources" ? "active" : ""} onClick={() => setTopicTab("resources")}>Resources <span>{topicDetail.resources.length}</span></button>
      </div>
      {topicTab === "summary" ? <section className="topic-summary-panel" role="tabpanel" aria-label="Topic coverage summary">
        {topicSummaryErrors[topicDetail.id] && <p className="error-message" role="alert">{topicSummaryErrors[topicDetail.id]}</p>}
        {summarizingTopicIds.includes(topicDetail.id) || topicDetail.summaryStatus === "pending" ? <div className="resource-summary-state"><span className="spinner" /> Summarizing linked material…</div> : <>
          {topicDetail.coverageSummary ? <><p className="resource-caption">Coverage summary{topicDetail.summaryProvider ? ` · ${topicDetail.summaryProvider}${topicDetail.summaryModel ? ` · ${topicDetail.summaryModel}` : ""}` : ""}</p>{topicDetail.summaryStatus !== "complete" && <p className="topic-stale-note">Linked resources changed. Refresh this summary to reflect them.</p>}{topicEditingSummary ? <textarea className="topic-summary-editor" aria-label="Editable topic summary" value={topicDetail.coverageSummary} onChange={(event) => setTopicDetail({ ...topicDetail, coverageSummary: event.target.value })} /> : <MarkdownMathText className="topic-summary-text" text={topicDetail.coverageSummary} />}<div className="topic-summary-actions">{topicEditingSummary ? <button type="button" className="button" onClick={() => void saveTopicSummary()}>Save edits</button> : <button type="button" className="button" onClick={() => setTopicEditingSummary(true)}>Edit</button>}<button type="button" className="button button-primary" disabled={!topicDetail.resources.length || summarizingTopicIds.includes(topicDetail.id)} onClick={() => void generateTopicSummary(topicDetail.id)}>Refresh from resources</button></div></> : <div className="resource-summary-empty"><p>{topicDetail.resources.length ? "Create an editable summary of the material linked to this topic." : "Link one or more resources to build a topic summary."}</p><button type="button" className="button button-primary" disabled={!topicDetail.resources.length} onClick={() => void generateTopicSummary(topicDetail.id)}>Create summary</button></div>}
        </>}
      </section> : <section className="topic-resources-panel" role="tabpanel" aria-label="Resources linked to topic">
        {topicSummaryErrors[topicDetail.id] && <p className="error-message" role="alert">{topicSummaryErrors[topicDetail.id]}</p>}
        <div className="topic-resource-toolbar"><h3>Selected resources</h3><button type="button" className="button button-primary" disabled={savingTopicIds.includes(topicDetail.id) || summarizingTopicIds.includes(topicDetail.id) || [...selectedTopicResources].sort().join() === topicDetail.resources.map((resource) => resource.id).sort().join()} onClick={() => void saveTopicResources()}>{savingTopicIds.includes(topicDetail.id) ? "Saving…" : summarizingTopicIds.includes(topicDetail.id) ? "Summarizing…" : "Save"}</button></div>
        {selectedResources.length ? <ul className="simple-list topic-resource-list">{selectedResources.map((resource) => <li key={resource.id}><button type="button" className="topic-resource-choice" aria-label={`Remove ${resource.filename} from this topic`} onClick={() => setSelectedTopicResources((current) => current.filter((resourceId) => resourceId !== resource.id))}><FileText size={18} /><span>{resource.filename}</span>{topicDetail.resources.some((saved) => saved.id === resource.id) ? <span className="resource-change-badge">Saved</span> : <span className="resource-change-badge pending">To add</span>}<Check size={18} className="choice-icon" /></button></li>)}</ul> : <p className="topic-resource-empty">No resources selected.</p>}
        <div className="topic-resource-available"><h3>Add resources</h3><input type="search" aria-label="Search available resources" placeholder="Search resources" value={resourceSearch} onChange={(event) => setResourceSearch(event.target.value)} /></div>
        {availableResources.length ? <ul className="simple-list topic-resource-list">{availableResources.map((resource) => <li key={resource.id}><button type="button" className="topic-resource-choice" aria-label={`Add ${resource.filename} to this topic`} onClick={() => setSelectedTopicResources((current) => [...current, resource.id])}><FileText size={18} /><span>{resource.filename}</span>{topicDetail.resources.some((saved) => saved.id === resource.id) && <span className="resource-change-badge pending-remove">To remove</span>}<Plus size={18} className="choice-icon" /></button></li>)}</ul> : <p className="topic-resource-empty">{resources.length === 0 ? "No resources uploaded yet." : resourceSearch ? "No matching resources." : "All resources selected."}</p>}
      </section>}
    </div></div>}
  </main>;
}
