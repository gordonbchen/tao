"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { api, isPendingRemoval, scheduleUndoDelete } from "../../components";
import { Button, Checkbox, cn, ErrorMessage, Input, Modal, Select, Spinner } from "../../ui";

export type BrowseAction = "archive" | "unarchive" | "delete" | "restore";
type Props<T> = {
  noun: string; url: string; field: string; endpoint: string; columns: string;
  // Views beside All and Archived, and orders beside newest and oldest first (the list arrives newest first).
  filters: Record<string, { label: string; test: (item: T) => boolean }>;
  sorts: Record<string, { label: string; compare: (a: T, b: T) => number }>;
  searchText: (item: T) => string; cells: (item: T) => ReactNode;
  onOpen: (item: T) => void; onChange: (action: BrowseAction, ids: string[]) => void; onClose: () => void;
};

// Served problems or cards in the selection. Rows open one item; their checkboxes choose items to archive, restore,
// or delete together. Archived items leave review but stay here under Archived. Deletion waits on the undo toast.
// The chosen view and order are remembered in this browser.
export function BrowseDialog<T extends { id: string; archived: boolean }>({ noun, url, field, endpoint, columns, filters, sorts, searchText, cells, onOpen, onChange, onClose }: Props<T>) {
  const storageKey = `tao-browse-${noun}`;
  const [items, setItems] = useState<T[] | null>(null);
  const [search, setSearch] = useState("");
  const [{ view, sort }, setOrder] = useState(() => {
    let stored: { view?: string; sort?: string } = {};
    try { stored = JSON.parse(localStorage.getItem(storageKey) ?? "{}"); } catch { /* Use the defaults. */ }
    return {
      view: stored.view && (stored.view === "archived" || stored.view in filters) ? stored.view : "all",
      sort: stored.sort && (stored.sort === "oldest" || stored.sort in sorts) ? stored.sort : "newest",
    };
  });
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api<Record<string, T[]>>(url).then((result) => setItems(result[field].filter((item) => !isPendingRemoval(item.id)))).catch((e) => setError(e.message));
  }, [url, field]);

  const plural = (count: number) => `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
  const present = (items ?? []).filter((item) => !hidden.has(item.id));
  const inView = present.filter((item) => view === "archived" ? item.archived : !item.archived && (view === "all" || filters[view].test(item)));
  const needle = search.trim().toLocaleLowerCase();
  const found = inView.filter((item) => !needle || searchText(item).toLocaleLowerCase().includes(needle));
  // Sorting is stable, so ties stay newest first.
  const matching = sort === "newest" ? found : sort === "oldest" ? found.toReversed() : found.toSorted(sorts[sort].compare);
  // Actions apply to the chosen rows the search still shows.
  const selected = matching.filter((item) => chosen.has(item.id)).map((item) => item.id);
  const archivedCount = present.filter((item) => item.archived).length;

  function choose(next: { view?: string; sort?: string }) {
    const order = { view, sort, ...next };
    setOrder(order);
    if (next.view) setChosen(new Set());
    try { localStorage.setItem(storageKey, JSON.stringify(order)); } catch { /* Keep it for this visit only. */ }
  }

  function toggle(id: string) {
    setChosen((current) => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; });
  }

  async function archive() {
    const ids = selected;
    const archived = view !== "archived";
    setBusy(true); setError("");
    try {
      await api(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, archived }) });
      const changed = new Set(ids);
      setItems((current) => current && current.map((item) => changed.has(item.id) ? { ...item, archived } : item));
      setChosen(new Set());
      onChange(archived ? "archive" : "unarchive", ids);
    } catch (e) { setError(e instanceof Error ? e.message : `Could not change the ${noun}s`); }
    finally { setBusy(false); }
  }

  function remove() {
    const ids = selected;
    setHidden((current) => new Set([...current, ...ids]));
    setChosen(new Set());
    scheduleUndoDelete(ids, {
      message: `${plural(ids.length)} deleted.`,
      commit: () => api(endpoint, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) }).then(() => {}),
      restore: () => {
        setHidden((current) => new Set([...current].filter((id) => !ids.includes(id))));
        onChange("restore", ids);
      },
    });
    onChange("delete", ids);
  }

  return <Modal title={`${noun[0].toUpperCase()}${noun.slice(1)}s`} subtitle={items ? `${plural(present.length - archivedCount)} in this selection${archivedCount ? ` · ${archivedCount.toLocaleString()} archived` : ""}` : "Loading…"} onClose={onClose} wide>
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Input className="min-w-48 flex-1" aria-label={`Search ${noun}s`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" autoFocus />
      <div className="flex items-center gap-2 max-sm:w-full">
        <Select className="max-sm:flex-1" aria-label="Show" value={view} onChange={(event) => choose({ view: event.target.value })}>
          <option value="all">All</option>
          {Object.entries(filters).map(([value, { label }]) => <option key={value} value={value}>{label}</option>)}
          <option value="archived">Archived</option>
        </Select>
        <Select className="max-sm:flex-1" aria-label="Sort" value={sort} onChange={(event) => choose({ sort: event.target.value })}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          {Object.entries(sorts).map(([value, { label }]) => <option key={value} value={value}>{label}</option>)}
        </Select>
      </div>
    </div>
    {error && <ErrorMessage className="mt-0">{error}</ErrorMessage>}
    {!items ? <p className="inline-flex items-center gap-3 text-muted"><Spinner />Loading {noun}s…</p> : <>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-paper py-2 pr-2 pl-1">
        <label className={cn("flex items-center gap-1 text-sm", matching.length > 0 && "cursor-pointer")}>
          <span className="grid size-control-sm place-items-center">
            <Checkbox checked={selected.length > 0} indeterminate={selected.length > 0 && selected.length < matching.length} disabled={!matching.length}
              onChange={() => setChosen(selected.length ? new Set() : new Set(matching.map((item) => item.id)))} />
          </span>
          {selected.length ? `${selected.length.toLocaleString()} selected` : "Select all"}
        </label>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" disabled={!selected.length || busy} onClick={() => void archive()}>
            {busy ? <Spinner /> : view !== "archived" ? <Archive size={16} /> : <ArchiveRestore size={16} />}{view !== "archived" ? "Archive" : "Unarchive"}
          </Button>
          <Button size="sm" variant="ghost" className="hover:enabled:bg-danger-soft hover:enabled:text-danger" disabled={!selected.length || busy} onClick={remove}><Trash2 size={16} />Delete</Button>
        </div>
      </div>
      <ul>
        {matching.slice(0, 300).map((item) => <li key={item.id} className={cn("flex items-center border-b border-line pl-1 transition-colors", chosen.has(item.id) ? "bg-accent-soft" : "hover:bg-hover")}>
          <label className="grid size-control-sm flex-none cursor-pointer place-items-center max-sm:mt-2 max-sm:self-start">
            <Checkbox aria-label="Select" checked={chosen.has(item.id)} onChange={() => toggle(item.id)} />
          </label>
          <button type="button" className={cn("grid min-w-0 flex-1 items-center gap-4 py-3 pr-3 pl-1 text-left text-sm max-sm:grid-cols-1 max-sm:gap-1", columns)} onClick={() => onOpen(item)}>
            {cells(item)}
          </button>
        </li>)}
        {matching.length > 300 && <li className="px-3 py-3 text-sm text-muted">Showing 300 of {matching.length.toLocaleString()}. Search to narrow the list.</li>}
        {!matching.length && <li className="px-3 py-3 text-sm text-muted">{inView.length ? `No ${noun}s match.` : view === "archived" ? `No archived ${noun}s.` : view === "all" ? `No ${noun}s yet.` : `No ${noun}s here.`}</li>}
      </ul>
    </>}
  </Modal>;
}
