"use client";

import { useState, type DragEvent, type MouseEvent, type ReactNode } from "react";
import { BookOpen, BookPlus, Check, ChevronRight, Folder, FolderOpen, FolderPlus, Pencil, Trash2, X } from "lucide-react";
import { buildTree, descendantGroupIds, flattenTree, MAX_DEPTH, positionAt, siblingPositions, type TreeNode } from "@/lib/topic-tree";
import { cn, ContextMenu, IconButton, Input, Select, type MenuItem } from "../../ui";

export type Group = { id: string; name: string; parentId: string | null; position?: number };
export type Topic = { id: string; name: string; groupId: string | null; position?: number; summaryStatus?: string };
export type TreeItem = { kind: "group" | "topic"; id: string };

export type TreeActions = {
  openTopic: (topic: Topic) => void;
  openGroup: (group: Group) => void;
  saveTopic: (topic: Topic, name: string, groupId: string | null) => void;
  saveGroup: (group: Group, name: string, parentId: string | null) => void;
  removeTopic: (topic: Topic) => void;
  removeGroup: (group: Group) => void;
  addFolder: (parentId: string | null) => void;
  addTopic: (groupId: string) => void;
  move: (item: TreeItem, parentId: string | null, position: number) => void;
  editingId: string | null;
  renameOnly: boolean;
  setEditingId: (id: string | null) => void;
};

type DropMode = "before" | "after" | "inside";
// A row that accepts drops. `id` is null for the top-level zone shown while dragging.
type DropRow = { key: string; id: string | null; parentId: string | null; folder?: { open: boolean } };

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

// Collapsible folders of topics. Dragging a row onto the top or bottom edge of another row places it before or
// after that row; dropping on a folder's middle puts it last inside. The edit form's folder select moves without a pointer. Right-click (or the context-menu key) on a row
// offers edit, new topic or folder, and delete.
export function TopicTree({ groups, topics, collapsed, onToggle, actions, highlightId }: TopicTreeProps) {
  const nodes = buildTree(groups, topics);
  const folders = flattenTree(nodes).filter((node) => node.kind === "group");
  const [dragged, setDragged] = useState<TreeItem | null>(null);
  const [dropTarget, setDropTarget] = useState<{ key: string; mode: DropMode } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; label: string; items: MenuItem[] } | null>(null);

  const menuProps = (label: string, items: MenuItem[]) => actions ? {
    onContextMenu: (event: MouseEvent) => {
      event.preventDefault();
      // The keyboard context-menu key reports no pointer position, so open beside the row instead.
      const keyboard = event.clientX === 0 && event.clientY === 0;
      const rect = event.currentTarget.getBoundingClientRect();
      setMenu({ x: keyboard ? rect.left + 24 : event.clientX, y: keyboard ? rect.bottom : event.clientY, label, items });
    },
  } : {};

  const canDrop = (parentId: string | null) =>
    Boolean(dragged && (dragged.kind === "topic" || !parentId || !descendantGroupIds(groups, dragged.id).has(parentId)));
  // Top quarter of a folder row (half of a topic row) is before it, bottom is after; the rest of a folder is inside.
  // An open folder has no "after" band, since its children follow it directly.
  const dropMode = (event: DragEvent, row: DropRow): DropMode => {
    if (!row.id) return "inside";
    const rect = event.currentTarget.getBoundingClientRect();
    const offset = (event.clientY - rect.top) / rect.height;
    if (!row.folder) return offset < 0.5 ? "before" : "after";
    return offset < 0.25 ? "before" : offset > 0.75 && !row.folder.open ? "after" : "inside";
  };
  const placement = (row: DropRow, mode: DropMode) => {
    if (!dragged || row.id === dragged.id) return null;
    const parentId = mode === "inside" ? row.id : row.parentId;
    if (!canDrop(parentId)) return null;
    const siblings = siblingPositions(groups, topics, parentId, dragged.id);
    const index = mode === "inside" ? siblings.length : siblings.findIndex((sibling) => sibling.id === row.id) + (mode === "after" ? 1 : 0);
    return { parentId, position: positionAt(siblings.map((sibling) => sibling.position), index) };
  };
  const dropProps = (row: DropRow) => actions ? {
    onDragOver: (event: DragEvent) => {
      const mode = dropMode(event, row);
      if (!placement(row, mode)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (dropTarget?.key !== row.key || dropTarget.mode !== mode) setDropTarget({ key: row.key, mode });
    },
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget((current) => current?.key === row.key ? null : current);
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      setDropTarget(null);
      const place = placement(row, dropMode(event, row));
      if (dragged && place) actions.move(dragged, place.parentId, place.position);
    },
  } : {};
  // Inside is a tinted row; before and after draw an accent line on that edge.
  const dropClass = (key: string) => dropTarget?.key !== key ? undefined : dropTarget.mode === "inside" ? "bg-accent-soft"
    : cn("relative before:absolute before:inset-x-0 before:h-0.5 before:bg-accent", dropTarget.mode === "before" ? "before:-top-px" : "before:-bottom-px");
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
    return <EditForm key={id} kind={kind} name={name} parentId={parentId} renameOnly={actions?.renameOnly} onSave={save} onCancel={() => actions?.setEditingId(null)}
      folders={folders.filter((folder) => !excluded.has(folder.group.id)).map((folder) => ({ id: folder.group.id, name: folder.group.name, depth: folder.depth }))} />;
  };

  const render = (node: TreeNode<Group, Topic>, depth: number): ReactNode => {
    if (node.kind === "topic") {
      const { topic } = node;
      const key = `topic:${topic.id}`;
      return <li key={key}>
        <div className={cn(row, dropClass(key), highlightId === topic.id && "animate-flash")} style={indent(depth)}
          {...dragProps({ kind: "topic", id: topic.id })} {...dropProps({ key, id: topic.id, parentId: topic.groupId })} {...menuProps(topic.name, actions ? [
            { label: "Edit", icon: <Pencil size={16} />, onSelect: () => actions.setEditingId(topic.id) },
            { label: "New folder here", icon: <FolderPlus size={16} />, disabled: depth >= MAX_DEPTH, onSelect: () => actions.addFolder(topic.groupId) },
            { label: "Delete", icon: <Trash2 size={16} />, danger: true, onSelect: () => actions.removeTopic(topic) },
          ] : [])}>
          {groups.length > 0 && <span className="size-control-sm flex-none" />}
          {actions?.editingId === topic.id ? editForm("topic", topic.id, topic.name, topic.groupId, (name, groupId) => actions.saveTopic(topic, name, groupId)) : <>
            <button type="button" className={rowTitle} disabled={!actions} onClick={() => actions?.openTopic(topic)} title={actions && "View topic summary and linked resources. Right-click for more."}>
              <BookOpen size={18} className="flex-none text-muted" /><span className="truncate">{topic.name}</span>
            </button>
          </>}
        </div>
      </li>;
    }
    const { group, children, topicCount } = node;
    const key = `group:${group.id}`;
    const open = !collapsed.has(group.id);
    const FolderIcon = open ? FolderOpen : Folder;
    return <li key={key}>
      <div className={cn(row, dropClass(key), highlightId === group.id && "animate-flash")} style={indent(depth)}
        {...dragProps({ kind: "group", id: group.id })} {...dropProps({ key, id: group.id, parentId: group.parentId, folder: { open } })} {...menuProps(group.name, actions ? [
          { label: "Edit", icon: <Pencil size={16} />, onSelect: () => actions.setEditingId(group.id) },
          { label: "New topic inside", icon: <BookPlus size={16} />, onSelect: () => actions.addTopic(group.id) },
          { label: "New folder inside", icon: <FolderPlus size={16} />, disabled: depth + 1 >= MAX_DEPTH, onSelect: () => actions.addFolder(group.id) },
          { label: "Delete folder and contents", icon: <Trash2 size={16} />, danger: true, onSelect: () => actions.removeGroup(group) },
        ] : [])}>
        <IconButton size="sm" label={open ? `Collapse ${group.name}` : `Expand ${group.name}`} aria-expanded={open} onClick={() => onToggle(group.id)}>
          <ChevronRight size={18} className={cn("transition-transform duration-200 ease-out motion-reduce:transition-none", open && "rotate-90")} />
        </IconButton>
        {actions?.editingId === group.id ? editForm("folder", group.id, group.name, group.parentId, (name, parentId) => actions.saveGroup(group, name, parentId)) : <>
          <button type="button" className={cn(rowTitle, "font-semibold")} disabled={!actions} onClick={() => actions?.openGroup(group)} title={actions && "View folder summary and resources. Right-click for more."}>
            <FolderIcon size={18} className="flex-none text-muted" /><span className="truncate">{group.name}</span>
            <span className="flex-none text-xs font-normal text-muted">{topicCount}</span>
          </button>
        </>}
      </div>
      {/* Animating grid rows from 0fr to 1fr collapses the folder to its content height without measuring it. */}
      <div className={cn("grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")} inert={!open}>
        <ul className="min-h-0 overflow-hidden">
          {children.map((child) => render(child, depth + 1))}
          {!children.length && actions && <li className="flex min-h-12 items-center border-b border-line py-2 text-sm text-muted" style={indent(depth + 1)}>
            <span className="size-control-sm flex-none" /><span className="pl-2">Empty. Drag topics here.</span>
          </li>}
        </ul>
      </div>
    </li>;
  };

  return <>
    <ul className="border-t border-line">{nodes.map((node) => render(node, 0))}</ul>
    {dragged && groups.length > 0 && <div {...dropProps({ key: "root", id: null, parentId: null })} className={cn("mt-2 flex h-control items-center justify-center rounded-md border border-line text-sm text-muted transition-colors",
      dropTarget?.key === "root" && "border-accent bg-accent-soft text-accent")}>Move to the end of the top level</div>}
    {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
  </>;
}

type EditFormProps = {
  kind: "topic" | "folder";
  name: string;
  parentId: string | null;
  renameOnly?: boolean;
  folders: { id: string; name: string; depth: number }[];
  onSave: (name: string, parentId: string | null) => void;
  onCancel: () => void;
};

// Renames an item and moves it to another folder in one step.
function EditForm({ kind, name, parentId, renameOnly, folders, onSave, onCancel }: EditFormProps) {
  const [value, setValue] = useState(name);
  const [parent, setParent] = useState(parentId ?? "");
  return <form className="flex min-w-0 flex-1 flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); onSave(value.trim() || name, parent || null); }}
    onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onCancel(); } }}>
    <Input className="min-w-40 flex-1" aria-label={kind === "topic" ? "Topic name" : "Folder name"} autoFocus onFocus={(event) => event.currentTarget.select()}
      maxLength={160} value={value} onChange={(event) => setValue(event.target.value)} />
    {!renameOnly && <Select className="max-w-56 max-sm:max-w-none max-sm:flex-1" aria-label="Folder" value={parent} onChange={(event) => setParent(event.target.value)}>
      <option value="">Top level</option>
      {folders.map((folder) => <option key={folder.id} value={folder.id}>{" ".repeat(folder.depth + 1)}{folder.name}</option>)}
    </Select>}
    <IconButton type="submit" label={`Save ${kind}`}><Check size={18} /></IconButton>
    <IconButton label="Cancel editing" onClick={onCancel}><X size={18} /></IconButton>
  </form>;
}
