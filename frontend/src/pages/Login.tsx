import { useState, type FormEvent } from "react";
import { confirmPasswordReset, login, requestPasswordReset, type LoginResult } from "../auth";
import { branding } from "../branding";

type Mode = "login" | "new-password" | "reset-request" | "reset-confirm";

export default function LoginPage({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<Extract<LoginResult, { kind: "new-password-required" }> | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setError("");
    setInfo("");
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const submitLogin = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const result = await login(email.trim().toLowerCase(), password);
      if (result.kind === "ok") {
        await onSignedIn();
      } else {
        setChallenge(result);
        setMode("new-password");
      }
    });
  };

  const submitNewPassword = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await challenge!.complete(newPassword);
      await onSignedIn();
    });
  };

  const submitResetRequest = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await requestPasswordReset(email.trim().toLowerCase());
      setInfo("Check your email for a reset code.");
      setMode("reset-confirm");
    });
  };

  const submitResetConfirm = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await confirmPasswordReset(email.trim().toLowerCase(), code.trim(), newPassword);
      setInfo("Password updated — sign in with it below.");
      setMode("login");
    });
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>{branding.emoji} {branding.appName}</h1>
        <p className="sub">{branding.tagline}</p>
        {error && <div className="error">{error}</div>}
        {info && <div className="notice">{info}</div>}

        {mode === "login" && (
          <form onSubmit={submitLogin}>
            <div className="field">
              <label>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </div>
            <div className="field">
              <label>Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <button className="btn" disabled={busy} style={{ width: "100%" }}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <p style={{ textAlign: "center", marginTop: "0.9rem" }}>
              <button type="button" className="linkbtn" onClick={() => setMode("reset-request")}>
                Forgot password?
              </button>
            </p>
          </form>
        )}

        {mode === "new-password" && (
          <form onSubmit={submitNewPassword}>
            <p className="sub">Welcome! Pick a password to finish setting up your account (10+ characters, with a number).</p>
            <div className="field">
              <label>New password</label>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required autoFocus />
            </div>
            <button className="btn" disabled={busy} style={{ width: "100%" }}>
              {busy ? "Saving…" : "Set password & sign in"}
            </button>
          </form>
        )}

        {mode === "reset-request" && (
          <form onSubmit={submitResetRequest}>
            <div className="field">
              <label>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </div>
            <button className="btn" disabled={busy} style={{ width: "100%" }}>
              {busy ? "Sending…" : "Email me a reset code"}
            </button>
            <p style={{ textAlign: "center", marginTop: "0.9rem" }}>
              <button type="button" className="linkbtn" onClick={() => setMode("login")}>
                Back to sign in
              </button>
            </p>
          </form>
        )}

        {mode === "reset-confirm" && (
          <form onSubmit={submitResetConfirm}>
            <div className="field">
              <label>Reset code (from email)</label>
              <input value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
            </div>
            <div className="field">
              <label>New password</label>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
            </div>
            <button className="btn" disabled={busy} style={{ width: "100%" }}>
              {busy ? "Saving…" : "Reset password"}
            </button>
          </form>
        )}
      </div>

      {/*
        Public, unauthenticated copy. Everything above this point is a login wall, which is all an
        outside visitor — including a carrier reviewing the toll-free SMS registration — could
        otherwise see. A registration whose website shows only a password box is routinely
        rejected, so this block states plainly what the service is and links the SMS program terms.
      */}
      <div className="login-about">
        <h2>What is this?</h2>
        <p>
          {branding.longName} is a private, invite-only site that one family uses to coordinate a
          shared {branding.propertyNoun} — booking visits, tracking supplies, and keeping up with
          maintenance. There is no public signup: accounts are created by a family administrator.
        </p>
        <h2>Text message reminders</h2>
        <p>
          Members who choose to can get reminders by text — an upcoming visit, supplies to bring, or
          yardwork that needs doing. Texts go only to members who entered their own number and
          checked the consent box on their profile page. Message frequency varies, up to about one
          message per day. Message and data rates may apply. Reply HELP for help, STOP to
          unsubscribe. We never share numbers with anyone.
        </p>
        <p>
          <a href="/sms-terms.html">SMS terms &amp; privacy policy</a>
        </p>
      </div>
    </div>
  );
}
