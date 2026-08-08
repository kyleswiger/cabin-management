import { randomUUID } from "node:crypto";
import { ddb, GetCommand, PutCommand, DeleteCommand, TABLE, queryType } from "../../lib/db.js";
import { ApiError, type Caller } from "../../lib/http.js";
import { getProfile } from "../../lib/users.js";

// Local Treks & Area Guide (PRD 5.11): a living directory of what's around the
// property. Anyone can add or edit entries — like the supply checklist, it is
// member-curated, not admin-curated. Delete is creator-or-admin.

export interface Trek {
  id: string;
  name: string;
  category: "hike" | "food" | "attraction" | "essentials";
  description: string;
  driveMinutes?: number;
  link?: string;
  addedBy: string;
  addedByName: string;
  createdAt: string;
}

const CATEGORIES = new Set(["hike", "food", "attraction", "essentials"]);

function assertCategory(value: unknown): Trek["category"] {
  if (typeof value !== "string" || !CATEGORIES.has(value)) {
    throw new ApiError(400, "category must be hike, food, attraction, or essentials");
  }
  return value as Trek["category"];
}

/** Optional drive time in minutes; null clears it. Returns undefined when absent/cleared. */
function assertDriveMinutes(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new ApiError(400, "driveMinutes must be a positive number");
  }
  return Math.round(value);
}

/** Optional external link (Google Maps / AllTrails — PRD 5.11); must be http(s). null clears it. */
function assertLink(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new ApiError(400, "link must be a URL");
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ApiError(400, "link must be a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ApiError(400, "link must be an http(s) URL");
  }
  return url.toString();
}

export async function listTreks(): Promise<Trek[]> {
  const items = await queryType<Trek>("TREK");
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

async function save(item: Trek): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: { PK: `TREK#${item.id}`, SK: "META", GSI1PK: "TREK", GSI1SK: item.name.toLowerCase(), ...item },
    })
  );
}

interface TrekBody {
  name?: unknown;
  category?: unknown;
  description?: unknown;
  driveMinutes?: unknown;
  link?: unknown;
}

export async function createTrek(caller: Caller, body: TrekBody): Promise<Trek> {
  if (typeof body.name !== "string" || !body.name.trim()) throw new ApiError(400, "name is required");
  if (typeof body.description !== "string" || !body.description.trim()) throw new ApiError(400, "description is required");
  const profile = await getProfile(caller.sub);
  const item: Trek = {
    id: randomUUID(),
    name: body.name.trim(),
    category: assertCategory(body.category),
    description: body.description.trim(),
    driveMinutes: assertDriveMinutes(body.driveMinutes),
    link: assertLink(body.link),
    addedBy: caller.sub,
    addedByName: profile?.name ?? caller.name,
    createdAt: new Date().toISOString(),
  };
  await save(item);
  return item;
}

// Any member can edit — the guide is living, shared content (PRD 5.11).
export async function updateTrek(_caller: Caller, id: string, body: TrekBody): Promise<Trek> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: `TREK#${id}`, SK: "META" } }));
  if (!res.Item) throw new ApiError(404, "Trek not found");
  const existing = res.Item as Trek;
  const updated: Trek = {
    ...existing,
    name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : existing.name,
    category: body.category !== undefined ? assertCategory(body.category) : existing.category,
    description:
      typeof body.description === "string" && body.description.trim() ? body.description.trim() : existing.description,
    driveMinutes: body.driveMinutes !== undefined ? assertDriveMinutes(body.driveMinutes) : existing.driveMinutes,
    link: body.link !== undefined ? assertLink(body.link) : existing.link,
  };
  // Explicit null clears the optional fields; removeUndefinedValues drops them from the item.
  if (updated.driveMinutes === undefined) delete updated.driveMinutes;
  if (updated.link === undefined) delete updated.link;
  await save(updated);
  return updated;
}

export async function deleteTrek(caller: Caller, id: string): Promise<void> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: `TREK#${id}`, SK: "META" } }));
  if (!res.Item) throw new ApiError(404, "Trek not found");
  const existing = res.Item as Trek;
  if (existing.addedBy !== caller.sub && !caller.isAdmin) {
    throw new ApiError(403, "Only the creator or an admin can delete an entry");
  }
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK: `TREK#${id}`, SK: "META" } }));
}
