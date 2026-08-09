import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { useAuth } from "../App";
import type { ChoreLog, Settings } from "../types";

const todayISO = () => new Date().toLocaleDateString("sv-SE");

export default function YardworkPage() {
  const { me, isAdmin } = useAuth();
  const [chores, setChores] = useState<ChoreLog[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [form, setForm] = useState({ type: "mow", completedDate: todayISO(), note: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [c, s] = await Promise.all([api.get<ChoreLog[]>("/chores"), api.get<Settings>("/settings")]);
    setChores(c);
    setSettings(s);
  }, []);

  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load]);

  const lastMow = chores.find((c) => c.type === "mow");
  const daysSince = lastMow
    ? Math.round((Date.parse(todayISO()) - Date.parse(lastMow.completedDate)) / 86_400_000)
    : null;
  const overdue = settings && (daysSince === null || daysSince > settings.vacancyThresholdDays);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.post("/chores", form);
      setForm({ type: "mow", completedDate: todayISO(), note: "" });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // A mis-logged mow resets the reminder clock, so the person who logged it (or an admin)
  // needs a way to take it back.
  const remove = async (c: ChoreLog) => {
    if (!window.confirm(`Remove the ${c.type} logged on ${c.completedDate}?`)) return;
    try {
      await api.del(`/chores/${c.id}`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
      <h1>Yardwork log</h1>
      {error && <div className="error">{error}</div>}
      {settings && (
        <div className={overdue ? "notice" : "card"} style={overdue ? {} : { marginBottom: "1rem" }}>
          {daysSince === null
            ? "No mow on record yet — log the first one below."
            : `Last mow was ${daysSince} day${daysSince === 1 ? "" : "s"} ago${
                overdue ? ` — past the ${settings.vacancyThresholdDays}-day threshold, time to cut.` : "."
              }`}
        </div>
      )}

      <div className="card">
        <h2>Log it (resets the reminder clock)</h2>
        <form onSubmit={submit}>
          <div className="row">
            <div className="field">
              <label>What</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="mow">Mowed (gas mower)</option>
                <option value="trim">Trimmed (string trimmer)</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="field">
              <label>Date</label>
              <input type="date" value={form.completedDate} max={todayISO()} onChange={(e) => setForm({ ...form, completedDate: e.target.value })} required />
            </div>
          </div>
          <div className="field">
            <label>Note (optional)</label>
            <input value={form.note} placeholder="e.g. mower low on gas" onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </div>
          <button className="btn" disabled={busy}>{busy ? "Saving…" : "Log yardwork"}</button>
        </form>
      </div>

      <div className="section">
        <h2>History</h2>
        {chores.length === 0 && <p className="muted">Nothing logged yet.</p>}
        {chores.map((c) => (
          <div className="item-row" key={c.id}>
            <span>{c.type === "mow" ? "🚜" : c.type === "trim" ? "✂️" : "🔧"}</span>
            <div className="grow">
              <strong>{c.type}</strong> · {c.completedDate} · {c.completedByName}
              {c.note && <span className="muted"> — {c.note}</span>}
            </div>
            {(isAdmin || c.completedBy === me.id) && (
              <button className="btn danger small" onClick={() => void remove(c)}>✕</button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
