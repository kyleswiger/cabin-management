import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { useAuth } from "../App";
import type { Project } from "../types";

const EMPTY = { title: "", description: "", priority: "medium", estimatedCost: "" };

export default function ProjectsPage() {
  const { isAdmin } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [contrib, setContrib] = useState({ amount: "", note: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.get<Project[]>("/projects").then(setProjects).catch((e) => setError((e as Error).message)), []);
  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = async (p: Project, status: string) => {
    try {
      await api.put(`/projects/${p.id}`, { status });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const addProject = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/projects", { ...form, estimatedCost: form.estimatedCost === "" ? null : Number(form.estimatedCost) });
      setForm(EMPTY);
      setShowAdd(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addContribution = async (e: FormEvent, p: Project) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/projects/${p.id}/contributions`, { amount: Number(contrib.amount), note: contrib.note });
      setContrib({ amount: "", note: "" });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: Project) => {
    if (!window.confirm(`Delete "${p.title}" and its ledger?`)) return;
    try {
      await api.del(`/projects/${p.id}`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Maintenance &amp; projects</h1>
        <button className="btn" onClick={() => setShowAdd(!showAdd)}>+ Add project</button>
      </div>
      {error && <div className="error">{error}</div>}

      {showAdd && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <h2>New project</h2>
          <form onSubmit={addProject}>
            <div className="field">
              <label>Title</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            </div>
            <div className="field">
              <label>Description</label>
              <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="row">
              <div className="field">
                <label>Priority</label>
                <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div className="field">
                <label>Estimated cost ($, optional)</label>
                <input type="number" min="0" value={form.estimatedCost} onChange={(e) => setForm({ ...form, estimatedCost: e.target.value })} />
              </div>
            </div>
            <button className="btn" disabled={busy}>Add to backlog</button>
          </form>
        </div>
      )}

      <div className="cards">
        {projects.map((p) => (
          <div className="card" key={p.id}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
              <h2 style={{ marginBottom: "0.3rem" }}>{p.title}</h2>
              <span className={`chip ${p.priority === "low" ? "low-priority" : p.priority}`}>{p.priority}</span>
            </div>
            {p.description && <p className="muted" style={{ marginTop: 0 }}>{p.description}</p>}
            <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
              <select value={p.status} onChange={(e) => void setStatus(p, e.target.value)} style={{ width: "auto" }}>
                <option value="not_started">Not started</option>
                <option value="in_progress">In progress</option>
                <option value="done">Done</option>
              </select>
              {isAdmin && <button className="btn danger small" onClick={() => void remove(p)}>Delete</button>}
            </div>
            <div style={{ marginTop: "0.75rem" }}>
              <strong>${p.contributedTotal.toFixed(0)}</strong>
              <span className="muted"> chipped in{p.estimatedCost ? ` of ~$${p.estimatedCost.toFixed(0)}` : ""}</span>
              {p.estimatedCost ? (
                <div className="progress">
                  <div style={{ width: `${Math.min(100, (p.contributedTotal / p.estimatedCost) * 100)}%` }} />
                </div>
              ) : null}
            </div>
            <button className="linkbtn" onClick={() => setExpanded(expanded === p.id ? null : p.id)}>
              {expanded === p.id ? "Hide ledger" : `Ledger (${p.contributions.length}) & chip in`}
            </button>
            {expanded === p.id && (
              <div style={{ marginTop: "0.6rem" }}>
                {p.contributions.length === 0 && <p className="muted">No contributions yet.</p>}
                {p.contributions.map((c) => (
                  <div className="item-row" key={c.id}>
                    <div className="grow">
                      <strong>${c.amount.toFixed(2)}</strong> · {c.userName} · {c.date}
                      {c.note && <span className="muted"> — {c.note}</span>}
                    </div>
                  </div>
                ))}
                <form onSubmit={(e) => void addContribution(e, p)} style={{ display: "flex", gap: "0.5rem", marginTop: "0.6rem" }}>
                  <input type="number" min="1" step="0.01" placeholder="$" value={contrib.amount} onChange={(e) => setContrib({ ...contrib, amount: e.target.value })} required style={{ maxWidth: 100 }} />
                  <input placeholder="note (optional)" value={contrib.note} onChange={(e) => setContrib({ ...contrib, note: e.target.value })} />
                  <button className="btn small" disabled={busy}>Chip in</button>
                </form>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
