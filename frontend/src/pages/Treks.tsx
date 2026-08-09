import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { useAuth } from "../App";
import { branding } from "../branding";
import type { Trek } from "../types";

// Local Treks & Area Guide (PRD 5.11): a living directory like the supply
// checklist — anyone can add or edit entries; delete is creator-or-admin.

const CATEGORIES: Array<{ key: Trek["category"]; label: string; empty: string }> = [
  { key: "hike", label: "Hike & paddle", empty: "No trails or paddles yet — add a favorite so nobody re-researches it." },
  { key: "food", label: "Food & drink", empty: "No spots yet — where do you stop for a bite?" },
  { key: "attraction", label: "Attractions", empty: "Nothing listed yet — know a place worth the drive?" },
  { key: "essentials", label: "Essentials", empty: "Nothing yet — where's the nearest grocery, hardware, or urgent care?" },
];

interface TrekForm {
  name: string;
  category: Trek["category"];
  description: string;
  driveMinutes: string;
  link: string;
}

const EMPTY: TrekForm = { name: "", category: "hike", description: "", driveMinutes: "", link: "" };

function toPayload(form: TrekForm) {
  return {
    name: form.name.trim(),
    category: form.category,
    description: form.description.trim(),
    driveMinutes: form.driveMinutes === "" ? null : Number(form.driveMinutes),
    link: form.link.trim() === "" ? null : form.link.trim(),
  };
}

function TrekFields({ form, setForm }: { form: TrekForm; setForm: (f: TrekForm) => void }) {
  return (
    <>
      <div className="row">
        <div className="field">
          <label>Name</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div className="field">
          <label>Category</label>
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as Trek["category"] })}>
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Description &amp; tips</label>
        <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
      </div>
      <div className="row">
        <div className="field">
          <label>Drive time (minutes, optional)</label>
          <input type="number" min="1" value={form.driveMinutes} onChange={(e) => setForm({ ...form, driveMinutes: e.target.value })} />
        </div>
        <div className="field">
          <label>Link (Google Maps / AllTrails, optional)</label>
          <input type="url" placeholder="https://…" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} />
        </div>
      </div>
    </>
  );
}

export default function TreksPage() {
  const { me, isAdmin } = useAuth();
  const [treks, setTreks] = useState<Trek[]>([]);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.get<Trek[]>("/treks").then(setTreks).catch((e) => setError((e as Error).message)), []);
  useEffect(() => {
    void load();
  }, [load]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/treks", toPayload(addForm));
      setAddForm(EMPTY);
      setShowAdd(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (t: Trek) => {
    setEditingId(t.id);
    setEditForm({
      name: t.name,
      category: t.category,
      description: t.description,
      driveMinutes: t.driveMinutes != null ? String(t.driveMinutes) : "",
      link: t.link ?? "",
    });
  };

  const saveEdit = async (e: FormEvent, t: Trek) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.put(`/treks/${t.id}`, toPayload(editForm));
      setEditingId(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (t: Trek) => {
    if (!window.confirm(`Remove "${t.name}" from the guide?`)) return;
    try {
      await api.del(`/treks/${t.id}`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Area guide</h1>
        <button className="btn" onClick={() => setShowAdd(!showAdd)}>+ Add a spot</button>
      </div>
      <p className="muted">
        What's around the {branding.propertyNoun} — trails, food, and where to get things. Found somewhere good? Add it so
        nobody re-researches the same trip.
      </p>
      {error && <div className="error">{error}</div>}

      {showAdd && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <h2>New entry</h2>
          <form onSubmit={add}>
            <TrekFields form={addForm} setForm={setAddForm} />
            <button className="btn" disabled={busy}>Add to guide</button>
          </form>
        </div>
      )}

      {CATEGORIES.map(({ key, label, empty }) => {
        const entries = treks.filter((t) => t.category === key);
        return (
          <div className="card" key={key} style={{ marginBottom: "1rem" }}>
            <h2>{label}</h2>
            {entries.length === 0 && <p className="muted">{empty}</p>}
            {entries.map((t) =>
              editingId === t.id ? (
                <form key={t.id} onSubmit={(e) => void saveEdit(e, t)} style={{ padding: "0.55rem 0" }}>
                  <TrekFields form={editForm} setForm={setEditForm} />
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button className="btn small" disabled={busy}>Save</button>
                    <button type="button" className="btn small secondary" onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                </form>
              ) : (
                <div className="item-row" key={t.id}>
                  <div className="grow">
                    <strong>{t.name}</strong>
                    {t.driveMinutes != null && <span className="muted"> · ~{t.driveMinutes} min</span>}
                    {t.link && (
                      <>
                        {" "}
                        <a href={t.link} target="_blank" rel="noopener noreferrer">map / info ↗</a>
                      </>
                    )}
                    <div className="muted">{t.description}</div>
                  </div>
                  <button className="btn small secondary" onClick={() => startEdit(t)}>Edit</button>
                  {(isAdmin || t.addedBy === me.id) && (
                    <button className="btn danger small" onClick={() => void remove(t)}>✕</button>
                  )}
                </div>
              )
            )}
          </div>
        );
      })}
    </>
  );
}
