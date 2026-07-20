import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "../api";
import { useAuth } from "../App";
import type { Reservation, Settings } from "../types";
import { branding } from "../branding";

const COLORS = ["#5a7d52", "#6b4f3a", "#2a6cb0", "#8a5fa8", "#b07d2a", "#3f7d8a", "#a03c2e", "#557", "#795"];

function colorFor(userId: string): string {
  let h = 0;
  for (const ch of userId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(dateISO: string, days: number): string {
  const d = new Date(dateISO + "T12:00:00");
  d.setDate(d.getDate() + days);
  return iso(d);
}

function fmt(dateISO: string): string {
  return new Date(dateISO + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const EMPTY_FORM = { id: "", startDate: "", endDate: "", attendees: "", notes: "" };

export default function CalendarPage() {
  const { me, isAdmin } = useAuth();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [r, s] = await Promise.all([api.get<Reservation[]>("/reservations"), api.get<Settings>("/settings")]);
    setReservations(r);
    setSettings(s);
  }, []);

  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load]);

  const today = iso(new Date());
  const priorityCutoff = settings ? addDays(today, settings.priorityWindowDays) : null;
  const isPriorityUser = settings?.priorityUserId === me.id;

  const days = useMemo(() => {
    const first = new Date(month);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [month]);

  const resOn = (dayISO: string) => reservations.filter((r) => r.startDate <= dayISO && dayISO < r.endDate);

  const openCreate = (dayISO?: string) => {
    setForm({ ...EMPTY_FORM, startDate: dayISO ?? "", endDate: dayISO ? addDays(dayISO, 2) : "" });
    setError("");
    setShowForm(true);
  };

  const openEdit = (r: Reservation) => {
    setForm({ id: r.id, startDate: r.startDate, endDate: r.endDate, attendees: r.attendees, notes: r.notes });
    setError("");
    setShowForm(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const body = { startDate: form.startDate, endDate: form.endDate, attendees: form.attendees, notes: form.notes };
      if (form.id) await api.put(`/reservations/${form.id}`, body);
      else await api.post("/reservations", body);
      setShowForm(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (r: Reservation) => {
    if (!window.confirm(`Cancel ${r.createdByName}'s reservation ${fmt(r.startDate)} → ${fmt(r.endDate)}?`)) return;
    try {
      await api.del(`/reservations/${r.id}`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const upcoming = reservations.filter((r) => r.endDate >= today);
  const monthName = month.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <>
      <h1>Reservation calendar</h1>
      {settings && !isPriorityUser && (
        <p className="muted">
          Striped dates are still in {branding.priorityUserLabelPossessive} first-look window (more than{" "}
          {settings.priorityWindowDays} days out) — they open to everyone {settings.priorityWindowDays} days before arrival.
        </p>
      )}
      {settings && isPriorityUser && <p className="muted">You have first-look priority — any open date is yours to claim. 💛</p>}
      {error && !showForm && <div className="error">{error}</div>}

      <div className="card">
        <div className="cal-head">
          <button className="btn secondary small" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>← Prev</button>
          <h2>{monthName}</h2>
          <button className="btn secondary small" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>Next →</button>
        </div>
        <div className="cal-grid">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="cal-dow">{d}</div>
          ))}
          {days.map((d) => {
            const dayISO = iso(d);
            const inMonth = d.getMonth() === month.getMonth();
            const rs = resOn(dayISO);
            const inPriorityWindow = priorityCutoff !== null && dayISO > priorityCutoff && rs.length === 0;
            const cls = [
              "cal-day",
              inMonth ? "" : "other",
              dayISO < today ? "past" : "",
              dayISO === today ? "today" : "",
              inPriorityWindow && inMonth ? "priority-window" : "",
            ].join(" ");
            return (
              <div
                key={dayISO}
                className={cls}
                onClick={() => dayISO >= today && rs.length === 0 && openCreate(dayISO)}
                style={{ cursor: dayISO >= today && rs.length === 0 ? "pointer" : "default" }}
                title={inPriorityWindow ? `${branding.priorityUserLabelPossessive} first-look window` : undefined}
              >
                <span className="n">{d.getDate()}</span>
                {rs.map((r) => (
                  <div key={r.id} className="cal-res" style={{ background: colorFor(r.createdBy) }}>
                    {r.createdByName.split(" ")[0]}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        <div className="legend">
          <span><span className="swatch" style={{ background: "repeating-linear-gradient(135deg,#fff,#fff 3px,#e8dfca 3px,#e8dfca 5px)", border: "1px solid #ddd" }} /> {branding.priorityUserLabelPossessive} first look</span>
          <span><span className="swatch" style={{ background: colorFor(me.id) }} /> You</span>
          <span className="muted">Click an open day to start a reservation</span>
        </div>
      </div>

      <div className="section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>Upcoming stays</h2>
          <button className="btn" onClick={() => openCreate()}>+ New reservation</button>
        </div>
        {upcoming.length === 0 && <p className="muted">No upcoming reservations.</p>}
        {upcoming.map((r) => (
          <div className="item-row" key={r.id}>
            <span className="swatch" style={{ background: colorFor(r.createdBy), width: 12, height: 12, borderRadius: 3, display: "inline-block" }} />
            <div className="grow">
              <strong>{r.createdByName}</strong> · {fmt(r.startDate)} → {fmt(r.endDate)}
              {r.attendees && <span className="muted"> · {r.attendees}</span>}
              {r.notes && <div className="muted">{r.notes}</div>}
            </div>
            {(r.createdBy === me.id || isAdmin) && (
              <>
                <button className="btn secondary small" onClick={() => openEdit(r)}>Edit</button>
                <button className="btn danger small" onClick={() => void cancel(r)}>Cancel</button>
              </>
            )}
          </div>
        ))}
      </div>

      {showForm && (
        <div className="card section" style={{ maxWidth: 560 }}>
          <h2>{form.id ? "Edit reservation" : "New reservation"}</h2>
          {error && <div className="error">{error}</div>}
          <form onSubmit={submit}>
            <div className="row">
              <div className="field">
                <label>Arrival</label>
                <input type="date" value={form.startDate} min={today} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
              </div>
              <div className="field">
                <label>Departure</label>
                <input type="date" value={form.endDate} min={form.startDate || today} onChange={(e) => setForm({ ...form, endDate: e.target.value })} required />
              </div>
            </div>
            <div className="field">
              <label>Who's coming?</label>
              <input value={form.attendees} placeholder="e.g. Kyle, Sarah + kids" onChange={(e) => setForm({ ...form, attendees: e.target.value })} />
            </div>
            <div className="field">
              <label>Notes</label>
              <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div style={{ display: "flex", gap: "0.6rem" }}>
              <button className="btn" disabled={busy}>{busy ? "Saving…" : form.id ? "Save changes" : "Reserve"}</button>
              <button type="button" className="btn secondary" onClick={() => setShowForm(false)}>Close</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
