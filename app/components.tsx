"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import Image from "next/image";
import { Moon, Sun } from "lucide-react";

export type Subject = { id: string; name: string; topicCount: number; dueCount: number };

type AIStatus = { available: boolean; models: { id: string; provider: string }[]; defaultModel: string };
type AIUsage = { usedPercent: number | null; remainingPercent: number | null; windowDurationMins: number | null; resetsAt: number | null; lifetimeTokens: number | null };
type AISettingsValue = { model: string; configured: boolean; ready: boolean; usage: AIUsage };
const emptyUsage: AIUsage = { usedPercent: null, remainingPercent: null, windowDurationMins: null, resetsAt: null, lifetimeTokens: null };
let aiSettingsSnapshot: AISettingsValue = { model: "gpt-6-luna", configured: false, ready: false, usage: emptyUsage };
const aiSettingsListeners = new Set<() => void>();
function updateAISettings(patch: Partial<AISettingsValue>) { aiSettingsSnapshot = { ...aiSettingsSnapshot, ...patch }; aiSettingsListeners.forEach(listener => listener()); }
const subscribeAISettings = (listener: () => void) => { aiSettingsListeners.add(listener); return () => { aiSettingsListeners.delete(listener); }; };
const getAISettingsSnapshot = () => aiSettingsSnapshot;
let requestModel = "gpt-6-luna";
export function getAiRequestHeaders(): HeadersInit {
  return { "X-Tao-AI-Model": requestModel };
}
export function notifyAiSetupRequired() { window.dispatchEvent(new Event("tao:ai-setup-required")); }
export function useAISettings() {
  const snapshot = useSyncExternalStore(subscribeAISettings, getAISettingsSnapshot, getAISettingsSnapshot);
  return { ...snapshot, setModel: updateModel, requestHeaders: getAiRequestHeaders() };
}
export function getAiSettingsSnapshot() { return { ready: aiSettingsSnapshot.ready, configured: aiSettingsSnapshot.configured }; }
function updateModel(model: string) { requestModel = model; localStorage.setItem("tao-ai-model", model); updateAISettings({ model }); }

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
  const [status, setStatus] = useState<AIStatus>({ available: false, models: [], defaultModel: "gpt-6-luna" });
  const [model, setModelState] = useState("gpt-6-luna");
  const [usage, setUsage] = useState<AIUsage>(emptyUsage);
  const [aiNotice, setAiNotice] = useState(false);
  useEffect(() => {
    const refreshUsage = () => {
      void fetch(`/api/ai/usage?model=${encodeURIComponent(requestModel)}`).then(r => r.json()).then((result: AIUsage) => {
        setUsage(result);
        updateAISettings({ usage: result });
      }).catch(() => undefined);
    };
    const saved = localStorage.getItem("tao-theme");
    if (saved === "dark") { setTheme("dark"); document.documentElement.dataset.theme = "dark"; }
    void fetch("/api/ai/status").then(r => r.json()).then((data: AIStatus) => {
      setStatus(data);
      const storedModel = localStorage.getItem("tao-ai-model");
      const nextModel = storedModel && data.models.some(option => option.id === storedModel) ? storedModel : data.defaultModel;
      setModelState(nextModel);
      requestModel = nextModel;
      updateAISettings({ model: nextModel, configured: data.available, ready: true });
      refreshUsage();
    }).catch(() => {
      updateAISettings({ configured: false, ready: true });
    });
    const onSetupRequired = () => setAiNotice(true);
    window.addEventListener("tao:ai-setup-required", onSetupRequired);
    window.addEventListener("tao:ai-model-changed", refreshUsage);
    const usageTimer = window.setInterval(refreshUsage, 60_000);
    return () => { window.removeEventListener("tao:ai-setup-required", onSetupRequired); window.removeEventListener("tao:ai-model-changed", refreshUsage); window.clearInterval(usageTimer); };
  }, []);
  function setModel(next: string) { updateModel(next); setModelState(next); window.dispatchEvent(new Event("tao:ai-model-changed")); }
  const provider = status.models.find(option => option.id === model)?.provider ?? "AI";
  useEffect(() => {
    if (!aiNotice) return;
    const timer = window.setTimeout(() => setAiNotice(false), 8000);
    return () => window.clearTimeout(timer);
  }, [aiNotice]);
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
        <label className="model-control" title={`Select ${provider} model`}><span>{provider}</span><select aria-label="AI model" disabled={!status.available} value={model} onChange={e => setModel(e.target.value)}>{status.models.map(option => <option key={option.id} value={option.id}>{option.id}</option>)}</select></label>
        <div className="usage-meter" title={usage.remainingPercent === null ? `${provider} allowance is unavailable` : `${usage.remainingPercent}% remains in the most used allowance window${usage.windowDurationMins ? ` (${usage.windowDurationMins} minutes)` : ""}${usage.lifetimeTokens === null ? "" : ` · ${usage.lifetimeTokens.toLocaleString()} lifetime tokens`}`} aria-label={usage.remainingPercent === null ? `${provider} usage unavailable` : `${usage.remainingPercent}% usage remaining`}>
          <span>Usage remaining</span><div className="usage-track"><div style={{ width: `${usage.remainingPercent ?? 0}%` }} /></div><strong>{usage.remainingPercent === null ? "—" : `${usage.remainingPercent}%`}</strong>
        </div>
        <button type="button" aria-label={theme === "dark" ? "Use light mode" : "Use dark mode"} title={theme === "dark" ? "Light mode" : "Dark mode"} onClick={toggleTheme}>{theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}</button>
      </nav>
    </div></header>
    {children}{aiNotice && <div className="ai-notice" role="status">No AI sidecar is available. Start the Codex or Claude Docker profile and sign in; see README for setup.</div>}<UndoToast />
  </div>;
}

export function LoadingCard() { return <div className="loading-card"><span className="spinner" />Loading your learning space…</div>; }
