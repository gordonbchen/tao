"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { CircleHelp, Moon, Settings, Sun, UserRound } from "lucide-react";

export type Subject = { id: string; name: string; topicCount: number; dueCount: number };

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "Something went wrong. Please try again.");
  return body as T;
}

type UndoState = { message: string; undo: () => void; commit: () => Promise<void>; restore: () => void };
let pendingUndo: { id: string; state: UndoState; timer: ReturnType<typeof setTimeout> } | null = null;
const undoListeners = new Set<(state: UndoState | null) => void>();
const pendingRemovalIds = new Set<string>();

export function isPendingRemoval(id: string) { return pendingRemovalIds.has(id); }

function publishUndo(state: UndoState | null) { undoListeners.forEach((listener) => listener(state)); }

export function scheduleUndoDelete(id: string, state: Omit<UndoState, "undo">) {
  if (pendingUndo) {
    clearTimeout(pendingUndo.timer);
    const previous = pendingUndo.state;
    const previousId = pendingUndo.id;
    pendingUndo = null;
    publishUndo(null);
    pendingRemovalIds.delete(previousId);
    void previous.commit().then(() => window.dispatchEvent(new Event("tao:refresh"))).catch(() => {
      previous.restore();
      window.dispatchEvent(new CustomEvent("tao:error", { detail: "Could not remove item." }));
    });
  }
  const entry = { ...state, undo: () => {
    if (!pendingUndo || pendingUndo.state !== entry) return;
    clearTimeout(pendingUndo.timer);
    pendingUndo = null;
    pendingRemovalIds.delete(id);
    publishUndo(null);
    entry.restore();
    window.dispatchEvent(new Event("tao:refresh"));
  } };
  const timer = setTimeout(async () => {
    if (pendingUndo?.state !== entry) return;
    pendingUndo = null;
    pendingRemovalIds.delete(id);
    publishUndo(null);
    try {
      await entry.commit();
      window.dispatchEvent(new Event("tao:refresh"));
    } catch {
      entry.restore();
      window.dispatchEvent(new Event("tao:refresh"));
      window.dispatchEvent(new CustomEvent("tao:error", { detail: "Could not remove item." }));
    }
  }, 10_000);
  pendingRemovalIds.add(id);
  pendingUndo = { id, state: entry, timer };
  publishUndo(entry);
}

function UndoToast() {
  const [state, setState] = useState<UndoState | null>(null);
  useEffect(() => {
    undoListeners.add(setState);
    if (pendingUndo) setState(pendingUndo.state);
    return () => { undoListeners.delete(setState); };
  }, []);
  if (!state) return null;
  return <div className="undo-toast" role="status"><span>{state.message}</span><button onClick={state.undo}>Undo</button></div>;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState("light");
  const [panel, setPanel] = useState<"help" | "settings" | "profile" | null>(null);
  useEffect(() => {
    const saved = localStorage.getItem("tao-theme");
    if (saved === "dark") { setTheme("dark"); document.documentElement.dataset.theme = "dark"; }
  }, []);
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("tao-theme", next);
  }
  return <div className="app-frame">
    <header className="site-header"><div className="site-header-inner">
      <Link className="site-brand" href="/"><Image src="/icon.svg" alt="" width={30} height={30} /><span>Tao</span></Link>
      <nav className="header-actions" aria-label="Site controls">
        <button type="button" aria-label="Help" title="Help" aria-expanded={panel === "help"} onClick={() => setPanel(panel === "help" ? null : "help")}><CircleHelp size={20} /></button>
        <button type="button" aria-label="Settings" title="Settings" aria-expanded={panel === "settings"} onClick={() => setPanel(panel === "settings" ? null : "settings")}><Settings size={20} /></button>
        <button type="button" aria-label={theme === "dark" ? "Use light mode" : "Use dark mode"} title={theme === "dark" ? "Light mode" : "Dark mode"} onClick={toggleTheme}>{theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}</button>
        <button type="button" className="profile-control" aria-label="Profile" aria-expanded={panel === "profile"} onClick={() => setPanel(panel === "profile" ? null : "profile")}><UserRound size={20} /><span>Local profile</span></button>
      </nav>
      {panel && <div className="header-popover" role="region" aria-label={panel === "help" ? "Help" : panel === "settings" ? "Settings" : "Profile"}>
        {panel === "help" ? <><strong>How to use Tao</strong><p>Add topics and course resources to a subject, then choose Practice. Ask for a hint as you work; Shift+Enter sends a chat message.</p></> : panel === "settings" ? <><strong>Settings</strong><button className="popover-action" onClick={toggleTheme}>{theme === "dark" ? "Use light mode" : "Use dark mode"}</button><p>AI provider settings are on the practice page.</p></> : <><strong>Local profile</strong><p>This local prototype uses one shared profile. Sign-in is planned before public access.</p></>}
      </div>}
    </div></header>
    {children}<UndoToast />
  </div>;
}

export function LoadingCard() { return <div className="loading-card"><span className="spinner" />Loading your learning space…</div>; }
