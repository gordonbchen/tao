"use client";

import { useState } from "react";
import { BookOpen, Folder } from "lucide-react";
import { buildTree, descendantGroupIds, flattenTree, type TreeGroup, type TreeTopic } from "@/lib/topic-tree";
import { Button, Modal } from "../../ui";

// Any mix of topics and folders; empty means every topic.
export type StudySelection = { topicIds: string[]; groupIds: string[] };

export function selectionLabel({ topicIds, groupIds }: StudySelection, topics: TreeTopic[], groups: TreeGroup[]) {
  const count = topicIds.length + groupIds.length;
  if (!count) return "All topics";
  if (count > 1) return `${count} selected`;
  return topics.find((topic) => topic.id === topicIds[0])?.name ?? groups.find((group) => group.id === groupIds[0])?.name ?? "1 selected";
}

// Tree of checkboxes for choosing what to study. Checking a folder includes everything inside it.
export function SelectionDialog({ value, topics, groups, onApply, onClose }: {
  value: StudySelection; topics: TreeTopic[]; groups: TreeGroup[]; onApply: (selection: StudySelection) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const rows = flattenTree(buildTree(groups, topics));
  const covered = new Set(draft.groupIds.flatMap((id) => [...descendantGroupIds(groups, id)]));
  const toggle = (key: "topicIds" | "groupIds", id: string) => setDraft((current) => {
    const next = { ...current, [key]: current[key].includes(id) ? current[key].filter((item) => item !== id) : [...current[key], id] };
    if (key !== "groupIds" || !next.groupIds.includes(id)) return next;
    // A checked folder replaces separately checked items inside it.
    const inside = descendantGroupIds(groups, id);
    return {
      groupIds: next.groupIds.filter((groupId) => groupId === id || !inside.has(groupId)),
      topicIds: next.topicIds.filter((topicId) => !inside.has(topics.find((topic) => topic.id === topicId)?.groupId ?? "")),
    };
  });

  return <Modal title="Choose topics" onClose={onClose}>
    <ul className="-mx-2 max-h-[60vh] overflow-auto">
      {rows.map((row) => {
        const isGroup = row.kind === "group";
        const id = isGroup ? row.group.id : row.topic.id;
        const parentId = isGroup ? row.group.parentId : row.topic.groupId;
        const inherited = parentId !== null && covered.has(parentId);
        const checked = inherited || (isGroup ? draft.groupIds : draft.topicIds).includes(id);
        const Icon = isGroup ? Folder : BookOpen;
        return <li key={id}>
          <label className="flex h-control-sm cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-hover has-disabled:cursor-default has-disabled:hover:bg-transparent" style={{ paddingLeft: 8 + row.depth * 24 }}>
            <input type="checkbox" className="size-4 flex-none accent-accent" checked={checked} disabled={inherited} onChange={() => toggle(isGroup ? "groupIds" : "topicIds", id)} />
            <Icon size={16} className="flex-none text-muted" />
            <span className={isGroup ? "truncate font-semibold" : "truncate"}>{isGroup ? row.group.name : row.topic.name}</span>
          </label>
        </li>;
      })}
    </ul>
    <div className="mt-6 flex justify-end gap-2">
      <Button onClick={() => onApply({ topicIds: [], groupIds: [] })}>All topics</Button>
      <Button variant="primary" onClick={() => onApply(draft)}>Study selected</Button>
    </div>
  </Modal>;
}
