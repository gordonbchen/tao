"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, ChevronDown } from "lucide-react";
import type { TreeGroup, TreeTopic } from "@/lib/topic-tree";
import { api, AppShell, LoadingCard, Subject } from "../../components";
import { Button, ErrorMessage, Page, Tabs } from "../../ui";
import { Cards } from "./cards";
import { Problems } from "./problems";
import { selectionLabel, SelectionDialog, type StudySelection } from "./selection";

type Mode = "problems" | "cards";
const MODE_KEY = "tao-study-mode";

export default function StudyPage() {
  return <AppShell><StudyContent /></AppShell>;
}

// Problems or flashcards for any mix of topics and folders. The URL carries the mode and selection
// (`?mode=cards&topic=…&group=…`); without a mode, the last one used opens.
function StudyContent() {
  const { subjectId } = useParams<{ subjectId: string }>();
  const [subject, setSubject] = useState<Subject | null>(null);
  const [topics, setTopics] = useState<TreeTopic[]>([]);
  const [groups, setGroups] = useState<TreeGroup[]>([]);
  const [mode, setMode] = useState<Mode | null>(null);
  const [selection, setSelection] = useState<StudySelection>({ topicIds: [], groupIds: [] });
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const requested = search.get("mode");
    let stored: string | null = null;
    try { stored = localStorage.getItem(MODE_KEY); } catch {}
    setMode(requested === "cards" || requested === "problems" ? requested : stored === "cards" ? "cards" : "problems");
    setSelection({ topicIds: search.getAll("topic"), groupIds: search.getAll("group") });
    api<{ subject: Subject; topics: TreeTopic[]; groups: TreeGroup[] }>(`/api/subjects/${subjectId}`).then((data) => {
      setSubject(data.subject);
      document.title = `Tao - ${data.subject.name}`;
      setTopics(data.topics ?? []);
      setGroups(data.groups ?? []);
    }).catch((e) => setError(e.message));
  }, [subjectId]);

  function update(next: { mode?: Mode; selection?: StudySelection }) {
    const nextMode = next.mode ?? mode ?? "problems";
    const nextSelection = next.selection ?? selection;
    setMode(nextMode);
    setSelection(nextSelection);
    try { localStorage.setItem(MODE_KEY, nextMode); } catch {}
    const search = new URLSearchParams([["mode", nextMode], ...nextSelection.topicIds.map((id) => ["topic", id]), ...nextSelection.groupIds.map((id) => ["group", id])]);
    window.history.replaceState(null, "", `?${search}`);
  }

  const selectionKey = `${selection.topicIds.join(",")}|${selection.groupIds.join(",")}`;

  return <Page className="max-w-6xl pt-8">
    <Link href={`/subjects/${subjectId}`} className="mb-6 inline-flex items-center gap-2 text-sm text-muted underline-offset-4 hover:text-ink hover:underline"><ArrowLeft size={18} />{subject?.name || "Subject"}</Link>
    {error ? <ErrorMessage>{error}</ErrorMessage> : !subject || !mode ? <LoadingCard /> : <>
      {/* One row that never wraps, so the active tab's underline stays on the border; the selection shrinks and truncates instead. */}
      <div className="mb-6 flex items-center gap-4 border-b border-line">
        <Tabs className="m-0 flex-none border-0" label="Study mode" value={mode} onChange={(id) => update({ mode: id })} tabs={[{ id: "problems", label: "Problems" }, { id: "cards", label: "Flashcards" }]} />
        <Button variant="ghost" className="ml-auto min-w-0" onClick={() => setChoosing(true)} title="Choose topics and folders to study together">
          <span className="truncate">{selectionLabel(selection, topics, groups)}</span><ChevronDown size={16} className="flex-none" />
        </Button>
      </div>
      {!topics.length && mode === "problems" ? <p className="text-muted">Add a topic before practicing.</p>
        : mode === "problems" ? <Problems key={selectionKey} subjectId={subjectId} topics={topics} selection={selection} />
        : <Cards key={selectionKey} subjectId={subjectId} topics={topics} groups={groups} selection={selection} />}
      {choosing && <SelectionDialog value={selection} topics={topics} groups={groups} onClose={() => setChoosing(false)} onApply={(next) => { setChoosing(false); update({ selection: next }); }} />}
    </>}
  </Page>;
}
