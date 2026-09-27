"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { api, AppShell, LoadingCard, scheduleUndoDelete, Subject } from "./components";

export default function DashboardPage() {
  const router = useRouter();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "Tao - Home";
    api<Subject[]>("/api/subjects").then(setSubjects).catch((e) => setError(e.message)).finally(() => setLoading(false));
    if (new URLSearchParams(window.location.search).get("new") === "subject") setShowCreate(true);
  }, []);

  async function createSubject(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await api<{ id: string } | { subject: { id: string } }>("/api/subjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const created = "subject" in result ? result.subject : result;
      router.push(`/subjects/${created.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create subject");
      setSaving(false);
    }
  }

  function removeSubject(subject: Subject) {
    setSubjects(current => current.filter(item => item.id !== subject.id));
    scheduleUndoDelete(subject.id, {
      message: `Removed ${subject.name}`,
      restore: () => setSubjects(current => current.some(item => item.id === subject.id) ? current : [...current, subject]),
      commit: () => api(`/api/subjects/${subject.id}`, { method: "DELETE" }).then(() => {}),
    });
  }

  return <AppShell><main className="content home-content">
    <div className="home-heading"><h1>Subjects</h1><button className="button button-primary" onClick={() => setShowCreate(true)}><Plus size={19} />New subject</button></div>
    {error && !showCreate && <div className="error-message">{error}</div>}
    {loading ? <LoadingCard /> : <div className="subjects-list">{subjects.map((subject) => <div className="subject-row" key={subject.id}><Link className="subject-link" href={`/subjects/${subject.id}`}>{subject.name}</Link><button className="subject-remove" type="button" aria-label={`Remove ${subject.name}`} title={`Remove ${subject.name}`} onClick={() => removeSubject(subject)}><Trash2 size={19} /></button></div>)}</div>}
    {!loading && subjects.length === 0 && !error && <p className="quiet-empty">No subjects yet.</p>}

    {showCreate && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowCreate(false); }}><form className="modal" onSubmit={createSubject}>
      <div className="modal-head"><h2>New subject</h2><button type="button" className="modal-close" aria-label="Close" onClick={() => setShowCreate(false)}><X size={19} /></button></div>
      <div className="field"><label htmlFor="subject-name">Name</label><input id="subject-name" autoFocus required maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="Real Analysis" /></div>
      {error && <div className="error-message">{error}</div>}<div className="modal-actions"><button type="button" className="button" onClick={() => setShowCreate(false)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Creating…" : "Create"}</button></div>
    </form></div>}
  </main></AppShell>;
}
