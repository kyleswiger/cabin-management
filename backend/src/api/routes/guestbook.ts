import { randomUUID } from "node:crypto";
import { ddb, GetCommand, PutCommand, DeleteCommand, TABLE, queryType } from "../../lib/db.js";
import { ApiError, assertDate, type Caller } from "../../lib/http.js";
import { getProfile } from "../../lib/users.js";

/**
 * One journal entry per visit — the digital version of the classic cabin logbook (PRD 5.10).
 * Visible to all members; edit/delete is author-or-admin.
 */
export interface GuestbookEntry {
  id: string;
  /** Cognito sub of the author. */
  author: string;
  authorName: string;
  title: string;
  body: string;
  /** Visit dates, YYYY-MM-DD, inclusive on both ends (a one-day visit has visitStart === visitEnd). */
  visitStart: string;
  visitEnd: string;
  /**
   * Optional photo links into the gallery (PRD 5.8 / 5.10). Stored from day one so
   * entries can be linked when the gallery ships; there is no linking UI here yet.
   */
  mediaIds: string[];
  createdAt: string;
}

export async function listEntries(): Promise<GuestbookEntry[]> {
  const items = await queryType<GuestbookEntry>("GUESTBOOK");
  // Reverse-chronological reading view (PRD 5.10): newest visit first.
  return items.sort((a, b) => b.visitStart.localeCompare(a.visitStart) || b.createdAt.localeCompare(a.createdAt));
}

async function getEntry(id: string): Promise<GuestbookEntry> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: `GUEST#${id}`, SK: "META" } }));
  if (!res.Item) throw new ApiError(404, "Guestbook entry not found");
  return res.Item as GuestbookEntry;
}

async function save(entry: GuestbookEntry): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: { PK: `GUEST#${entry.id}`, SK: "META", GSI1PK: "GUESTBOOK", GSI1SK: entry.visitStart, ...entry },
    })
  );
}

function assertVisitRange(visitStart: string, visitEnd: string): void {
  // Unlike reservations (half-open, end = checkout), visit dates are inclusive: same-day is a valid one-day visit.
  if (visitEnd < visitStart) throw new ApiError(400, "visitEnd must be on or after visitStart");
}

function parseMediaIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((m) => typeof m !== "string")) {
    throw new ApiError(400, "mediaIds must be an array of strings");
  }
  return value as string[];
}

interface GuestbookInput {
  title?: unknown;
  body?: unknown;
  visitStart?: unknown;
  visitEnd?: unknown;
  mediaIds?: unknown;
}

export async function createEntry(caller: Caller, body: GuestbookInput): Promise<GuestbookEntry> {
  if (typeof body.title !== "string" || !body.title.trim()) throw new ApiError(400, "title is required");
  if (typeof body.body !== "string" || !body.body.trim()) throw new ApiError(400, "body is required");
  const visitStart = assertDate(body.visitStart, "visitStart");
  const visitEnd = assertDate(body.visitEnd, "visitEnd");
  assertVisitRange(visitStart, visitEnd);
  const profile = await getProfile(caller.sub);
  const entry: GuestbookEntry = {
    id: randomUUID(),
    author: caller.sub,
    authorName: profile?.name ?? caller.name,
    title: body.title.trim(),
    body: body.body,
    visitStart,
    visitEnd,
    mediaIds: parseMediaIds(body.mediaIds),
    createdAt: new Date().toISOString(),
  };
  await save(entry);
  return entry;
}

export async function updateEntry(caller: Caller, id: string, body: GuestbookInput): Promise<GuestbookEntry> {
  const existing = await getEntry(id);
  if (existing.author !== caller.sub && !caller.isAdmin) {
    throw new ApiError(403, "Only the author or an admin can edit a guestbook entry");
  }
  const visitStart = body.visitStart !== undefined ? assertDate(body.visitStart, "visitStart") : existing.visitStart;
  const visitEnd = body.visitEnd !== undefined ? assertDate(body.visitEnd, "visitEnd") : existing.visitEnd;
  assertVisitRange(visitStart, visitEnd);
  if (body.title !== undefined && (typeof body.title !== "string" || !body.title.trim())) {
    throw new ApiError(400, "title must be a non-empty string");
  }
  if (body.body !== undefined && (typeof body.body !== "string" || !body.body.trim())) {
    throw new ApiError(400, "body must be a non-empty string");
  }
  const updated: GuestbookEntry = {
    ...existing,
    title: typeof body.title === "string" ? body.title.trim() : existing.title,
    body: typeof body.body === "string" ? body.body : existing.body,
    visitStart,
    visitEnd,
    mediaIds: body.mediaIds !== undefined ? parseMediaIds(body.mediaIds) : existing.mediaIds ?? [],
  };
  await save(updated);
  return updated;
}

export async function deleteEntry(caller: Caller, id: string): Promise<void> {
  const existing = await getEntry(id);
  if (existing.author !== caller.sub && !caller.isAdmin) {
    throw new ApiError(403, "Only the author or an admin can delete a guestbook entry");
  }
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK: `GUEST#${id}`, SK: "META" } }));
}
