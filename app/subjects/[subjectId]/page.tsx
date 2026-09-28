"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, BookOpen, FileText, Pencil, Plus, Trash2, X, Check, Sparkles, type LucideIcon } from "lucide-react";
import { api, AppShell, getAiRequestHeaders, isPendingRemoval, LoadingCard, notifyAiSetupRequired, scheduleUndoDelete, Subject, useAISettings } from "../../components";
import { MarkdownMathText } from "../../math-text";
import { Badge, Button, ErrorMessage, IconButton, Input, List, ListItem, Modal, Page, Select, Spinner, Tabs, Textarea } from "../../ui";

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
  const [resourceTab, setResourceTab] = useState<"summary" | "topics" | "extracted">("summary");
  const [topicDetail, setTopicDetail] = useState<TopicDetail | null>(null);
  const [topicTab, setTopicTab] = useState<"summary" | "resources">("summary");
  const [summarizingTopicIds, setSummarizingTopicIds] = useState<string[]>([]);
  const [topicSummaryErrors, setTopicSummaryErrors] = useState<Record<string, string>>({});
  const [topicEditingSummary, setTopicEditingSummary] = useState(false);
  const [selectedTopicResources, setSelectedTopicResources] = useState<string[]>([]);
  const [resourceSearch, setResourceSearch] = useState("");
  const [savingTopicIds, setSavingTopicIds] = useState<string[]>([]);
  const [selectedResourceTopics, setSelectedResourceTopics] = useState<string[]>([]);
  const [topicSearch, setTopicSearch] = useState("");
  const [savingResourceIds, setSavingResourceIds] = useState<string[]>([]);
  const [resourceTopicsError, setResourceTopicsError] = useState("");
  const [linkSuggestions, setLinkSuggestions] = useState<Record<string, LinkSuggestions>>({});
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

  // In an open topic or resource: Tab cycles its tabs, and Left/Right open the previous or next item.
  // Up/Down keep scrolling, and keys typed into fields behave normally.
  useEffect(() => {
    if (!resourceText && !topicDetail) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
      if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "Tab") {
        event.preventDefault();
        const step = event.shiftKey ? -1 : 1;
        if (resourceText) setResourceTab((tab) => cycle(resourceTabs, tab, step));
        else setTopicTab((tab) => cycle(topicTabs, tab, step));
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const step = event.key === "ArrowRight" ? 1 : -1;
        if (resourceText) {
          const current = resources.find((item) => item.id === resourceText.id);
          const next = current && cycle(resources, current, step);
          if (next && next !== current && !resourceTextLoading) void showResourceText(next, true);
        } else if (topicDetail) {
          const current = topics.find((item) => item.id === topicDetail.id);
          const next = current && cycle(topics, current, step);
          if (next && next !== current) void showTopic(next, true);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  // Have one practice problem generated and waiting so Practice opens without a delay.
  const hasTopics = topics.length > 0;
  useEffect(() => {
    if (!aiSettings.configured || !hasTopics) return;
    void fetch(`/api/subjects/${id}/problems/ready`, {
      method: "POST", headers: { ...getAiRequestHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(selectedTopic ? { topicId: selectedTopic } : {}),
    }).catch(() => {});
  }, [id, aiSettings.configured, hasTopics, selectedTopic]);

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

  async function showResourceText(resource: Resource, keepTab = false) {
    setTopicDetail(null);
    setResourceTextLoading(true);
    setError("");
    setSummaryError("");
    try {
      const detail = await api<ResourceText>(`/api/resources/${resource.id}`);
      setResourceText(detail);
      setSelectedResourceTopics(detail.topics.map((topic) => topic.id));
      setTopicSearch("");
      setResourceTopicsError("");
      if (!keepTab) setResourceTab("summary");
      if (detail.summaryStatus === "not_generated" || detail.summaryStatus === "failed") void generateResourceSummary(resource.id);
    }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load extracted text"); }
    finally { setResourceTextLoading(false); }
  }

  async function showTopic(topic: Topic, keepTab = false) {
    setResourceText(null);
    setTopicSummaryError(topic.id, "");
    setSelectedTopicResources([]);
    setResourceSearch("");
    setTopicEditingSummary(false);
    try {
      const detail = await api<TopicDetail>(`/api/topics/${topic.id}`);
      setTopicDetail(detail);
      setSelectedTopicResources(detail.resources.map((resource) => resource.id));
      if (!keepTab) setTopicTab("summary");
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
    if (!aiSettings.configured) { notifyAiSetupRequired(); setTopicSummaryError(topicId, "Sign in to Codex or Claude to create a topic summary."); return; }
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
          if (/Codex or Claude|(Codex|Claude) is (unavailable|not signed in)/i.test(message)) notifyAiSetupRequired();
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

  async function saveResourceTopics() {
    if (!resourceText || savingResourceIds.includes(resourceText.id)) return;
    const resourceId = resourceText.id;
    const topicIds = [...selectedResourceTopics];
    setSavingResourceIds((current) => [...current, resourceId]);
    setResourceTopicsError("");
    try {
      const result = await api<{ refreshTopicIds: string[] }>(`/api/resources/${resourceId}/topics`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topicIds }),
      });
      const linked = topics.filter((topic) => topicIds.includes(topic.id)).map(({ id, name }) => ({ id, name }));
      setResourceText((current) => current?.id === resourceId ? { ...current, topics: linked } : current);
      setResources((current) => current.map((resource) => resource.id === resourceId ? { ...resource, topicIds } : resource));
      for (const topicId of result.refreshTopicIds) void generateTopicSummary(topicId);
    } catch (e) { setResourceTopicsError(e instanceof Error ? e.message : "Could not save linked topics"); }
    finally { setSavingResourceIds((current) => current.filter((savingId) => savingId !== resourceId)); }
  }

  // Asks the model for unlinked items that cover the same material, ranked by their short briefs.
  function loadLinkSuggestions(key: string, url: string) {
    if (!aiSettings.configured) { notifyAiSetupRequired(); return; }
    if (linkSuggestions[key] === "loading") return;
    setLinkSuggestions((current) => ({ ...current, [key]: "loading" }));
    void api<{ ids: string[] }>(url, { method: "POST", headers: getAiRequestHeaders() })
      .then((result) => setLinkSuggestions((current) => ({ ...current, [key]: result.ids })))
      .catch(() => setLinkSuggestions((current) => ({ ...current, [key]: "failed" })));
  }

  async function generateResourceSummary(resourceId: string) {
    if (!aiSettings.ready) return;
    if (!aiSettings.configured) {
      notifyAiSetupRequired();
      setSummaryError("Sign in to Codex or Claude to create a resource summary.");
      return;
    }
    if (resourceSummariesInProgress.has(resourceId)) return;
    resourceSummariesInProgress.add(resourceId);
    setSummaryLoading(true);
    setSummaryError("");
    try {
      const detail = await api<Omit<ResourceText, "topics">>(`/api/resources/${resourceId}`, { method: "POST", headers: getAiRequestHeaders() });
      setResourceText((current) => current?.id === resourceId ? { ...current, ...detail } : current);
      setResources((current) => current.map((item) => item.id === resourceId ? { ...item, summaryStatus: "complete" } : item));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not create a resource summary";
      setSummaryError(message);
      const setupRequired = /Codex or Claude|(Codex|Claude) is (unavailable|not signed in)/i.test(message);
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

  const pending = (text: string, action?: React.ReactNode) => <div className="flex flex-wrap items-center gap-3 py-6 text-muted"><Spinner />{text}{action}</div>;
  const noText = <p className="text-muted">No selectable text was found in this file. Scanned PDFs need OCR, which is not available yet.</p>;
  const rowTitle = "flex min-w-0 flex-1 items-center gap-3 self-stretch text-left hover:text-accent disabled:cursor-wait";
  const closeSuggestions = () => setSuggestionQueue((current) => current.slice(1));

  return <Page>
    <Link href="/" className="mb-6 inline-flex items-center gap-2 text-sm text-muted hover:text-ink"><ArrowLeft size={18} />Subjects</Link>
    {loading ? <LoadingCard /> : !subject ? <p>{error || "Subject not found."}</p> : <>
      <div className="mb-10 flex flex-wrap items-center justify-between gap-4"><h1 className="min-w-0 text-display font-semibold break-words">{subject.name}</h1>
        <div className="flex items-center gap-2 max-sm:w-full">
          <Select className="max-w-56 max-sm:max-w-none max-sm:flex-1" aria-label="Topic to practice" value={selectedTopic} onChange={(event) => setSelectedTopic(event.target.value)} disabled={!topics.length}>
            <option value="">Any topic</option>{topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}
          </Select>
          <Button variant="primary" disabled={!topics.length || !aiSettings.ready} onClick={() => { if (!aiSettings.configured) { notifyAiSetupRequired(); return; } router.push(`/study/${id}${selectedTopic ? `?topic=${encodeURIComponent(selectedTopic)}` : ""}`); }}>Practice</Button>
        </div>
      </div>
      {error && <ErrorMessage>{error}</ErrorMessage>}

      <section className="mb-12">
        <div className={sectionHead}><h2 className="text-xl font-semibold">Topics</h2><form className="flex items-center gap-2" onSubmit={addTopic}><Input className="w-56 max-sm:w-40" aria-label="Topic name" value={topicName} maxLength={160} onChange={e => setTopicName(e.target.value)} placeholder="Add a topic" /><IconButton type="submit" label="Add topic" className="border border-line bg-surface" disabled={!topicName.trim() || busy}><Plus size={18} /></IconButton></form></div>
        {topics.length > 0 && <List>{topics.map((topic) => <ListItem key={topic.id}>
          {editingTopic === topic.id ? <form className="flex flex-1 items-center gap-2" onSubmit={(event) => { event.preventDefault(); void saveTopic(topic); }}><Input className="flex-1" aria-label="Topic name" autoFocus maxLength={160} value={editedName} onChange={(event) => setEditedName(event.target.value)} /><IconButton type="submit" label="Save topic name"><Check size={18} /></IconButton><IconButton label="Cancel editing" onClick={() => setEditingTopic(null)}><X size={18} /></IconButton></form> : <><button type="button" className={rowTitle} onClick={() => void showTopic(topic)} title="View topic summary and linked resources"><BookOpen size={18} className="flex-none text-muted" /><span className="truncate">{topic.name}</span></button><IconButton label={`Edit ${topic.name}`} onClick={() => { setEditingTopic(topic.id); setEditedName(topic.name); }}><Pencil size={18} /></IconButton><IconButton label={`Remove ${topic.name}`} tone="danger" onClick={() => removeTopic(topic)}><Trash2 size={18} /></IconButton></>}
        </ListItem>)}</List>}
        {topics.length === 0 && <p className="text-muted">Add a topic to start practicing.</p>}
      </section>

      <section>
        <div className={sectionHead}><h2 className="text-xl font-semibold">Resources</h2><Button onClick={() => fileRef.current?.click()} disabled={busy}><Plus size={18} />{uploadProgress || "Add"}</Button></div>
        <input ref={fileRef} type="file" accept=".pdf,.txt,.md,text/plain,application/pdf" multiple hidden onChange={e => void uploadFiles(e.currentTarget.files)} />
        {resources.length > 0 && <List>{resources.map((resource) => <ListItem key={resource.id}><button type="button" className={rowTitle} onClick={() => void showResourceText(resource)} disabled={resourceTextLoading} title="View extracted text"><FileText size={18} className="flex-none text-muted" /><span className="truncate">{resource.filename}</span></button><IconButton label={`Remove ${resource.filename}`} tone="danger" onClick={() => removeResource(resource)}><Trash2 size={18} /></IconButton></ListItem>)}</List>}
      </section>
    </>}

    {suggestions && <Modal title="Suggested topics" subtitle={suggestions.resource.filename} onClose={closeSuggestions}>
      <List>{suggestions.topics.map((topic) => <ListItem key={topic}><span className="min-w-0 flex-1">{topic}</span><Button size="sm" onClick={() => addSuggestedTopic(topic)}><Plus size={16} />Add</Button></ListItem>)}</List>
      <div className="mt-6 flex justify-end"><Button onClick={closeSuggestions}>{suggestionQueue.length > 1 ? "Next resource" : "Done"}</Button></div>
    </Modal>}

    {resourceText && <Modal wide title={resourceText.filename} label={`Summary and extracted text from ${resourceText.filename}`} onClose={() => setResourceText(null)}>
      <Tabs label="Resource content" value={resourceTab} onChange={setResourceTab} tabs={[{ id: "summary", label: "Summary" }, { id: "topics", label: "Topics", count: resourceText.topics.length }, { id: "extracted", label: "Extracted text", count: resourceText.extractedText.length }]} />
      {resourceTab === "summary" ? <section role="tabpanel" aria-label="Model summary">
        {summaryError && <ErrorMessage>{summaryError}</ErrorMessage>}
        {summaryLoading || resourceText.summaryStatus === "pending" ? pending("Summarizing this resource…", !summaryLoading && <Button size="sm" onClick={() => void generateResourceSummary(resourceText.id)}>Retry if stalled</Button>) : resourceText.summaryStatus === "complete" && resourceText.modelSummary ? <>
          <MarkdownMathText text={resourceText.modelSummary} />
        </> : <div className="flex flex-col items-start gap-4 py-4">
          <p className="text-muted">{resourceText.summaryStatus === "not_generated" ? "A model summary captures the key definitions, results, methods, and examples in this resource." : "The model could not summarize this resource."}</p>
          {resourceText.extractedText ? <Button variant="primary" onClick={() => void generateResourceSummary(resourceText.id)} disabled={summaryLoading}>{summaryLoading ? "Summarizing…" : resourceText.summaryStatus === "failed" ? "Try again" : "Create summary"}</Button> : noText}
        </div>}
      </section> : resourceTab === "topics" ? <section role="tabpanel" aria-label="Topics linked to resource">
        {resourceTopicsError && <ErrorMessage>{resourceTopicsError}</ErrorMessage>}
        <LinkPicker noun="topic" target="resource" icon={BookOpen} items={topics} saved={resourceText.topics.map((topic) => topic.id)}
          selected={selectedResourceTopics} onSelectedChange={setSelectedResourceTopics} search={topicSearch} onSearchChange={setTopicSearch}
          suggestions={linkSuggestions[`resource:${resourceText.id}`]} onSuggest={() => loadLinkSuggestions(`resource:${resourceText.id}`, `/api/resources/${resourceText.id}/suggested-topics`)}
          saving={savingResourceIds.includes(resourceText.id)} onSave={() => void saveResourceTopics()} />
      </section> : <section role="tabpanel" aria-label="Extracted text">{resourceText.extractedText ? <pre className="rounded-md bg-subtle p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">{resourceText.extractedText}</pre> : noText}</section>}
    </Modal>}

    {topicDetail && <Modal wide title={topicDetail.name} label={`Topic summary for ${topicDetail.name}`} onClose={() => setTopicDetail(null)}>
      <Tabs label="Topic content" value={topicTab} onChange={setTopicTab} tabs={[{ id: "summary", label: "Summary" }, { id: "resources", label: "Resources", count: topicDetail.resources.length }]} />
      {topicSummaryErrors[topicDetail.id] && <ErrorMessage>{topicSummaryErrors[topicDetail.id]}</ErrorMessage>}
      {topicTab === "summary" ? <section role="tabpanel" aria-label="Topic coverage summary">
        {summarizingTopicIds.includes(topicDetail.id) || topicDetail.summaryStatus === "pending" ? pending("Summarizing linked material…") : topicDetail.coverageSummary ? <>
          {topicDetail.summaryStatus !== "complete" && <p className="mb-4 rounded-md border border-warning-line bg-warning-soft px-4 py-3 text-sm">Linked resources changed. Refresh this summary to reflect them.</p>}
          {topicEditingSummary ? <Textarea className="min-h-96 font-mono text-sm" aria-label="Editable topic summary" value={topicDetail.coverageSummary} onChange={(event) => setTopicDetail({ ...topicDetail, coverageSummary: event.target.value })} /> : <MarkdownMathText text={topicDetail.coverageSummary} />}
          <div className="mt-6 flex flex-wrap justify-end gap-2">{topicEditingSummary ? <Button onClick={() => void saveTopicSummary()}>Save edits</Button> : <Button onClick={() => setTopicEditingSummary(true)}>Edit</Button>}<Button variant="primary" disabled={!topicDetail.resources.length} onClick={() => void generateTopicSummary(topicDetail.id)}>Refresh from resources</Button></div>
        </> : <div className="flex flex-col items-start gap-4 py-4"><p className="text-muted">{topicDetail.resources.length ? "Create an editable summary of the material linked to this topic." : "Link one or more resources to build a topic summary."}</p><Button variant="primary" disabled={!topicDetail.resources.length} onClick={() => void generateTopicSummary(topicDetail.id)}>Create summary</Button></div>}
      </section> : <section role="tabpanel" aria-label="Resources linked to topic">
        <LinkPicker noun="resource" target="topic" icon={FileText} items={resources.map((resource) => ({ id: resource.id, name: resource.filename }))} saved={topicDetail.resources.map((resource) => resource.id)}
          selected={selectedTopicResources} onSelectedChange={setSelectedTopicResources} search={resourceSearch} onSearchChange={setResourceSearch}
          suggestions={linkSuggestions[`topic:${topicDetail.id}`]} onSuggest={() => loadLinkSuggestions(`topic:${topicDetail.id}`, `/api/topics/${topicDetail.id}/suggested-resources`)}
          saving={savingTopicIds.includes(topicDetail.id) || summarizingTopicIds.includes(topicDetail.id)}
          savingLabel={savingTopicIds.includes(topicDetail.id) ? "Saving…" : "Summarizing…"} onSave={() => void saveTopicResources()} />
      </section>}
    </Modal>}
  </Page>;
}

const resourceTabs = ["summary", "topics", "extracted"] as const;
const topicTabs = ["summary", "resources"] as const;

// Returns the item `step` places from `current`, wrapping around; `current` itself if it is not in the list.
function cycle<T>(items: readonly T[], current: T, step: number) {
  const index = items.indexOf(current);
  return index < 0 ? current : items[(index + step + items.length) % items.length];
}

const sectionHead = "mb-3 flex min-h-control items-center justify-between gap-4";
const choiceRow = "flex h-full min-h-12 w-full items-center gap-3 text-left text-sm hover:text-accent";

type LinkSuggestions = string[] | "loading" | "failed";

type LinkPickerProps = {
  noun: string;
  target: string;
  icon: LucideIcon;
  items: { id: string; name: string }[];
  saved: string[];
  selected: string[];
  onSelectedChange: (ids: string[]) => void;
  search: string;
  onSearchChange: (search: string) => void;
  suggestions?: LinkSuggestions;
  onSuggest: () => void;
  saving: boolean;
  savingLabel?: string;
  onSave: () => void;
};

// Stages link changes between a topic and resources (or the reverse) until Save.
function LinkPicker({ noun, target, icon: Icon, items, saved, selected, onSelectedChange, search, onSearchChange, suggestions, onSuggest, saving, savingLabel = "Saving…", onSave }: LinkPickerProps) {
  const query = search.trim().toLocaleLowerCase();
  const chosen = items.filter((item) => selected.includes(item.id));
  const suggested = Array.isArray(suggestions) ? suggestions : [];
  const rank = (id: string) => { const index = suggested.indexOf(id); return index < 0 ? suggested.length : index; };
  const available = items.filter((item) => !selected.includes(item.id) && item.name.toLocaleLowerCase().includes(query))
    .sort((a, b) => rank(a.id) - rank(b.id));
  const unchanged = [...selected].sort().join() === [...saved].sort().join();
  return <>
    <div className={sectionHead}><h3 className="text-lg font-semibold">Selected {noun}s</h3><Button variant="primary" disabled={saving || unchanged} onClick={onSave}>{saving ? savingLabel : "Save"}</Button></div>
    {chosen.length ? <List className="mb-8">{chosen.map((item) => <ListItem key={item.id} className="py-0"><button type="button" className={choiceRow} aria-label={`Remove ${item.name} from this ${target}`} onClick={() => onSelectedChange(selected.filter((id) => id !== item.id))}><Icon size={18} className="flex-none text-muted" /><span className="min-w-0 flex-1 truncate">{item.name}</span>{saved.includes(item.id) ? <Badge tone="neutral">Saved</Badge> : <Badge>To add</Badge>}<Check size={18} className="flex-none text-accent" /></button></ListItem>)}</List> : <p className="mb-8 text-sm text-muted">No {noun}s selected.</p>}
    <div className={`${sectionHead} flex-wrap`}><h3 className="text-lg font-semibold">Add {noun}s</h3><div className="flex flex-wrap items-center justify-end gap-2">
      {Array.isArray(suggestions) && !suggestions.some((id) => !selected.includes(id)) && <span className="text-sm text-muted max-sm:hidden">No clear matches</span>}
      {suggestions === "failed" && <span className="text-sm text-danger max-sm:hidden">Suggestions failed</span>}
      <Button disabled={suggestions === "loading" || items.length === selected.length} onClick={onSuggest} title={`Ask the model which ${noun}s cover the same material`}>{suggestions === "loading" ? <Spinner /> : <Sparkles size={16} />}{suggestions === "loading" ? "Suggesting…" : "Suggest"}</Button>
      <Input className="w-64 max-sm:w-40" type="search" aria-label={`Search available ${noun}s`} placeholder={`Search ${noun}s`} value={search} onChange={(event) => onSearchChange(event.target.value)} /></div></div>
    {available.length ? <List>{available.map((item) => <ListItem key={item.id} className="py-0"><button type="button" className={choiceRow} aria-label={`Add ${item.name} to this ${target}`} onClick={() => onSelectedChange([...selected, item.id])}><Icon size={18} className="flex-none text-muted" /><span className="min-w-0 flex-1 truncate">{item.name}</span>{suggested.includes(item.id) && <Badge><Sparkles size={12} />Suggested</Badge>}{saved.includes(item.id) && <Badge tone="danger">To remove</Badge>}<Plus size={18} className="flex-none text-muted" /></button></ListItem>)}</List> : <p className="text-sm text-muted">{items.length === 0 ? `No ${noun}s yet.` : search ? `No matching ${noun}s.` : `All ${noun}s selected.`}</p>}
  </>;
}
