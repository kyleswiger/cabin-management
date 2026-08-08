import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { useAuth } from "../App";
import type { NotificationLog, Profile, Settings } from "../types";
import { branding } from "../branding";

const EMPTY_INVITE = { email: "", name: "", phone: "", role: "member" };

export default function AdminPage() {
  const { me } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [notifs, setNotifs] = useState<NotificationLog[]>([]);
  const [invite, setInvite] = useState(EMPTY_INVITE);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);

  const load = useCallback(async () => {
    const [u, s] = await Promise.all([api.get<Profile[]>("/users"), api.get<Settings>("/settings")]);
    setUsers(u);
    setSettings(s);
  }, []);

  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load]);

  const act = async (fn: () => Promise<void>) => {
    setError("");
    setInfo("");
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitInvite = (e: FormEvent) => {
    e.preventDefault();
    void act(async () => {
      await api.post("/users", { ...invite, phone: invite.phone || null });
      setInvite(EMPTY_INVITE);
      setInfo("Invite sent — they'll get an email with a temporary password.");
    });
  };

  const saveSettings = (e: FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    void act(async () => {
      await api.put("/settings", settings);
      setInfo("Settings saved.");
    });
  };

  const removeUser = (u: Profile) => {
    if (!window.confirm(`Remove ${u.name} (${u.email})? They will no longer be able to sign in.`)) return;
    void act(() => api.del(`/users/${u.id}`).then(() => undefined));
  };

  const toggleRole = (u: Profile) => {
    void act(() => api.put(`/users/${u.id}`, { role: u.role === "admin" ? "member" : "admin" }).then(() => undefined));
  };

  const loadNotifs = () => {
    setShowNotifs(true);
    api.get<NotificationLog[]>("/notifications").then(setNotifs).catch((e) => setError((e as Error).message));
  };

  return (
    <>
      <h1>Admin</h1>
      {error && <div className="error">{error}</div>}
      {info && <div className="notice">{info}</div>}

      <div className="card">
        <h2>Family members</h2>
        <table className="list">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Phone (SMS)</th><th>Role</th><th>First look</th><th></th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{u.phone || <span className="muted">none — no texts</span>}</td>
                <td>
                  <button className="btn secondary small" disabled={busy || u.id === me.id} onClick={() => toggleRole(u)}>
                    {u.role}{u.id !== me.id && " ⇄"}
                  </button>
                </td>
                <td>
                  <input
                    type="radio"
                    name="priority-user"
                    checked={settings?.priorityUserId === u.id}
                    onChange={() => settings && setSettings({ ...settings, priorityUserId: u.id })}
                  />
                </td>
                <td>
                  {u.id !== me.id && (
                    <button className="btn danger small" disabled={busy} onClick={() => removeUser(u)}>Remove</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">The &ldquo;first look&rdquo; radio marks who gets reservation priority ({branding.priorityUserLabel}) — save via Settings below.</p>
      </div>

      <div className="card section">
        <h2>Invite a family member</h2>
        <form onSubmit={submitInvite}>
          <div className="row">
            <div className="field">
              <label>Name</label>
              <input value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} required />
            </div>
            <div className="field">
              <label>Email</label>
              <input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} required />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>Phone for SMS (+1…, optional)</label>
              <input value={invite.phone} placeholder="+15551234567" onChange={(e) => setInvite({ ...invite, phone: e.target.value })} />
            </div>
            <div className="field">
              <label>Role</label>
              <select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <button className="btn" disabled={busy}>Send invite</button>
        </form>
      </div>

      {settings && (
        <div className="card section">
          <h2>Rules &amp; reminders</h2>
          <form onSubmit={saveSettings}>
            <div className="row">
              <div className="field">
                <label>{branding.priorityUserLabelPossessive} first-look window (days before arrival)</label>
                <input type="number" min="0" max="365" value={settings.priorityWindowDays} onChange={(e) => setSettings({ ...settings, priorityWindowDays: Number(e.target.value) })} />
              </div>
              <div className="field">
                <label>Vacancy/mow threshold (days)</label>
                <input type="number" min="0" max="365" value={settings.vacancyThresholdDays} onChange={(e) => setSettings({ ...settings, vacancyThresholdDays: Number(e.target.value) })} />
              </div>
              <div className="field">
                <label>Pre-visit reminder (days before arrival)</label>
                <input type="number" min="0" max="30" value={settings.preVisitReminderDays} onChange={(e) => setSettings({ ...settings, preVisitReminderDays: Number(e.target.value) })} />
              </div>
            </div>
            <div className="field">
              <label>
                <input
                  type="checkbox"
                  style={{ width: "auto", marginRight: "0.5rem" }}
                  checked={settings.notifyOnProjectUpdates}
                  onChange={(e) => setSettings({ ...settings, notifyOnProjectUpdates: e.target.checked })}
                />
                Text everyone when a project status changes or someone chips in
              </label>
            </div>
            <div className="field">
              <label>
                <input
                  type="checkbox"
                  style={{ width: "auto", marginRight: "0.5rem" }}
                  checked={settings.guestbookNudgeEnabled}
                  onChange={(e) => setSettings({ ...settings, guestbookNudgeEnabled: e.target.checked })}
                />
                Text visitors the day after checkout to add a guestbook entry
              </label>
            </div>
            <button className="btn" disabled={busy}>Save settings</button>
          </form>
        </div>
      )}

      <div className="section">
        {!showNotifs ? (
          <button className="btn secondary" onClick={loadNotifs}>Show recent notification log</button>
        ) : (
          <div className="card">
            <h2>Recent notifications</h2>
            {notifs.length === 0 && <p className="muted">Nothing sent yet.</p>}
            <table className="list">
              <tbody>
                {notifs.map((n) => (
                  <tr key={n.id}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>{new Date(n.sentDate).toLocaleString()}</td>
                    <td><span className="chip not_started">{n.type}</span></td>
                    <td>{n.message}</td>
                    <td className="muted">{n.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
