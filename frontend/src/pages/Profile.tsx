import { useState, type FormEvent } from "react";
import { api } from "../api";
import { useAuth } from "../App";
import type { Profile } from "../types";

export default function ProfilePage() {
  const { me, refreshMe } = useAuth();
  const [name, setName] = useState(me.name);
  const [phone, setPhone] = useState(me.phone ?? "");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setBusy(true);
    try {
      await api.put<Profile>("/me", { name, phone: phone || null });
      await refreshMe();
      setInfo("Saved.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Your profile</h1>
      {error && <div className="error">{error}</div>}
      {info && <div className="notice">{info}</div>}
      {!me.phone && (
        <div className="notice">📱 Add your phone number to get supply and yardwork reminder texts.</div>
      )}
      <div className="card" style={{ maxWidth: 480 }}>
        <form onSubmit={submit}>
          <div className="field">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="field">
            <label>Email</label>
            <input value={me.email} disabled />
          </div>
          <div className="field">
            <label>Phone for SMS reminders (E.164, e.g. +15551234567)</label>
            <input value={phone} placeholder="+15551234567" onChange={(e) => setPhone(e.target.value)} />
          </div>
          <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </form>
      </div>
    </>
  );
}
