"use client";

import { useState, type DragEvent, type ReactNode } from "react";
import { BookOpen, Check, ChevronRight, Folder, FolderOpen, Pencil, Trash2, X } from "lucide-react";
import { buildTree, descendantGroupIds, flattenTree, type TreeNode } from "@/lib/topic-tree";
import { cn, IconButton, Input, Select } from "../../ui";

export type Group = { id: string; name: string; parentId: string | null };
export type Topic = { id: string; name: string; groupId: string | null; summaryStatus?: string };
export type TreeItem = { kind: "group" | "topic"; id: string };

export type TreeActions = {
  openTopic: (topic: Topic) => void;
  openGroup: (group: Group) => void;
  saveTopic: (topic: Topic, name: string, groupId: string | null) => void;
  saveGroup: (group: Group, name: string, parentId: string | null) => void;
  removeTopic: (topic: Topic) => void;
  removeGroup: (group: Group) => void;
  move: (item: TreeItem, parentId: string | null) => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
};

type TopicTreeProps = {
  groups: Group[];
  topics: Topic[];
  collapsed: Set<string>;
  onToggle: (groupId: string) => void;
  // Without actions the tree is a read-only preview.
  actions?: TreeActions;
  highlightId?: string | null;
};

const row = "flex min-h-14 items-center gap-2 border-b border-line py-2 transition-colors";
const rowTitle = "flex min-w-0 flex-1 items-center gap-3 self-stretch text-left enabled:hover:text-accent";
const indent = (depth: number) => ({ paddingLeft: depth * 24 });

// Collapsible folders of topics. Rows can be dragged onto a folder, beside a topic, or to the top level;
// the edit form's folder select does the same without a pointer.
export function TopicTree({ groups, topics, collapsed, onToggle, actions, highlightId }: TopicTreeProps) {
  const nodes = buildTree(groups, topics);
  const folders = flattenTree(nodes).filter((node) => node.kind === "group");
  const [dragged, setDragged] = useState<TreeItem | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const canDrop = (parentId: string | null) =>
    Boolean(dragged && (dragged.kind === "topic" || !parentId || !descendantGroupIds(groups, dragged.id).has(parentId)));
  const dropProps = (key: string, parentId: string | null) => actions ? {
    onDragOver: (event: DragEvent) => {
      if (!canDrop(parentId)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (dropTarget !== key) setDropTarget(key);
    },
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget((current) => current === key ? null : current);
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      setDropTarget(null);
      if (dragged && canDrop(parentId)) actions.move(dragged, parentId);
    },
  } : {};
  const dragProps = (item: TreeItem) => actions && actions.editingId !== item.id ? {
    draggable: true,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", item.id);
      // Changing the DOM during dragstart (the top-level drop zone appears) cancels the drag in some browsers.
      setTimeout(() => setDragged(item));
    },
    onDragEnd: () => { setDragged(null); setDropTarget(null); },
  } : {};

  const editForm = (kind: "topic" | "folder", id: string, name: string, parentId: string | null, save: (name: string, parentId: string | null) => void) => {
    const excluded = kind === "folder" ? descendantGroupIds(groups, id) : new Set<string>();
    return <EditForm key={id} kind={kind} name={name} parentId={parentId} onSave={save} onCancel={() => actions?.setEditingId(null)}
      folders={folders.filter((folder) => !excluded.has(folder.group.id)).map((folder) => ({ id: folder.group.id, name: folder.group.name, depth: folder.depth }))} />;
  };

  const render = (node: TreeNode<Group, Topic>, depth: number): ReactNode => {
    if (node.kind === "topic") {
      const { topic } = node;
      const key = `topic:${topic.id}`;
      return <li key={key}>
        <div className={cn(row, dropTarget === key && "bg-accent-soft", highlightId === topic.id && "animate-flash")} style={indent(depth)}
          {...dragProps({ kind: "topic", id: topic.id })} {...dropProps(key, topic.groupId)}>
          {groups.length > 0 && <span className="size-control-sm flex-none" />}
          {actions?.editingId === topic.id ? editForm("topic", topic.id, topic.name, topic.groupId, (name, groupId) => actions.saveTopic(topic, name, groupId)) : <>
            <button type="button" className={rowTitle} disabled={!actions} onClick={() => actions?.openTopic(topic)} title={actions && "View topic summary and linked resources"}>
              <BookOpen size={18} className="flex-none text-muted" /><span className="truncate">{topic.name}</span>
            </button>
            {actions && <>
              <IconButton label={`Edit ${topic.name}`} onClick={() => actions.setEditingId(topic.id)}><Pencil size={18} /></IconButton>
              <IconButton label={`Remove ${topic.name}`} tone="danger" onClick={() => actions.removeTopic(topic)}><Trash2 size={18} /></IconButton>
            </>}
          </>}
        </div>
      </li>;
    }
    const { group, children, topicCount } = node;
    const key = `group:${group.id}`;
    const open = !collapsed.has(group.id);
    const FolderIcon = open ? FolderOpen : Folder;
    return <li key={key}>
      <div className={cn(row, dropTarget === key && "bg-accent-soft", highlightId === group.id && "animate-flash")} style={indent(depth)}
        {...dragProps({ kind: "group", id: group.id })} {...dropProps(key, group.id)}>
        <IconButton size="sm" label={open ? `Collapse ${group.name}` : `Expand ${group.name}`} aria-expanded={open} onClick={() => onToggle(group.id)}>
          <ChevronRight size={18} className={cn("transition-transform duration-200 ease-out motion-reduce:transition-none", open && "rotate-90")} />
        </IconButton>
        {actions?.editingId === group.id ? editForm("folder", group.id, group.name, group.parentId, (name, parentId) => actions.saveGroup(group, name, parentId)) : <>
          <button type="button" className={cn(rowTitle, "font-semibold")} disabled={!actions} onClick={() => actions?.openGroup(group)} title={actions && "View folder summary and resources"}>
            <FolderIcon size={18} className="flex-none text-muted" /><span className="truncate">{group.name}</span>
            <span className="flex-none text-xs font-normal text-muted">{topicCount}</span>
          </button>
          {actions && <>
            <IconButton label={`Edit ${group.name}`} onClick={() => actions.setEditingId(group.id)}><Pencil size={18} /></IconButton>
            <IconButton label={`Remove ${group.name} and everything in it`} tone="danger" onClick={() => actions.removeGroup(group)}><Trash2 size={18} /></IconButton>
          </>}
        </>}
      </div>
      {/* Animating grid rows from 0fr to 1fr collapses the folder to its content height without measuring it. */}
      <div className={cn("grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")} inert={!open}>
        <ul className="min-h-0 overflow-hidden">
          {children.map((child) => render(child, depth + 1))}
          {!children.length && actions && <li className="flex min-h-12 items-center border-b border-line py-2 text-sm text-muted" style={indent(depth + 1)}>
            <span className="size-control-sm flex-none" /><span className="pl-2">Empty. Drag topics here, or use Edit to move them.</span>
          </li>}
        </ul>
      </div>
    </li>;
  };

  return <>
    <ul className="border-t border-line">{nodes.map((node) => render(node, 0))}</ul>
    {dragged && groups.length > 0 && <div {...dropProps("root", null)} className={cn("mt-2 flex h-control items-center justify-center rounded-md border border-line text-sm text-muted transition-colors",
      dropTarget === "root" && "border-accent bg-accent-soft text-accent")}>Move to the top level</div>}
  </>;
}

type EditFormProps = {
  kind: "topic" | "folder";
  name: string;
  parentId: string | null;
  folders: { id: string; name: string; depth: number }[];
  onSave: (name: string, parentId: string | null) => void;
  onCancel: () => void;
};

// Renames an item and moves it to another folder in one step.
function EditForm({ kind, name, parentId, folders, onSave, onCancel }: EditFormProps) {
  const [value, setValue] = useState(name);
  const [parent, setParent] = useState(parentId ?? "");
  return <form className="flex min-w-0 flex-1 flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); onSave(value.trim() || name, parent || null); }}
    onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onCancel(); } }}>
    <Input className="min-w-40 flex-1" aria-label={kind === "topic" ? "Topic name" : "Folder name"} autoFocus onFocus={(event) => event.currentTarget.select()}
      maxLength={160} value={value} onChange={(event) => setValue(event.target.value)} />
    <Select className="max-w-56 max-sm:max-w-none max-sm:flex-1" aria-label="Folder" value={parent} onChange={(event) => setParent(event.target.value)}>
      <option value="">Top level</option>
      {folders.map((folder) => <option key={folder.id} value={folder.id}>{" ".repeat(folder.depth + 1)}{folder.name}</option>)}
    </Select>
    <IconButton type="submit" label={`Save ${kind}`}><Check size={18} /></IconButton>
    <IconButton label="Cancel editing" onClick={onCancel}><X size={18} /></IconButton>
  </form>;
}
