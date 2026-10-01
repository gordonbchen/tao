"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import Image from "next/image";
import { KeyRound, Menu, Moon, Sun, X } from "lucide-react";
import { loadMathJax } from "./math-text";
import { Button, ErrorMessage, IconButton, Input, List, ListItem, Modal, Select, Spinner } from "./ui";

// Unsent text (a chat message or a problem answer) kept in this browser as it is typed, so closing the page
// does not lose it. Clearing the text removes the draft.
const draftKey = (key: string) => `tao-draft:${key}`;
export function readDraft(key: string | undefined) {
  if (!key) return "";
  try { return localStorage.getItem(draftKey(key)) ?? ""; } catch { return ""; }
}
export function saveDraft(key: string | undefined, text: string) {
  if (!key) return;
  try { if (text.trim()) localStorage.setItem(draftKey(key), text); else localStorage.removeItem(draftKey(key)); } catch { /* Keep it for this visit only. */ }
}

export type Subject = { id: string; name: string; topicCount: number; dueCount: number };

type AIProviderStatus = { id: string; label: string; running: boolean; signedIn: boolean; accounts: string[] };
type AIStatus = { available: boolean; providers: AIProviderStatus[]; models: { id: string; provider: string }[]; defaultModel: string };
// OpenCode signs in to one of many providers; one without a device or pasted code takes an API key.
type SignIn = { provider: string; url: string; code?: string; needsCode?: boolean; needsKey?: boolean };
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

// An AI request the student can stop: aborting `init.signal` also stops the model on the server. Sends the selected model.
export async function aiApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const id = requestId();
  const cancel = () => void fetch(`/api/ai/requests/${id}`, { method: "DELETE" }).catch(() => undefined);
  init.signal?.addEventListener("abort", cancel, { once: true });
  const headers = new Headers(init.headers);
  headers.set("X-Tao-AI-Model", requestModel);
  headers.set("X-Tao-Request-Id", id);
  try { return await api<T>(path, { ...init, headers }); }
  finally { init.signal?.removeEventListener("abort", cancel); }
}

// An AI request, like `aiApi`, whose reply is one JSON object per line; `onLine` gets each one as it arrives.
export async function aiStream<T>(path: string, init: RequestInit, onLine: (value: T) => void) {
  const id = requestId();
  const cancel = () => void fetch(`/api/ai/requests/${id}`, { method: "DELETE" }).catch(() => undefined);
  init.signal?.addEventListener("abort", cancel, { once: true });
  const headers = new Headers(init.headers);
  headers.set("X-Tao-AI-Model", requestModel);
  headers.set("X-Tao-Request-Id", id);
  try {
    const response = await fetch(path, { ...init, headers });
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error ?? "Something went wrong. Please try again.");
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let rest = "";
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      const lines = (rest + chunk.value).split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) onLine(JSON.parse(line) as T);
    }
    if (rest.trim()) onLine(JSON.parse(rest) as T);
  } finally { init.signal?.removeEventListener("abort", cancel); }
}

// Whether a request failed because the student stopped it.
export function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

// A version 4 UUID. crypto.randomUUID needs a secure context, which a LAN address over HTTP is not.
function requestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type UndoState = { message: string; undo: () => void; commit: () => Promise<void>; restore: () => void };
let pendingUndo: { ids: string[]; state: UndoState; timer: ReturnType<typeof setTimeout> } | null = null;
const undoListeners = new Set<(state: UndoState | null) => void>();
const pendingRemovalIds = new Set<string>();

export function isPendingRemoval(id: string) { return pendingRemovalIds.has(id); }
export function pendingRemovals() { return [...pendingRemovalIds]; }

function publishUndo(state: UndoState | null) { undoListeners.forEach((listener) => listener(state)); }

// Removes `id` (or several, deleted together) after the undo toast's 10 seconds.
export function scheduleUndoDelete(id: string | string[], state: Omit<UndoState, "undo">) {
  const ids = [id].flat();
  const forget = (list: string[]) => list.forEach((each) => pendingRemovalIds.delete(each));
  if (pendingUndo) {
    clearTimeout(pendingUndo.timer);
    const previous = pendingUndo.state;
    const previousIds = pendingUndo.ids;
    pendingUndo = null;
    publishUndo(null);
    forget(previousIds);
    void previous.commit().then(() => window.dispatchEvent(new Event("tao:refresh"))).catch(() => {
      previous.restore();
      window.dispatchEvent(new CustomEvent("tao:error", { detail: "Could not remove item." }));
    });
  }
  const entry = { ...state, undo: () => {
    if (!pendingUndo || pendingUndo.state !== entry) return;
    clearTimeout(pendingUndo.timer);
    pendingUndo = null;
    forget(ids);
    publishUndo(null);
    entry.restore();
    window.dispatchEvent(new Event("tao:refresh"));
  } };
  const timer = setTimeout(async () => {
    if (pendingUndo?.state !== entry) return;
    pendingUndo = null;
    forget(ids);
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
  ids.forEach((each) => pendingRemovalIds.add(each));
  pendingUndo = { ids, state: entry, timer };
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
  return <div role="status" className="fixed bottom-12 left-1/2 z-30 flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-4 rounded-lg border border-line bg-surface py-2 pr-2 pl-4 text-sm shadow-float">
    <span className="min-w-0 truncate">{state.message}</span><Button size="sm" onClick={state.undo}>Undo</Button>
  </div>;
}

const noStatus: AIStatus = { available: false, providers: [], models: [], defaultModel: "" };

export function AppShell({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState("light");
  // Null until the first status check, so the header does not show Connect AI and then swap it for the model picker.
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [model, setModelState] = useState("gpt-6-luna");
  const [usage, setUsage] = useState<AIUsage>(emptyUsage);
  const [accountsOpen, setAccountsOpen] = useState(false);
  // The site controls fold into a menu on narrow screens.
  const [menuOpen, setMenuOpen] = useState(false);
  const loadStatus = useCallback(async () => {
    try {
      const data = await fetch("/api/ai/status").then(r => r.json()) as AIStatus;
      setStatus(data);
      const storedModel = localStorage.getItem("tao-ai-model");
      const nextModel = storedModel && data.models.some(option => option.id === storedModel) ? storedModel : data.defaultModel;
      setModelState(nextModel);
      requestModel = nextModel;
      updateAISettings({ model: nextModel, configured: data.available, ready: true });
      window.dispatchEvent(new Event("tao:ai-model-changed"));
      return data;
    } catch {
      setStatus(noStatus);
      updateAISettings({ configured: false, ready: true });
    }
  }, []);
  useEffect(() => {
    const refreshUsage = () => {
      void fetch(`/api/ai/usage?model=${encodeURIComponent(requestModel)}`).then(r => r.json()).then((result: AIUsage) => {
        setUsage(result);
        updateAISettings({ usage: result });
      }).catch(() => undefined);
    };
    // Load MathJax now so math is ready to typeset before it is first shown.
    loadMathJax().catch(() => undefined);
    // The layout's script already applied the stored theme; match the toggle to it.
    if (document.documentElement.dataset.theme === "dark") setTheme("dark");
    void loadStatus();
    const onSetupRequired = () => setAccountsOpen(true);
    window.addEventListener("tao:ai-setup-required", onSetupRequired);
    window.addEventListener("tao:ai-model-changed", refreshUsage);
    const usageTimer = window.setInterval(refreshUsage, 60_000);
    return () => { window.removeEventListener("tao:ai-setup-required", onSetupRequired); window.removeEventListener("tao:ai-model-changed", refreshUsage); window.clearInterval(usageTimer); };
  }, [loadStatus]);
  function setModel(next: string) { updateModel(next); setModelState(next); window.dispatchEvent(new Event("tao:ai-model-changed")); }
  const provider = status?.models.find(option => option.id === model)?.provider ?? "AI";
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("tao-theme", next);
  }
  const usageLabel = usage.remainingPercent === null ? `${provider} allowance is unavailable` : `${usage.remainingPercent}% remains in the most used allowance window${usage.windowDurationMins ? ` (${usage.windowDurationMins} minutes)` : ""}${usage.lifetimeTokens === null ? "" : ` · ${usage.lifetimeTokens.toLocaleString()} lifetime tokens`}`;
  const modelSelect = (className: string) => <Select className={className} aria-label="AI model" title={`Select ${provider} model`} value={model} onChange={e => setModel(e.target.value)}>{status?.models.map(option => <option key={option.id} value={option.id}>{option.provider} · {option.id}</option>)}</Select>;
  const usageBar = <div className="flex min-w-0 items-center gap-2 text-xs text-muted" title={usageLabel} aria-label={usage.remainingPercent === null ? `${provider} usage unavailable` : `${usage.remainingPercent}% usage remaining`}>
    <span className="max-md:hidden max-sm:inline">Usage remaining</span>
    <div className="h-2 w-20 min-w-8 flex-shrink overflow-hidden rounded-full bg-line-strong max-sm:flex-1"><div className="h-full bg-accent" style={{ width: `${usage.remainingPercent ?? 0}%` }} /></div>
    {/* Wide enough for 100%, so the bar does not move when usage arrives. */}
    <strong className="w-10 flex-none text-right font-semibold text-ink">{usage.remainingPercent === null ? "—" : `${usage.remainingPercent}%`}</strong>
  </div>;
  const themeLabel = theme === "dark" ? "Use light mode" : "Use dark mode";
  const ThemeIcon = theme === "dark" ? Sun : Moon;
  return <div className="min-h-dvh">
    <header className="border-b border-line bg-paper"><div className="flex h-16 w-full items-center justify-between gap-4 px-6 max-sm:px-4">
      <Link className="inline-flex flex-none items-center gap-2 text-lg font-semibold" href="/"><Image className="dark:invert" src="/icon.svg" alt="" width={30} height={30} />Tao</Link>
      <nav className="flex min-w-0 items-center gap-2 max-sm:hidden" aria-label="Site controls">
        {status?.available ? <>
          {modelSelect("min-w-0 max-w-64")}
          <div className="px-2">{usageBar}</div>
          <IconButton label="AI accounts" onClick={() => setAccountsOpen(true)}><KeyRound size={20} /></IconButton>
        </> : status && <Button onClick={() => setAccountsOpen(true)}><KeyRound size={18} />Connect AI</Button>}
        <IconButton label={themeLabel} onClick={toggleTheme}><ThemeIcon size={20} /></IconButton>
      </nav>
      <IconButton className="sm:hidden" label={menuOpen ? "Close menu" : "Menu"} aria-expanded={menuOpen} aria-controls="site-menu" onClick={() => setMenuOpen(open => !open)}>{menuOpen ? <X size={20} /> : <Menu size={20} />}</IconButton>
    </div>
    {menuOpen && <nav id="site-menu" className="flex flex-col gap-3 border-t border-line px-4 py-4 sm:hidden" aria-label="Site controls">
      {status?.available && <>{modelSelect("w-full")}{usageBar}</>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => { setMenuOpen(false); setAccountsOpen(true); }}><KeyRound size={18} />{status?.available ? "AI accounts" : "Connect AI"}</Button>
        <Button onClick={toggleTheme}><ThemeIcon size={18} />{themeLabel}</Button>
      </div>
    </nav>}
    </header>
    {children}{accountsOpen && <AIAccounts providers={status?.providers ?? []} refresh={loadStatus} close={() => setAccountsOpen(false)} />}<UndoToast />
  </div>;
}

function AIAccounts({ providers, refresh, close }: { providers: AIProviderStatus[]; refresh: () => Promise<AIStatus | undefined>; close: () => void }) {
  const [signIn, setSignIn] = useState<SignIn | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [account, setAccount] = useState("opencode-go");
  const openCodeRunning = providers.some(provider => provider.id === "opencode" && provider.running);
  useEffect(() => {
    if (openCodeRunning) void api<{ id: string; name: string }[]>("/api/ai/auth").then(setAccounts).catch(() => undefined);
  }, [openCodeRunning]);
  // Device-code logins finish in the sidecar once the student approves in the browser.
  useEffect(() => {
    if (!signIn || signIn.needsCode || signIn.needsKey) return;
    const timer = window.setInterval(() => {
      void refresh().then(data => { if (data?.providers.find(p => p.id === signIn.provider)?.signedIn) setSignIn(null); });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [signIn, refresh]);
  async function act(provider: string, action: "start" | "code" | "logout") {
    setBusy(provider); setError("");
    try {
      const result = await api<SignIn & { signedIn?: boolean }>("/api/ai/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, action, code, account }) });
      if (action === "start") { setSignIn({ ...result, provider }); setCode(""); }
      else { setSignIn(null); await refresh(); }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign-in failed");
    } finally { setBusy(""); }
  }
  const link = (label: string, url: string) => <a className="text-accent underline" href={url} target="_blank" rel="noreferrer">Open the {label} sign-in page</a>;
  return <Modal title="AI accounts" onClose={close}>
    <p className="mb-4 text-sm text-muted">Tao uses your own Codex, Claude, or OpenCode subscription. OpenCode signs in to one of many providers, such as OpenCode Go, GitHub Copilot, or an API key. Requests go to the provider&apos;s hosted models and count toward your plan&apos;s limits.</p>
    <List>{providers.map(provider => <ListItem key={provider.id} className="flex-wrap">
      <div className="flex min-w-0 flex-1 flex-col"><strong className="font-semibold">{provider.label}</strong><span className="text-sm text-muted">{!provider.running ? "Sidecar not running" : provider.signedIn ? ["Signed in", provider.accounts.join(", ")].filter(Boolean).join(": ") : "Not signed in"}</span></div>
      {provider.running && !provider.signedIn && provider.id === "opencode" && <Select className="min-w-0 max-w-56 max-sm:order-last max-sm:w-full max-sm:max-w-none" aria-label="OpenCode provider" value={account} onChange={e => { setAccount(e.target.value); if (signIn?.provider === "opencode") setSignIn(null); }}>
        {accounts.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
      </Select>}
      {provider.running && (provider.signedIn
        ? <Button disabled={busy === provider.id} onClick={() => void act(provider.id, "logout")}>Sign out</Button>
        : <Button variant="primary" disabled={busy === provider.id} onClick={() => void act(provider.id, "start")}>{signIn?.provider === provider.id ? "Restart" : "Sign in"}</Button>)}
      {signIn?.provider === provider.id && <div className="w-full pb-2 text-sm leading-relaxed">
        {signIn.needsKey
          ? <form className="flex gap-2" onSubmit={e => { e.preventDefault(); void act(provider.id, "code"); }}><Input className="flex-1" type="password" aria-label={`${accounts.find(option => option.id === account)?.name ?? provider.label} API key`} placeholder="API key" value={code} onChange={e => setCode(e.target.value)} autoFocus /><Button type="submit" variant="primary" disabled={!code.trim() || busy === provider.id}>{busy === provider.id ? "Saving…" : "Save"}</Button></form>
          : signIn.needsCode
          ? <><p>1. {link(provider.label, signIn.url)} and approve access.<br />2. Paste the code it shows:</p>
            <form className="mt-2 flex gap-2" onSubmit={e => { e.preventDefault(); void act(provider.id, "code"); }}><Input className="flex-1" aria-label={`${provider.label} sign-in code`} value={code} onChange={e => setCode(e.target.value)} autoFocus /><Button type="submit" variant="primary" disabled={!code.trim() || busy === provider.id}>{busy === provider.id ? "Checking…" : "Finish"}</Button></form></>
          : <p>1. {link(provider.label, signIn.url)}.<br />2. Enter this code: <code className="rounded-md bg-subtle px-2 py-1 font-mono">{signIn.code}</code><br /><span className="mt-2 inline-flex items-center gap-2 text-muted"><Spinner />Waiting for approval…</span></p>}
      </div>}
    </ListItem>)}</List>
    {!providers.some(provider => provider.running) && <p className="mt-4 text-sm text-muted">No AI sidecar is running. Start Tao with Docker Compose; see the README.</p>}
    {error && <ErrorMessage>{error}</ErrorMessage>}
  </Modal>;
}

export function LoadingCard() { return <div className="flex items-center gap-3 py-6 text-sm text-muted"><Spinner />Loading your learning space…</div>; }
