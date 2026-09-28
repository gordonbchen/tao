"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api, AppShell, LoadingCard, scheduleUndoDelete, Subject } from "./components";
import { Button, ErrorMessage, IconButton, Input, List, ListItem, Modal, Page } from "./ui";

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

  return <AppShell><Page>
    <div className="mb-8 flex items-center justify-between gap-4"><h1 className="text-display font-semibold">Subjects</h1><Button variant="primary" onClick={() => setShowCreate(true)}><Plus size={19} />New subject</Button></div>
    {error && !showCreate && <ErrorMessage>{error}</ErrorMessage>}
    {loading ? <LoadingCard /> : subjects.length > 0 && <List>{subjects.map((subject) => <ListItem key={subject.id}>
      <Link className="min-w-0 flex-1 truncate text-lg hover:text-accent" href={`/subjects/${subject.id}`}>{subject.name}</Link>
      <IconButton label={`Remove ${subject.name}`} tone="danger" onClick={() => removeSubject(subject)}><Trash2 size={19} /></IconButton>
    </ListItem>)}</List>}
    {!loading && subjects.length === 0 && !error && <p className="text-muted">No subjects yet.</p>}

    {showCreate && <Modal title="New subject" onClose={() => setShowCreate(false)}><form onSubmit={createSubject}>
      <label className="mb-2 block text-sm font-semibold" htmlFor="subject-name">Name</label>
      <Input className="w-full" id="subject-name" autoFocus required maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="Real Analysis" />
      {error && <ErrorMessage>{error}</ErrorMessage>}
      <div className="mt-6 flex justify-end gap-2"><Button onClick={() => setShowCreate(false)}>Cancel</Button><Button type="submit" variant="primary" disabled={saving}>{saving ? "Creating…" : "Create"}</Button></div>
    </form></Modal>}
  </Page></AppShell>;
}
