import { useState, type FormEvent } from "react";
import { api } from "../api";
import { useAuth } from "../App";
import { branding } from "../branding";
import type { Profile } from "../types";

export default function ProfilePage() {
  const { me, refreshMe } = useAuth();
  const [name, setName] = useState(me.name);
  const [phone, setPhone] = useState(me.phone ?? "");
  const [smsConsent, setSmsConsent] = useState(me.smsConsent ?? false);
  const [emailOptIn, setEmailOptIn] = useState(me.emailOptIn ?? true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  // Consent belongs to the number that gave it, and the API revokes it server-side when the
  // number changes. Mirror that here so the box can't sit checked against a number the backend
  // is about to treat as unconsented.
  const phoneChanged = (phone || null) !== (me.phone ?? null);
  const effectiveConsent = phoneChanged ? false : smsConsent;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setBusy(true);
    try {
      await api.put<Profile>("/me", {
        name,
        phone: phone || null,
        smsConsent: effectiveConsent,
        emailOptIn,
      });
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
      {me.phone && !me.smsConsent && (
        <div className="notice">
          📱 Your number is saved, but text reminders are off until you check the box below.
        </div>
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
            <label>
              <input
                type="checkbox"
                checked={emailOptIn}
                onChange={(e) => setEmailOptIn(e.target.checked)}
              />{" "}
              Email me reminders about reservations, chores, and supplies.
            </label>
          </div>

          <div className="field">
            <label>Phone for SMS reminders (E.164, e.g. +15551234567)</label>
            <input value={phone} placeholder="+15551234567" onChange={(e) => setPhone(e.target.value)} />
          </div>

          {/*
            Carrier-required opt-in. This exact wording — purpose, frequency, rates, HELP/STOP, and
            a link to the terms — is what gets screenshotted for the toll-free registration, and
            what carriers audit against. It must stay unchecked by default; a pre-checked box is
            not consent and is grounds for rejection. Do not reword without re-reading
            docs/sms-program.md.
          */}
          <div className="field">
            <label>
              <input
                type="checkbox"
                checked={effectiveConsent}
                disabled={!phone}
                onChange={(e) => setSmsConsent(e.target.checked)}
              />{" "}
              Text me reminders about reservations, chores, and supplies at this number. Message
              frequency varies, up to about 1 message per day. Message and data rates may apply.
              Reply HELP for help, STOP to unsubscribe. See our{" "}
              <a href="/sms-terms.html" target="_blank" rel="noreferrer">
                SMS terms and privacy policy
              </a>
              .
            </label>
            {phoneChanged && smsConsent && (
              <div className="notice">
                You changed your number, so text reminders will be turned off. Check the box again
                to consent for the new number.
              </div>
            )}
            {me.smsConsentAt && !phoneChanged && (
              <small>Consent recorded {new Date(me.smsConsentAt).toLocaleDateString()}.</small>
            )}
          </div>

          <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </form>
      </div>
      <p>
        <small>
          {branding.appName} only ever texts the people who have accounts here. We never share your
          number.
        </small>
      </p>
    </>
  );
}
