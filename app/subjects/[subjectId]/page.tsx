"use client";

import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, BookOpen, Check, FileText, FolderPlus, MessageSquare, Plus, Sparkles, Trash2, type LucideIcon } from "lucide-react";
import { buildTree, descendantGroupIds, flattenTree, groupPath, positionAt, siblingPositions, treeFromPaths, type Placement } from "@/lib/topic-tree";
import { api, AppShell, getAiRequestHeaders, isPendingRemoval, LoadingCard, notifyAiSetupRequired, scheduleUndoDelete, Subject, useAISettings } from "../../components";
import { MarkdownMathText } from "../../math-text";
import { SavedChat } from "../../chat";
import { Badge, Button, cn, ErrorMessage, IconButton, Input, List, ListItem, Modal, Page, Spinner, Tabs, Textarea } from "../../ui";
import { TopicTree, type Group, type Topic, type TreeActions } from "./topic-tree";

type Resource = { id: string; filename: string; contentType?: string; extractionStatus?: string; summaryStatus?: string; topicIds?: string[]; suggestedTopics?: Placement[] };
type LinkedTopic = { id: string; name: string };
type LinkedResource = { id: string; filename: string };
type GroupDetail = Group & { summary: string; summaryStatus: "not_generated" | "stale" | "complete"; summaryProvider?: string | null; summaryModel?: string | null; topicCount: number; resources: LinkedResource[] };
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
  const [groups, setGroups] = useState<Group[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  // A just-created topic or folder already sits where it was made, so its edit row only renames it.
  const [renameOnly, setRenameOnly] = useState(false);
  const startEditing = (itemId: string | null, onlyRename = false) => { setEditingId(itemId); setRenameOnly(onlyRename); };
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [organizing, setOrganizing] = useState<{ topics: (Topic & { path: string[] })[] } | "loading" | null>(null);
  const [previewCollapsed, setPreviewCollapsed] = useState<Set<string>>(new Set());
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [topicName, setTopicName] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [suggestionQueue, setSuggestionQueue] = useState<{ resource: Resource; topics: Placement[] }[]>([]);
  const suggestions = suggestionQueue[0] ?? null;
  const [resourceText, setResourceText] = useState<ResourceText | null>(null);
  const [resourceTextLoading, setResourceTextLoading] = useState(false);
  const [resourceTab, setResourceTab] = useState<"summary" | "topics" | "extracted">("summary");
  const [topicDetail, setTopicDetail] = useState<TopicDetail | null>(null);
  const [topicTab, setTopicTab] = useState<"summary" | "resources">("summary");
  const [groupDetail, setGroupDetail] = useState<GroupDetail | null>(null);
  const [groupTab, setGroupTab] = useState<"summary" | "resources">("summary");
  const [summarizingGroupIds, setSummarizingGroupIds] = useState<string[]>([]);
  const [groupErrors, setGroupErrors] = useState<Record<string, string>>({});
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
  const activeGroupIdRef = useRef<string | null>(null);
  useEffect(() => { activeGroupIdRef.current = groupDetail?.id ?? null; }, [groupDetail?.id]);

  // Collapsed folders are a per-browser convenience, so they live in localStorage.
  const collapsedKey = `tao-collapsed-folders-${id}`;
  useEffect(() => {
    try { setCollapsed(new Set(JSON.parse(localStorage.getItem(collapsedKey) ?? "[]"))); } catch { /* Start expanded. */ }
  }, [collapsedKey]);
  function toggleFolder(groupId: string, open?: boolean) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (open ?? next.has(groupId)) next.delete(groupId); else next.add(groupId);
      try { localStorage.setItem(collapsedKey, JSON.stringify([...next])); } catch { /* Keep it for this visit only. */ }
      return next;
    });
  }
  // Whether viewers show the chat beside the summary, and whether the subject chat is open; per-browser preferences.
  const [chatOpen, toggleChat] = useStoredToggle("tao-viewer-chat", true);
  const [subjectChatOpen, toggleSubjectChat] = useStoredToggle("tao-subject-chat", false);
  const chatToggle = <ChatToggle open={chatOpen} onToggle={toggleChat} />;
  function flash(itemId: string) {
    setHighlightId(itemId);
    setTimeout(() => setHighlightId((current) => current === itemId ? null : current), 1_200);
  }
  function setTopicSummaryError(topicId: string, message: string) {
    setTopicSummaryErrors((current) => ({ ...current, [topicId]: message }));
  }

  const refresh = useCallback(async () => {
    try {
      const detail = await api<{ subject: Subject; topics: Topic[]; groups: Group[]; resources: Resource[] }>(`/api/subjects/${id}`);
      setSubject(detail.subject);
      setTopics((detail.topics ?? []).filter((topic) => !isPendingRemoval(topic.id)));
      setGroups((detail.groups ?? []).filter((group) => !isPendingRemoval(group.id)));
      setResources((detail.resources ?? []).filter((resource) => !isPendingRemoval(resource.id)));
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

  // The tree drops topics and folders inside a removed folder, so everything below derives from it.
  const tree = flattenTree(buildTree(groups, topics));
  const visibleTopics = tree.flatMap((node) => node.kind === "topic" ? [node.topic] : []);
  const visibleGroups = tree.flatMap((node) => node.kind === "group" ? [node.group] : []);
  // Have one any-topic practice problem generated and waiting so Practice opens without a delay.
  // Topic and folder practice (from the tree's menu) prepare their next problem once started.
  // Changing the diagram setting discards the waiting problem, so one is prepared again.
  const hasTopics = topics.length > 0;
  const diagrams = Boolean(subject?.diagrams);
  useEffect(() => {
    if (!aiSettings.configured || !hasTopics) return;
    void fetch(`/api/subjects/${id}/problems/ready`, {
      method: "POST", headers: { ...getAiRequestHeaders(), "Content-Type": "application/json" }, body: "{}",
    }).catch(() => {});
  }, [id, aiSettings.configured, hasTopics, diagrams]);

  // Whether the AI may draw figures when it writes this subject's problems and cards. Shown figures are unaffected.
  async function setDiagrams(on: boolean) {
    try {
      await api(`/api/subjects/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ diagrams: on }) });
      setSubject((current) => current && { ...current, diagrams: on });
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save the diagram setting"); }
  }

  // Flashcards work without AI; problems need a signed-in provider. Without a mode, the study page opens the last one used.
  function startPractice(target: { topicId?: string; groupId?: string } = {}, mode?: "problems" | "cards") {
    if (mode !== "cards" && !aiSettings.ready) return;
    if (mode === "problems" && !aiSettings.configured) { notifyAiSetupRequired(); return; }
    const search = new URLSearchParams([...(mode ? [["mode", mode]] : []), ...(target.topicId ? [["topic", target.topicId]] : []), ...(target.groupId ? [["group", target.groupId]] : [])]);
    router.push(`/study/${id}${search.size ? `?${search}` : ""}`);
  }

  async function addTopic(event: React.FormEvent) {
    event.preventDefault();
    const name = topicName.trim();
    if (!name) return;
    setBusy(true);
    setError("");
    try {
      const topic = await api<Topic>(`/api/subjects/${id}/topics`, { method: "POST", headers: json, body: JSON.stringify({ name }) });
      setTopicName("");
      await refresh();
      revealAndFlash(topic.id, topic.groupId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add topic");
    } finally {
      setBusy(false);
    }
  }

  const json = { "Content-Type": "application/json" };
  const failed = (fallback: string) => (e: unknown) => setError(e instanceof Error ? e.message : fallback);

  // Moves and renames apply at once and are then confirmed by a refresh.
  // Without a position, an item moved to another folder goes last in it.
  async function saveTopic(topic: Topic, name: string, groupId: string | null, position = endPosition(topic, groupId)) {
    setEditingId(null);
    if (name === topic.name && groupId === topic.groupId && position === topic.position) return;
    setTopics((current) => current.map((item) => item.id === topic.id ? { ...item, name, groupId, position } : item));
    revealAndFlash(topic.id, groupId);
    await api(`/api/topics/${topic.id}`, { method: "PATCH", headers: json, body: JSON.stringify({ name, groupId, position }) }).catch(failed("Could not save topic"));
    await refresh();
  }

  async function saveGroup(group: Group, name: string, parentId: string | null, position = endPosition(group, parentId)) {
    setEditingId(null);
    if (name === group.name && parentId === group.parentId && position === group.position) return;
    setGroups((current) => current.map((item) => item.id === group.id ? { ...item, name, parentId, position } : item));
    revealAndFlash(group.id, parentId);
    await api(`/api/groups/${group.id}`, { method: "PATCH", headers: json, body: JSON.stringify({ name, parentId, position }) }).catch(failed("Could not save folder"));
    await refresh();
  }

  function endPosition(item: Group | Topic, parentId: string | null) {
    if (parentId === ("parentId" in item ? item.parentId : item.groupId)) return item.position;
    const siblings = siblingPositions(groups, topics, parentId, item.id);
    return positionAt(siblings.map((sibling) => sibling.position), siblings.length);
  }

  function revealAndFlash(itemId: string, parentId: string | null) {
    if (parentId) for (const group of groups) if (descendantGroupIds(groups, group.id).has(parentId)) toggleFolder(group.id, true);
    flash(itemId);
  }

  function moveItem(item: { kind: "group" | "topic"; id: string }, parentId: string | null, position: number) {
    const group = item.kind === "group" ? groups.find((candidate) => candidate.id === item.id) : undefined;
    const topic = item.kind === "topic" ? topics.find((candidate) => candidate.id === item.id) : undefined;
    if (group) void saveGroup(group, group.name, parentId, position);
    if (topic) void saveTopic(topic, topic.name, parentId, position);
  }

  // Creates a placeholder topic in a folder and opens it for renaming.
  async function addTopicIn(groupId: string) {
    const taken = new Set(topics.map((topic) => topic.name.toLocaleLowerCase()));
    let name = "New topic";
    for (let count = 2; taken.has(name.toLocaleLowerCase()); count++) name = `New topic ${count}`;
    try {
      const topic = await api<Topic>(`/api/subjects/${id}/topics`, { method: "POST", headers: json, body: JSON.stringify({ name, groupId }) });
      await refresh();
      startEditing(topic.id, true);
      toggleFolder(groupId, true);
      revealAndFlash(topic.id, groupId);
    } catch (e) { failed("Could not add topic")(e); }
  }

  async function addFolder(parentId: string | null = null) {
    const taken = new Set(groups.filter((group) => group.parentId === parentId).map((group) => group.name.toLocaleLowerCase()));
    let name = "New folder";
    for (let count = 2; taken.has(name.toLocaleLowerCase()); count++) name = `New folder ${count}`;
    try {
      const group = await api<Group>(`/api/subjects/${id}/groups`, { method: "POST", headers: json, body: JSON.stringify({ name, parentId }) });
      setGroups((current) => [...current, group]);
      startEditing(group.id, true);
      if (parentId) toggleFolder(parentId, true);
      revealAndFlash(group.id, parentId);
    } catch (e) { failed("Could not add folder")(e); }
  }

  function removeTopic(topic: Topic) {
    setTopics((current) => current.filter((item) => item.id !== topic.id));
    scheduleUndoDelete(topic.id, {
      message: `Removed ${topic.name}`,
      commit: async () => { await api(`/api/topics/${topic.id}`, { method: "DELETE" }); },
      restore: () => setTopics((current) => current.some((item) => item.id === topic.id) ? current : [...current, topic]),
    });
  }

  // Hiding the folder hides everything inside it; the server deletes its contents when the undo window ends.
  function removeGroup(group: Group) {
    const count = tree.find((node) => node.kind === "group" && node.group.id === group.id);
    const topicCount = count?.kind === "group" ? count.topicCount : 0;
    setGroups((current) => current.filter((item) => item.id !== group.id));
    scheduleUndoDelete(group.id, {
      message: `Removed ${group.name}${topicCount ? ` and ${topicCount} topic${topicCount === 1 ? "" : "s"}` : ""}`,
      commit: async () => { await api(`/api/groups/${group.id}`, { method: "DELETE" }); },
      restore: () => setGroups((current) => current.some((item) => item.id === group.id) ? current : [...current, group]),
    });
  }

  async function showGroup(group: Group, keepTab = false) {
    setResourceText(null);
    setTopicDetail(null);
    try {
      const detail = await api<GroupDetail>(`/api/groups/${group.id}`);
      setGroupDetail(detail);
      if (!keepTab) setGroupTab("summary");
      if (detail.summaryStatus !== "complete" && detail.topicCount && aiSettings.configured) void generateGroupSummary(detail.id);
    } catch (e) { failed("Could not load folder")(e); }
  }

  async function generateGroupSummary(groupId: string) {
    if (!aiSettings.configured) { notifyAiSetupRequired(); return; }
    if (summarizingGroupIds.includes(groupId)) return;
    setSummarizingGroupIds((current) => [...current, groupId]);
    setGroupErrors((current) => ({ ...current, [groupId]: "" }));
    try {
      const summary = await api<Pick<GroupDetail, "id" | "summary" | "summaryStatus" | "summaryProvider" | "summaryModel">>(`/api/groups/${groupId}/summary`, { method: "POST", headers: getAiRequestHeaders() });
      setGroupDetail((current) => current?.id === groupId ? { ...current, ...summary } : current);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not summarize this folder";
      setGroupErrors((current) => ({ ...current, [groupId]: message }));
      if (/Codex or Claude/i.test(message)) notifyAiSetupRequired();
    } finally { setSummarizingGroupIds((current) => current.filter((item) => item !== groupId)); }
  }

  async function proposeOrganization() {
    if (!aiSettings.configured) { notifyAiSetupRequired(); return; }
    setOrganizing("loading");
    setPreviewCollapsed(new Set());
    try {
      const proposal = await api<{ topics: (Topic & { path: string[] })[] }>(`/api/subjects/${id}/tree`, { method: "POST", headers: getAiRequestHeaders() });
      setOrganizing(proposal);
    } catch (e) { setOrganizing(null); failed("Could not organize topics")(e); }
  }

  async function applyOrganization() {
    if (!organizing || organizing === "loading") return;
    const placements = organizing.topics.map(({ id: topicId, path }) => ({ id: topicId, path }));
    setOrganizing(null);
    try {
      await api(`/api/subjects/${id}/tree`, { method: "PUT", headers: json, body: JSON.stringify({ topics: placements }) });
      setCollapsed(new Set());
      try { localStorage.removeItem(collapsedKey); } catch { /* Nothing stored. */ }
    } catch (e) { failed("Could not apply the new folders")(e); }
    await refresh();
  }

  const treeActions: TreeActions = {
    openTopic: (topic) => void showTopic(topic), openGroup: (group) => void showGroup(group),
    saveTopic: (topic, name, groupId) => void saveTopic(topic, name, groupId), saveGroup: (group, name, parentId) => void saveGroup(group, name, parentId),
    removeTopic, removeGroup, practice: startPractice, addFolder: (parentId) => void addFolder(parentId), addTopic: (groupId) => void addTopicIn(groupId), move: moveItem, editingId, renameOnly, setEditingId: startEditing,
  };

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
    setGroupDetail(null);
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
    setGroupDetail(null);
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

  // Creates the suggested topic in its proposed folder (making folders as needed), or links the existing topic where it is.
  async function addSuggestedTopic({ name, path }: Placement) {
    const sourceResource = suggestions?.resource;
    if (!sourceResource) return;
    try {
      const topic = await api<Topic>(`/api/subjects/${id}/topics`, { method: "POST", headers: json, body: JSON.stringify({ name, path }) });
      await api(`/api/topics/${topic.id}/resources`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resourceId: sourceResource.id }) });
      setResources((current) => current.map((resource) => resource.id === sourceResource.id ? { ...resource, topicIds: [...new Set([...(resource.topicIds ?? []), topic.id])] } : resource));
      setSuggestionQueue((current) => {
        if (!current.length || current[0].resource.id !== sourceResource.id) return current;
        const remaining = current[0].topics.filter((topic) => topic.name !== name);
        return remaining.length ? [{ ...current[0], topics: remaining }, ...current.slice(1)] : current.slice(1);
      });
      await refresh();
      revealAndFlash(topic.id, topic.groupId);
      void generateTopicSummary(topic.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add topic");
    }
  }

  // In an open topic, folder, or resource: Tab cycles its tabs, and Left/Right open the previous or next item.
  // Up/Down keep scrolling, and keys typed into fields behave normally.
  useEffect(() => {
    if (!resourceText && !topicDetail && !groupDetail) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
      if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "Tab") {
        event.preventDefault();
        const step = event.shiftKey ? -1 : 1;
        if (resourceText) setResourceTab((tab) => cycle(resourceTabs, tab, step));
        else if (groupDetail) setGroupTab((tab) => cycle(topicTabs, tab, step));
        else setTopicTab((tab) => cycle(topicTabs, tab, step));
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const step = event.key === "ArrowRight" ? 1 : -1;
        if (resourceText) {
          const current = resources.find((item) => item.id === resourceText.id);
          const next = current && cycle(resources, current, step);
          if (next && next !== current && !resourceTextLoading) void showResourceText(next, true);
        } else if (topicDetail) {
          const current = visibleTopics.find((item) => item.id === topicDetail.id);
          const next = current && cycle(visibleTopics, current, step);
          if (next && next !== current) void showTopic(next, true);
        } else if (groupDetail) {
          const current = visibleGroups.find((item) => item.id === groupDetail.id);
          const next = current && cycle(visibleGroups, current, step);
          if (next && next !== current) void showGroup(next, true);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const pending = (text: string, action?: React.ReactNode) => <div className="flex flex-wrap items-center gap-3 py-6 text-muted"><Spinner />{text}{action}</div>;
  const noText = <p className="text-muted">No selectable text was found in this file. Scanned PDFs need OCR, which is not available yet.</p>;
  const closeSuggestions = () => setSuggestionQueue((current) => current.slice(1));

  const subjectChat = subjectChatOpen && !loading && !!subject;
  return <Page className={subjectChat ? "max-w-7xl" : undefined}>
    <Link href="/" className="mb-6 inline-flex items-center gap-2 text-sm text-muted hover:text-ink"><ArrowLeft size={18} />Subjects</Link>
    {loading ? <LoadingCard /> : !subject ? <p>{error || "Subject not found."}</p> : <div className={cn(subjectChat && "grid gap-x-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:grid-rows-[auto_1fr]")}>
      <div>
        <div className="mb-10 flex flex-wrap items-center justify-between gap-4"><h1 className="min-w-0 text-display font-semibold break-words">{subject.name}</h1>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex h-control cursor-pointer items-center gap-2 text-sm" title="Ask the AI to draw a figure when one helps. It applies to problems and cards written from now on.">
              <input type="checkbox" className="size-4 accent-accent" checked={diagrams} onChange={(event) => void setDiagrams(event.target.checked)} />
              Generate diagrams
            </label>
            <ChatToggle open={subjectChatOpen} onToggle={toggleSubjectChat} />
            <Button variant="primary" disabled={!topics.length || !aiSettings.ready} onClick={() => startPractice()} title="Practice problems or flashcards. Right-click a topic or folder to study just that.">Practice</Button>
          </div>
        </div>
        {error && <ErrorMessage>{error}</ErrorMessage>}
      </div>

      {/* Below the title on narrow screens; beside everything, and in view while the page scrolls, on wide ones. */}
      {subjectChat && <div className="mb-12 self-start lg:sticky lg:top-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mb-0">
        <SavedChat key={subject.id} path={`/api/subjects/${subject.id}/chat`} name={subject.name} className="lg:h-[min(40rem,calc(100dvh-14rem))]"
          empty="Ask about your progress, weakest topics, or what to study next, or about the course material." />
      </div>}

      <div>
        <section className="mb-12">
          <div className={`${sectionHead} flex-wrap`}><h2 className="text-xl font-semibold">Topics</h2>
            <div className="flex flex-wrap items-center justify-end gap-2 max-sm:w-full">
              {topics.length > 1 && <Button variant="ghost" onClick={() => void proposeOrganization()} disabled={organizing !== null || !aiSettings.ready} title="Have the model propose folders for your topics"><Sparkles size={16} />Organize</Button>}
              <IconButton label="New folder" onClick={() => void addFolder()}><FolderPlus size={20} /></IconButton>
              <form className="flex items-center gap-2 max-sm:order-first max-sm:w-full" onSubmit={addTopic}><Input className="w-56 max-sm:w-auto max-sm:flex-1" aria-label="Topic name" value={topicName} maxLength={160} onChange={e => setTopicName(e.target.value)} placeholder="Add a topic" /><IconButton type="submit" label="Add topic" className="border border-line bg-surface" disabled={!topicName.trim() || busy}><Plus size={18} /></IconButton></form>
            </div>
          </div>
          {tree.length > 0 && <TopicTree groups={groups} topics={topics} collapsed={collapsed} onToggle={(groupId) => toggleFolder(groupId)} actions={treeActions} highlightId={highlightId} />}
          {tree.length === 0 && <p className="text-muted">Add a topic to start practicing.</p>}
        </section>

        <section>
          <div className={sectionHead}><h2 className="text-xl font-semibold">Resources</h2><Button onClick={() => fileRef.current?.click()} disabled={busy}><Plus size={18} />{uploadProgress || "Add"}</Button></div>
          <input ref={fileRef} type="file" accept=".pdf,.txt,.md,text/plain,application/pdf" multiple hidden onChange={e => void uploadFiles(e.currentTarget.files)} />
          {resources.length > 0 && <List>{resources.map((resource) => <ListItem key={resource.id}><button type="button" className={rowTitle} onClick={() => void showResourceText(resource)} disabled={resourceTextLoading} title="View extracted text"><FileText size={18} className="flex-none text-muted" /><span className="truncate">{resource.filename}</span></button><IconButton label={`Remove ${resource.filename}`} tone="danger" onClick={() => removeResource(resource)}><Trash2 size={18} /></IconButton></ListItem>)}</List>}
        </section>
      </div>
    </div>}

    {suggestions && <Modal title="Suggested topics" subtitle={suggestions.resource.filename} onClose={closeSuggestions}>
      <List>{suggestions.topics.map((suggestion) => {
        const existing = topics.find((topic) => topic.name.toLocaleLowerCase() === suggestion.name.toLocaleLowerCase());
        const path = existing ? groupPath(groups, existing.groupId) : suggestion.path;
        const newFolders = existing ? 0 : suggestion.path.length - groupPath(groups, matchPath(groups, suggestion.path)).length;
        return <ListItem key={suggestion.name}>
          <div className="flex min-w-0 flex-1 flex-col">
            <span>{existing?.name ?? suggestion.name}</span>
            <span className="text-xs text-muted">{existing ? "Existing topic" : "New topic"} in {path.length ? path.join(" › ") : "the top level"}{newFolders > 0 && ` (${newFolders === 1 ? "new folder" : `${newFolders} new folders`})`}</span>
          </div>
          <Button size="sm" onClick={() => addSuggestedTopic(suggestion)}>{existing ? <><Check size={16} />Link</> : <><Plus size={16} />Add</>}</Button>
        </ListItem>;
      })}</List>
      <div className="mt-6 flex justify-end"><Button onClick={closeSuggestions}>{suggestionQueue.length > 1 ? "Next resource" : "Done"}</Button></div>
    </Modal>}

    {resourceText && <Modal wide title={resourceText.filename} label={`Summary and extracted text from ${resourceText.filename}`} onClose={() => setResourceText(null)}>
      <Tabs label="Resource content" actions={resourceTab === "summary" && chatToggle} value={resourceTab} onChange={setResourceTab} tabs={[{ id: "summary", label: "Summary" }, { id: "topics", label: "Topics", count: resourceText.topics.length }, { id: "extracted", label: "Extracted text", count: resourceText.extractedText.length }]} />
      {resourceTab === "summary" ? <WithChat open={chatOpen} chat={<SavedChat key={resourceText.id} path={`/api/resources/${resourceText.id}/chat`} name={resourceText.filename} className={splitChat} />}><section role="tabpanel" aria-label="Model summary">
        {summaryError && <ErrorMessage>{summaryError}</ErrorMessage>}
        {summaryLoading || resourceText.summaryStatus === "pending" ? pending("Summarizing this resource…", !summaryLoading && <Button size="sm" onClick={() => void generateResourceSummary(resourceText.id)}>Retry if stalled</Button>) : resourceText.summaryStatus === "complete" && resourceText.modelSummary ? <>
          <MarkdownMathText text={resourceText.modelSummary} />
        </> : <div className="flex flex-col items-start gap-4 py-4">
          <p className="text-muted">{resourceText.summaryStatus === "not_generated" ? "A model summary captures the key definitions, results, methods, and examples in this resource." : "The model could not summarize this resource."}</p>
          {resourceText.extractedText ? <Button variant="primary" onClick={() => void generateResourceSummary(resourceText.id)} disabled={summaryLoading}>{summaryLoading ? "Summarizing…" : resourceText.summaryStatus === "failed" ? "Try again" : "Create summary"}</Button> : noText}
        </div>}
      </section></WithChat> : resourceTab === "topics" ? <section role="tabpanel" aria-label="Topics linked to resource">
        {resourceTopicsError && <ErrorMessage>{resourceTopicsError}</ErrorMessage>}
        <LinkPicker noun="topic" target="resource" icon={BookOpen} items={topics} saved={resourceText.topics.map((topic) => topic.id)}
          selected={selectedResourceTopics} onSelectedChange={setSelectedResourceTopics} search={topicSearch} onSearchChange={setTopicSearch}
          suggestions={linkSuggestions[`resource:${resourceText.id}`]} onSuggest={() => loadLinkSuggestions(`resource:${resourceText.id}`, `/api/resources/${resourceText.id}/suggested-topics`)}
          saving={savingResourceIds.includes(resourceText.id)} onSave={() => void saveResourceTopics()} />
      </section> : <section role="tabpanel" aria-label="Extracted text">{resourceText.extractedText ? <pre className="rounded-md bg-subtle p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">{resourceText.extractedText}</pre> : noText}</section>}
    </Modal>}

    {groupDetail && <Modal wide title={groupDetail.name} label={`Folder summary for ${groupDetail.name}`} onClose={() => setGroupDetail(null)}
      subtitle={[...groupPath(groups, groupDetail.parentId), `${groupDetail.topicCount} topic${groupDetail.topicCount === 1 ? "" : "s"}`].join(" › ")}>
      <Tabs label="Folder content" actions={groupTab === "summary" && chatToggle} value={groupTab} onChange={setGroupTab} tabs={[{ id: "summary", label: "Summary" }, { id: "resources", label: "Resources", count: groupDetail.resources.length }]} />
      {groupErrors[groupDetail.id] && <ErrorMessage>{groupErrors[groupDetail.id]}</ErrorMessage>}
      {groupTab === "summary" ? <WithChat open={chatOpen} chat={<SavedChat key={groupDetail.id} path={`/api/groups/${groupDetail.id}/chat`} name={groupDetail.name} className={splitChat} />}><section role="tabpanel" aria-label="Folder summary">
        {summarizingGroupIds.includes(groupDetail.id) ? pending("Summarizing this folder…") : groupDetail.summary ? <>
          {groupDetail.summaryStatus === "stale" && <p className="mb-4 rounded-md border border-warning-line bg-warning-soft px-4 py-3 text-sm">This folder&apos;s contents changed. Refresh the summary to reflect them.</p>}
          <MarkdownMathText text={groupDetail.summary} />
          <div className="mt-6 flex justify-end"><Button variant={groupDetail.summaryStatus === "stale" ? "primary" : "secondary"} onClick={() => void generateGroupSummary(groupDetail.id)}>Refresh</Button></div>
        </> : <div className="flex flex-col items-start gap-4 py-4">
          <p className="text-muted">{groupDetail.topicCount ? "A short overview of the topics and folders inside." : "Add topics to this folder to summarize it."}</p>
          {groupDetail.topicCount > 0 && <Button variant="primary" onClick={() => void generateGroupSummary(groupDetail.id)}>Create summary</Button>}
        </div>}
      </section></WithChat> : <section role="tabpanel" aria-label="Resources linked to topics in this folder">
        {groupDetail.resources.length ? <List>{groupDetail.resources.map((resource) => <ListItem key={resource.id}>
          <button type="button" className={rowTitle} onClick={() => { const item = resources.find((candidate) => candidate.id === resource.id); if (item) void showResourceText(item); }}><FileText size={18} className="flex-none text-muted" /><span className="truncate">{resource.filename}</span></button>
        </ListItem>)}</List> : <p className="text-muted">No resources are linked to topics in this folder.</p>}
      </section>}
    </Modal>}

    {organizing && <Modal wide title="Organize topics" onClose={() => setOrganizing(null)}>
      {organizing === "loading" ? pending("Proposing folders for your topics…") : (() => {
        const preview = treeFromPaths(organizing.topics);
        return <>
          <p className="mb-6 text-muted">Here is a proposed tree. Topics keep their summaries, resources, and review history. Folders left empty are removed.</p>
          <TopicTree groups={preview.groups} topics={preview.topics} collapsed={previewCollapsed} onToggle={(groupId) => setPreviewCollapsed((current) => {
            const next = new Set(current);
            if (!next.delete(groupId)) next.add(groupId);
            return next;
          })} />
          <div className="mt-6 flex justify-end gap-2"><Button onClick={() => setOrganizing(null)}>Cancel</Button><Button variant="primary" onClick={() => void applyOrganization()}>Apply</Button></div>
        </>;
      })()}
    </Modal>}

    {topicDetail && <Modal wide title={topicDetail.name} label={`Topic summary for ${topicDetail.name}`} onClose={() => setTopicDetail(null)} subtitle={topicDetail.groupId ? groupPath(groups, topicDetail.groupId).join(" › ") : undefined}>
      <Tabs label="Topic content" actions={topicTab === "summary" && chatToggle} value={topicTab} onChange={setTopicTab} tabs={[{ id: "summary", label: "Summary" }, { id: "resources", label: "Resources", count: topicDetail.resources.length }]} />
      {topicSummaryErrors[topicDetail.id] && <ErrorMessage>{topicSummaryErrors[topicDetail.id]}</ErrorMessage>}
      {topicTab === "summary" ? <WithChat open={chatOpen} chat={<SavedChat key={topicDetail.id} path={`/api/topics/${topicDetail.id}/chat`} name={topicDetail.name} className={splitChat} />}><section role="tabpanel" aria-label="Topic coverage summary">
        {summarizingTopicIds.includes(topicDetail.id) || topicDetail.summaryStatus === "pending" ? pending("Summarizing linked material…") : topicDetail.coverageSummary ? <>
          {topicDetail.summaryStatus !== "complete" && <p className="mb-4 rounded-md border border-warning-line bg-warning-soft px-4 py-3 text-sm">Linked resources changed. Refresh this summary to reflect them.</p>}
          {topicEditingSummary ? <Textarea className="min-h-96 font-mono text-sm" aria-label="Editable topic summary" value={topicDetail.coverageSummary} onChange={(event) => setTopicDetail({ ...topicDetail, coverageSummary: event.target.value })} /> : <MarkdownMathText text={topicDetail.coverageSummary} />}
          <div className="mt-6 flex flex-wrap justify-end gap-2">{topicEditingSummary ? <Button onClick={() => void saveTopicSummary()}>Save edits</Button> : <Button onClick={() => setTopicEditingSummary(true)}>Edit</Button>}<Button variant="primary" disabled={!topicDetail.resources.length} onClick={() => void generateTopicSummary(topicDetail.id)}>Refresh from resources</Button></div>
        </> : <div className="flex flex-col items-start gap-4 py-4"><p className="text-muted">{topicDetail.resources.length ? "Create an editable summary of the material linked to this topic." : "Link one or more resources to build a topic summary."}</p><Button variant="primary" disabled={!topicDetail.resources.length} onClick={() => void generateTopicSummary(topicDetail.id)}>Create summary</Button></div>}
      </section></WithChat> : <section role="tabpanel" aria-label="Resources linked to topic">
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

// A viewer's summary with its chat, when open, beside it on wide screens and below it on narrow ones. The chat stays in view
// while the summary scrolls the modal.
function WithChat({ open, chat, children }: { open: boolean; chat: ReactNode; children: ReactNode }) {
  if (!open) return children;
  return <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:items-start">
    <div className="min-w-0">{children}</div>
    <div className="lg:sticky lg:top-0">{chat}</div>
  </div>;
}

// A boolean kept in localStorage under `key`, starting from `initial` when nothing is stored.
function useStoredToggle(key: string, initial: boolean) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    try { const stored = localStorage.getItem(key); if (stored) setValue(stored === "true"); } catch { /* Use the default. */ }
  }, [key]);
  const toggle = () => setValue((current) => {
    try { localStorage.setItem(key, String(!current)); } catch { /* Keep it for this visit only. */ }
    return !current;
  });
  return [value, toggle] as const;
}

function ChatToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return <IconButton label={open ? "Hide chat" : "Show chat"} aria-pressed={open} className="aria-pressed:text-accent" onClick={onToggle}><MessageSquare size={18} /></IconButton>;
}

// Tall enough to fill the modal below its title and tabs.
const splitChat = "lg:h-[calc(100dvh-14rem)]";

// Returns the item `step` places from `current`, wrapping around; `current` itself if it is not in the list.
function cycle<T>(items: readonly T[], current: T, step: number) {
  const index = items.indexOf(current);
  return index < 0 ? current : items[(index + step + items.length) % items.length];
}

const sectionHead = "mb-3 flex min-h-control items-center justify-between gap-4";
const rowTitle = "flex min-w-0 flex-1 items-center gap-3 self-stretch text-left hover:text-accent disabled:cursor-wait";

// The deepest existing folder along `path`, matched case-insensitively like the server does.
function matchPath(groups: Group[], path: string[]) {
  let parentId: string | null = null;
  for (const name of path) {
    const next = groups.find((group) => group.parentId === parentId && group.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (!next) break;
    parentId = next.id;
  }
  return parentId;
}
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
