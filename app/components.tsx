"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import Image from "next/image";
import { CircleHelp, Moon, Settings, Sun } from "lucide-react";

export type Subject = { id: string; name: string; topicCount: number; dueCount: number };

type Provider = "codex" | "ollama" | "openai";
type ProviderStatus = { id: Provider; label: string; available: boolean; models: string[] };
type AIStatus = { providers: ProviderStatus[]; usage: { label: string; percentRemaining?: number } };
type AISettingsValue = { provider: Provider; model: string; apiKey: string; configured: boolean; ready: boolean; providers: ProviderStatus[]; usage: AIStatus["usage"] };
let aiSettingsSnapshot: AISettingsValue = { provider: "codex", model: "gpt-6-luna", apiKey: "", configured: false, ready: false, providers: [], usage: { label: "Usage unavailable" } };
const aiSettingsListeners = new Set<() => void>();
function updateAISettings(patch: Partial<AISettingsValue>) { aiSettingsSnapshot = { ...aiSettingsSnapshot, ...patch }; aiSettingsListeners.forEach(listener => listener()); }
const subscribeAISettings = (listener: () => void) => { aiSettingsListeners.add(listener); return () => { aiSettingsListeners.delete(listener); }; };
const getAISettingsSnapshot = () => aiSettingsSnapshot;
let requestProvider: Provider = "codex";
let requestModel = "gpt-6-luna";
let requestApiKey = "";
export function getAiRequestHeaders(): HeadersInit {
  return { "X-Tao-AI-Provider": requestProvider, "X-Tao-AI-Model": requestModel, ...(requestApiKey ? { "X-OpenAI-API-Key": requestApiKey } : {}) };
}
export function notifyAiSetupRequired() { window.dispatchEvent(new Event("tao:ai-setup-required")); }
export function useAISettings() {
  const snapshot = useSyncExternalStore(subscribeAISettings, getAISettingsSnapshot, getAISettingsSnapshot);
  return { ...snapshot, setProvider: updateProvider, setModel: updateModel, setApiKey: updateApiKey, requestHeaders: getAiRequestHeaders() };
}
export function getAiSettingsSnapshot() { return { ready: aiSettingsSnapshot.ready, configured: aiSettingsSnapshot.configured }; }
function updateProvider(provider: Provider) { requestProvider = provider; localStorage.setItem("tao-ai-provider", provider); const model = aiSettingsSnapshot.providers.find(item => item.id === provider)?.models[0] || ""; requestModel = model; localStorage.setItem("tao-ai-model", model); updateAISettings({ provider, model, configured: providerReady(provider, model, requestApiKey) }); }
function updateModel(model: string) { requestModel = model; localStorage.setItem("tao-ai-model", model); updateAISettings({ model, configured: providerReady(aiSettingsSnapshot.provider, model, requestApiKey) }); }
function updateApiKey(key: string) { requestApiKey = key; updateAISettings({ apiKey: key, configured: providerReady(aiSettingsSnapshot.provider, aiSettingsSnapshot.model, key) }); }
function providerReady(provider: Provider, _model: string, key: string) { const option = aiSettingsSnapshot.providers.find(item => item.id === provider); return Boolean(option?.available && (provider !== "openai" || key.trim())); }

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
  const [panel, setPanel] = useState<"help" | "settings" | null>(null);
  const [status, setStatus] = useState<AIStatus>({ providers: [], usage: { label: "Usage unavailable" } });
  const [provider, setProviderState] = useState<Provider>("codex");
  const [model, setModelState] = useState("gpt-6-luna");
  const [apiKey, setApiKeyState] = useState(requestApiKey);
  const [aiNotice, setAiNotice] = useState(false);
  useEffect(() => {
    const refreshUsage = () => {
      void fetch("/api/ai/usage").then(r => r.json()).then((usage: AIStatus["usage"]) => {
        setStatus(current => ({ ...current, usage }));
        aiSettingsSnapshot = { ...aiSettingsSnapshot, usage };
        aiSettingsListeners.forEach(listener => listener());
      }).catch(() => undefined);
    };
    const saved = localStorage.getItem("tao-theme");
    if (saved === "dark") { setTheme("dark"); document.documentElement.dataset.theme = "dark"; }
    void fetch("/api/ai/status").then(r => r.json()).then((data: AIStatus & { defaultProvider: Provider; defaultModel: string }) => {
      setStatus(data);
      const storedProvider = localStorage.getItem("tao-ai-provider") as Provider | null;
      const nextProvider = storedProvider && data.providers.some(item => item.id === storedProvider) ? storedProvider : data.defaultProvider;
      const storedModel = localStorage.getItem("tao-ai-model");
      const currentProviderStatus = data.providers.find(item => item.id === nextProvider);
      const nextModel = currentProviderStatus?.models.includes(storedModel || "") ? storedModel! : (nextProvider === data.defaultProvider ? data.defaultModel : currentProviderStatus?.models[0]) || "";
      setProviderState(nextProvider);
      setModelState(nextModel);
      requestProvider = nextProvider; requestModel = nextModel;
      const key = requestApiKey;
      aiSettingsSnapshot = { provider: nextProvider, model: nextModel, apiKey: key, configured: Boolean(currentProviderStatus?.available && (nextProvider !== "openai" || key.trim())), ready: true, providers: data.providers, usage: data.usage };
      aiSettingsListeners.forEach(listener => listener());
      refreshUsage();
    }).catch(() => {
      const providers: ProviderStatus[] = [{ id: "openai", label: "OpenAI API", available: true, models: ["gpt-4o-mini"] }];
      requestProvider = "openai"; requestModel = "gpt-4o-mini";
      aiSettingsSnapshot = { provider: "openai", model: "gpt-4o-mini", apiKey: requestApiKey, configured: false, ready: true, providers, usage: { label: "Usage unavailable" } };
      aiSettingsListeners.forEach(listener => listener());
      setProviderState("openai"); setModelState("gpt-4o-mini");
    });
    const onSetupRequired = () => { setPanel("settings"); setAiNotice(true); };
    window.addEventListener("tao:ai-setup-required", onSetupRequired);
    const usageTimer = window.setInterval(refreshUsage, 60_000);
    return () => { window.removeEventListener("tao:ai-setup-required", onSetupRequired); window.clearInterval(usageTimer); };
  }, []);
  function setProvider(next: Provider) { updateProvider(next); setProviderState(next); setModelState(aiSettingsSnapshot.model); }
  function setModel(next: string) { updateModel(next); setModelState(next); }
  function setApiKey(next: string) { updateApiKey(next); setApiKeyState(next); }
  const selected = status.providers.find(item => item.id === provider);
  const configured = Boolean(selected?.available && (provider !== "openai" || !!apiKey.trim()));
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
        <label className="model-control" title="Select AI model"><span>{selected?.label || "No model"}</span><select aria-label="AI model" disabled={!selected?.models.length} value={model} onChange={e => setModel(e.target.value)}>{selected?.models.map(option => <option key={option} value={option}>{option}</option>)}</select></label>
        <span className="usage-indicator" title={provider === "codex" ? status.usage.label : "Provider usage unavailable"}>{provider === "codex" ? status.usage.label : "Usage unavailable"}</span>
        <button type="button" aria-label="Help" title="Help" aria-expanded={panel === "help"} onClick={() => setPanel(panel === "help" ? null : "help")}><CircleHelp size={20} /></button>
      <button type="button" aria-label="Settings" title="Settings" aria-expanded={panel === "settings"} onClick={() => setPanel(panel === "settings" ? null : "settings")}><Settings size={20} /></button>
        <button type="button" aria-label={theme === "dark" ? "Use light mode" : "Use dark mode"} title={theme === "dark" ? "Light mode" : "Dark mode"} onClick={toggleTheme}>{theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}</button>
      </nav>
      {panel && <div className="header-popover" role="region" aria-label={panel === "help" ? "Help" : "Settings"}>
        {panel === "help" ? <><strong>How to use Tao</strong><p>Add topics and course resources to a subject, then choose Practice. Ask for a hint as you work; Shift+Enter sends a chat message.</p></> : <><strong>AI settings</strong>
          <label className="setting-field">Provider<select value={provider} onChange={e => setProvider(e.target.value as Provider)}>{status.providers.map(item => <option key={item.id} value={item.id} disabled={!item.available}>{item.label}{item.available ? "" : " (not configured)"}</option>)}</select></label>
          {provider === "openai" && <label className="setting-field">OpenAI API key<input type="password" autoComplete="off" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-…"/><small>Held in memory for this browser tab; it is not saved.</small></label>}
          {!configured && <p className="settings-error">{aiNotice ? "Choose a configured provider to continue." : "Choose a configured AI provider to practice."}</p>}
          {provider === "codex" && <p>Codex uses your local CLI login and a hosted model. Usage limits depend on your account.</p>}
        </>}
      </div>}
    </div></header>
    {children}<UndoToast />
  </div>;
}

export function LoadingCard() { return <div className="loading-card"><span className="spinner" />Loading your learning space…</div>; }
