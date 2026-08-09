import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

async function apiCall<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await idToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${env.apiUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
  return (await res.json().catch(() => ({}))) as T;
}

interface Reservation { id: string; startDate: string; endDate: string; attendees: string; notes: string }
interface Supply { id: string; name: string }
interface Project { id: string; title: string }
interface Chore { id: string; note: string }
interface Settings { priorityWindowDays: number; priorityUserId: string | null; notifyOnProjectUpdates: boolean }
interface Profile { id: string }
interface Album { id: string; title: string }
interface GuestbookEntry { id: string; title: string }
interface Trek { id: string; name: string }

// Written by globalSetup, read by globalTeardown. Same gitignored dir as the auth state.
const SETTINGS_STATE_FILE = "e2e/.auth/settings-state.json";

/**
 * Advancing a project's status and adding a contribution both fan out a real SNS SMS to
 * every profile with a phone on file, and write a permanent NOTIF# row per message that
 * `sweepTestData` has no endpoint to delete. So the suite turns the flag off up front and
 * `restoreSettings` puts it back in globalTeardown.
 *
 * This is a safety guard, not a nicety: if it can't be established, the run must not start.
 */
export async function disableProjectNotifications(): Promise<void> {
  const settings = await apiCall<Settings>("GET", "/settings");

  // A run killed before teardown leaves the file behind. Never overwrite it — the value
  // recorded then is the real pre-test one, and the flag is already off now, so clobbering
  // it with today's `false` would strand notifications disabled for good.
  if (!existsSync(SETTINGS_STATE_FILE)) {
    mkdirSync("e2e/.auth", { recursive: true });
    writeFileSync(SETTINGS_STATE_FILE, JSON.stringify({ notifyOnProjectUpdates: settings.notifyOnProjectUpdates }));
  }

  if (settings.notifyOnProjectUpdates) {
    await apiCall("PUT", "/settings", { notifyOnProjectUpdates: false });
    console.log("\n[e2e setup] Disabled notifyOnProjectUpdates for the run.");
  }
}

/** Restore notifyOnProjectUpdates to the value recorded by globalSetup. */
export async function restoreSettings(): Promise<void> {
  if (!existsSync(SETTINGS_STATE_FILE)) return;
  const { notifyOnProjectUpdates } = JSON.parse(readFileSync(SETTINGS_STATE_FILE, "utf-8")) as Pick<
    Settings,
    "notifyOnProjectUpdates"
  >;
  // Keep the file until the restore lands, so a failed run doesn't lose the original value.
  if (notifyOnProjectUpdates) {
    await apiCall("PUT", "/settings", { notifyOnProjectUpdates: true });
    console.log("[e2e teardown] Restored notifyOnProjectUpdates.");
  }
  rmSync(SETTINGS_STATE_FILE, { force: true });
}

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
 * Delete a marked album by exact title, cascading to its media (PRD 5.8).
 *
 * The gallery spec's own cleanup path. Album delete is admin-only and, on a deployment
 * that predates the Gallery page's "Delete album" button, has no UI at all — so the spec
 * cannot always undo through the browser what it did through the browser. Resolves to
 * false when no such album exists (already cleaned up), so it is safe to call twice.
 */
export async function deleteAlbumByTitle(title: string): Promise<boolean> {
  const album = (await apiCall<Album[]>("GET", "/albums")).find((a) => a.title === title);
  if (!album) return false;
  await apiCall("DELETE", `/albums/${album.id}`);
  return true;
}

/** Same idea for guestbook entries — used when a spec creates one it can't reach a delete button for. */
export async function deleteGuestbookEntryByTitle(title: string): Promise<boolean> {
  const entry = (await apiCall<GuestbookEntry[]>("GET", "/guestbook")).find((g) => g.title === title);
  if (!entry) return false;
  await apiCall("DELETE", `/guestbook/${entry.id}`);
  return true;
}

/**
 * Delete every entity the suite may have left behind (identified by the MARKER prefix).
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
  // Guestbook entries and treks (PRD 5.10 / 5.11) — plain creator-or-admin deletes.
  for (const g of await apiCall<GuestbookEntry[]>("GET", "/guestbook")) {
    if (isMarked(g.title)) {
      await apiCall("DELETE", `/guestbook/${g.id}`);
      removed++;
    }
  }
  for (const t of await apiCall<Trek[]>("GET", "/treks")) {
    if (isMarked(t.name)) {
      await apiCall("DELETE", `/treks/${t.id}`);
      removed++;
    }
  }
  // Albums last: DELETE /albums/:id cascades to every media item in the album (rows +
  // S3 originals and derivatives), so this also clears any marked photo the gallery
  // spec uploaded — including ones sitting in the print queue, which have no
  // standalone sweep of their own.
  for (const a of await apiCall<Album[]>("GET", "/albums")) {
    if (isMarked(a.title)) {
      await apiCall("DELETE", `/albums/${a.id}`);
      removed++;
    }
  }

  // DELETE /chores/:id is newer than some deployed stacks. Against a deployment that predates
  // it the call 404s; report the leftovers instead of failing teardown over them.
  const markedChores = (await apiCall<Chore[]>("GET", "/chores")).filter((c) => isMarked(c.note));
  let staleChores = 0;
  for (const c of markedChores) {
    try {
      await apiCall("DELETE", `/chores/${c.id}`);
      removed++;
    } catch {
      staleChores++;
    }
  }
  const choreNote = staleChores
    ? ` ${staleChores} marked chore log(s) remain — deployment predates DELETE /chores/:id.`
    : "";

  return `Swept ${removed} marked entit${removed === 1 ? "y" : "ies"}.${choreNote}`;
}
