import { AuthenticationDetails, CognitoUser, CognitoUserPool } from "amazon-cognito-identity-js";
import { env, MARKER } from "./env";

// A thin Node-side API client used for teardown/cleanup and for picking a conflict-free
// reservation slot — NOT for the assertions, which all go through the UI. It signs in with
// the same test credentials over Cognito SRP (Node 22 provides global fetch + crypto).

let cachedToken: string | undefined;

async function idToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const pool = new CognitoUserPool({ UserPoolId: env.userPoolId, ClientId: env.clientId });
  const user = new CognitoUser({ Username: env.email, Pool: pool });
  const details = new AuthenticationDetails({ Username: env.email, Password: env.password });
  cachedToken = await new Promise<string>((resolve, reject) => {
    user.authenticateUser(details, {
      onSuccess: (session) => resolve(session.getIdToken().getJwtToken()),
      onFailure: reject,
    });
  });
  return cachedToken;
}

async function apiCall<T>(method: string, path: string): Promise<T> {
  const token = await idToken();
  const res = await fetch(`${env.apiUrl}${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
  return (await res.json().catch(() => ({}))) as T;
}

interface Reservation { id: string; startDate: string; endDate: string; attendees: string; notes: string }
interface Supply { id: string; name: string }
interface Project { id: string; title: string }
interface Chore { id: string; note: string }
interface Settings { priorityWindowDays: number; priorityUserId: string | null }
interface Profile { id: string }

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(base: Date, days: number): string {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

/**
 * Find a conflict-free 2-night slot the test account is allowed to book. Stays inside the
 * priority-user first-look window when a *different* user holds priority, and skips any dates
 * overlapping existing reservations (half-open: a checkout day may equal the next arrival).
 */
export async function findOpenSlot(): Promise<{ startDate: string; endDate: string }> {
  const [reservations, settings, me] = await Promise.all([
    apiCall<Reservation[]>("GET", "/reservations"),
    apiCall<Settings>("GET", "/settings"),
    apiCall<Profile>("GET", "/me"),
  ]);
  const today = new Date();
  const iAmPriority = settings.priorityUserId === null || settings.priorityUserId === me.id;
  // Latest arrival still allowed without priority; -1 for safety against clock skew.
  const maxOffset = iAmPriority ? 200 : Math.max(3, settings.priorityWindowDays - 1);

  for (let offset = 3; offset <= maxOffset; offset++) {
    const startDate = addDays(today, offset);
    const endDate = addDays(today, offset + 2);
    const conflict = reservations.some((r) => startDate < r.endDate && r.startDate < endDate);
    if (!conflict) return { startDate, endDate };
  }
  throw new Error("No open reservation slot found in the bookable window — clear space and retry.");
}

/**
 * Delete every entity the suite may have left behind (identified by the MARKER prefix).
 * Chore logs have no delete endpoint, so any marked ones are reported but not removed.
 */
export async function sweepTestData(): Promise<string> {
  const isMarked = (s?: string) => (s ?? "").includes(MARKER);
  let removed = 0;

  for (const r of await apiCall<Reservation[]>("GET", "/reservations")) {
    if (isMarked(r.attendees) || isMarked(r.notes)) {
      await apiCall("DELETE", `/reservations/${r.id}`);
      removed++;
    }
  }
  for (const s of await apiCall<Supply[]>("GET", "/supplies")) {
    if (isMarked(s.name)) {
      await apiCall("DELETE", `/supplies/${s.id}`);
      removed++;
    }
  }
  for (const p of await apiCall<Project[]>("GET", "/projects")) {
    if (isMarked(p.title)) {
      await apiCall("DELETE", `/projects/${p.id}`);
      removed++;
    }
  }
  const markedChores = (await apiCall<Chore[]>("GET", "/chores")).filter((c) => isMarked(c.note));
  const choreNote = markedChores.length
    ? ` ${markedChores.length} marked chore log(s) remain (no delete endpoint) — harmless test rows.`
    : "";

  return `Swept ${removed} marked entit${removed === 1 ? "y" : "ies"}.${choreNote}`;
}
