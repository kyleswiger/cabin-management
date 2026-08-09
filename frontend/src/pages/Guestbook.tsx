import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { useAuth } from "../App";
import type { GuestbookEntry, Reservation } from "../types";
import { branding } from "../branding";

function fmt(dateISO: string): string {
  return new Date(dateISO + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function visitRange(e: { visitStart: string; visitEnd: string }): string {
  return e.visitStart === e.visitEnd ? fmt(e.visitStart) : `${fmt(e.visitStart)} – ${fmt(e.visitEnd)}`;
}

const EMPTY_FORM = { id: "", title: "", body: "", visitStart: "", visitEnd: "" };

/** Guestbook — reverse-chronological journal of visits (PRD 5.10). */
export default function GuestbookPage() {
  const { me, isAdmin } = useAuth();
  const [entries, setEntries] = useState<GuestbookEntry[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    // Reservations are only needed to pre-fill visit dates; don't block the journal on them.
    const [e, r] = await Promise.all([
      api.get<GuestbookEntry[]>("/guestbook"),
      api.get<Reservation[]>("/reservations").catch(() => [] as Reservation[]),
    ]);
    setEntries(e);
    setReservations(r);
  }, []);

  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load]);

  /**
   * PRD 5.10: pre-fill visit dates from the author's most recent reservation. "Most recent"
   * is the latest one that has started (you write about a trip after taking it); if none has,
   * fall back to their next upcoming one.
   */
  const myMostRecentReservation = (): Reservation | null => {
    // Local calendar date, not UTC (same as Yardwork's todayISO): after ~7pm US
    // Eastern toISOString() already reads as tomorrow, which would treat an
    // upcoming reservation as started and prefill the wrong trip's dates.
    const today = new Date().toLocaleDateString("sv-SE");
    const mine = reservations.filter((r) => r.createdBy === me.id); // API sorts by startDate ascending
    const started = mine.filter((r) => r.startDate <= today);
    return started[started.length - 1] ?? mine[0] ?? null;
  };

  const openCreate = () => {
    const r = myMostRecentReservation();
    setForm({ ...EMPTY_FORM, visitStart: r?.startDate ?? "", visitEnd: r?.endDate ?? "" });
    setError("");
    setShowForm(true);
  };

  const openEdit = (e: GuestbookEntry) => {
    setForm({ id: e.id, title: e.title, body: e.body, visitStart: e.visitStart, visitEnd: e.visitEnd });
    setError("");
    setShowForm(true);
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = { title: form.title, body: form.body, visitStart: form.visitStart, visitEnd: form.visitEnd };
      if (form.id) {
        await api.put(`/guestbook/${form.id}`, payload);
      } else {
        await api.post("/guestbook", payload);
      }
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (e: GuestbookEntry) => {
    if (!window.confirm(`Delete "${e.title}" from the guestbook?`)) return;
    try {
      await api.del(`/guestbook/${e.id}`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Guestbook</h1>
        <button className="btn" onClick={() => (showForm ? setShowForm(false) : openCreate())}>
          {showForm ? "Close" : "✍️ Write an entry"}
        </button>
      </div>
      <p className="muted">
        The {branding.propertyNoun} logbook — one entry per visit, for everyone to read on a rainy day.
      </p>
      {error && <div className="error">{error}</div>}

      {showForm && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <h2>{form.id ? "Edit entry" : "New entry"}</h2>
          <form onSubmit={submit}>
            <div className="field">
              <label>Title</label>
              <input
                value={form.title}
                placeholder="e.g. July 4th weekend"
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
              />
            </div>
            <div className="row">
              <div className="field">
                <label>Visit start</label>
                <input type="date" value={form.visitStart} onChange={(e) => setForm({ ...form, visitStart: e.target.value })} required />
              </div>
              <div className="field">
                <label>Visit end</label>
                <input type="date" value={form.visitEnd} onChange={(e) => setForm({ ...form, visitEnd: e.target.value })} required />
              </div>
            </div>
            <div className="field">
              <label>Your story</label>
              <textarea
                rows={6}
                value={form.body}
                placeholder="Who came up, what you did, what the weather was like, what you'd tell the next visitors…"
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                required
              />
            </div>
            <button className="btn" disabled={busy}>{form.id ? "Save changes" : "Add to the guestbook"}</button>
          </form>
        </div>
      )}

      {entries.length === 0 && !showForm && (
        <div className="card">
          <p className="big">📖 The logbook is empty</p>
          <p className="muted">
            No stories yet — be the first to write about a stay at the {branding.propertyNoun}. Years from
            now, this page is what everyone will scroll through.
          </p>
        </div>
      )}

      <div className="cards" style={{ gridTemplateColumns: "1fr" }}>
        {entries.map((e) => (
          <div className="card" key={e.id}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" }}>
              <h2 style={{ marginBottom: "0.3rem" }}>{e.title}</h2>
              {(e.author === me.id || isAdmin) && (
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  <button className="btn secondary small" onClick={() => openEdit(e)}>Edit</button>
                  <button className="btn danger small" onClick={() => void remove(e)}>Delete</button>
                </div>
              )}
            </div>
            <p className="muted" style={{ marginTop: 0 }}>
              {e.authorName} · {visitRange(e)}
            </p>
            <p style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{e.body}</p>
          </div>
        ))}
      </div>
    </>
  );
}
