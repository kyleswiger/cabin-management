import { randomUUID } from "node:crypto";
import { ddb, GetCommand, PutCommand, DeleteCommand, QueryCommand, TABLE, queryType } from "../../lib/db.js";
import { ApiError, type Caller } from "../../lib/http.js";
import { deleteMediaObjects } from "../../lib/media.js";

/** Album — PRD 5.8. Two kinds sharing one media pipeline: trip albums (anyone
 * creates) and reference albums (admin-only creation, carry a well-known slug
 * for deep links, e.g. from the Supplies page). */
export interface Album {
  id: string;
  type: "trip" | "reference";
  /** Reference albums only — unique kebab-case deep-link handle (PRD 5.8, 9.2). */
  slug?: string;
  title: string;
  createdBy: string;
  createdAt: string;
}

/** MediaItem — PRD 5.8/7. The row is created at upload-request time with
 * processingStatus "uploading"; the media-processing Lambda (S3 event) flips it
 * to "processing"/"ready"/"failed" and fills webKey/thumbKey/posterKey. The
 * frontend builds `/media/<key>` URLs from the *Key fields (signed cookies). */
export interface MediaItem {
  id: string;
  albumId: string;
  mediaType: "photo" | "video";
  originalKey: string;
  originalFormat: string;
  webKey?: string;
  thumbKey?: string;
  posterKey?: string;
  processingStatus: "uploading" | "processing" | "ready" | "failed";
  error?: string;
  caption?: string;
  uploadedBy: string;
  uploadedByName: string;
  takenDate?: string;
  createdAt: string;
  /** Print queue — PRD 5.9. Photos only. */
  printStatus: "none" | "requested" | "printed";
  printRequestedBy?: string;
  printRequestedByName?: string;
  printedDate?: string;
}

export async function getAlbum(id: string): Promise<Album> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: `ALBUM#${id}`, SK: "META" } }));
  if (!res.Item) throw new ApiError(404, "Album not found");
  return res.Item as Album;
}

/** All media rows of one album (PK = ALBUM#id, SK begins_with MEDIA#), newest first. */
export async function listAlbumMedia(albumId: string): Promise<MediaItem[]> {
  const items: MediaItem[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: { ":pk": `ALBUM#${albumId}`, ":sk": "MEDIA#" },
        ExclusiveStartKey: lastKey,
      })
    );
    items.push(...((res.Items ?? []) as MediaItem[]));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function saveAlbum(a: Album): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: { PK: `ALBUM#${a.id}`, SK: "META", GSI1PK: "ALBUM", GSI1SK: a.title.toLowerCase(), ...a },
    })
  );
}

/** GET /albums — every album with item count and a cover (latest ready item's
 * thumbnail). Whole-type fetch + in-memory grouping, per the repo's scale rules. */
export async function listAlbums(): Promise<Array<Album & { itemCount: number; coverThumbKey: string | null }>> {
  const [albums, media] = await Promise.all([queryType<Album>("ALBUM"), queryType<MediaItem>("MEDIA")]);
  return albums.map((a) => {
    const items = media.filter((m) => m.albumId === a.id);
    const cover = items
      .filter((m) => m.processingStatus === "ready" && m.thumbKey)
      .sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0];
    return { ...a, itemCount: items.length, coverThumbKey: cover?.thumbKey ?? null };
  });
}

/** GET /albums/:id — the album plus its media, newest first (PRD 5.8: newest
 * photo in a reference album is the canonical current-state shot). */
export async function getAlbumWithMedia(id: string): Promise<Album & { items: MediaItem[] }> {
  const album = await getAlbum(id);
  const items = await listAlbumMedia(id);
  return { ...album, items };
}

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** POST /albums — anyone creates trip albums; reference albums are admin-only
 * (PRD 5.8) and require a unique kebab-case slug for deep links. */
export async function createAlbum(caller: Caller, body: { type?: unknown; title?: unknown; slug?: unknown }): Promise<Album> {
  if (body.type !== "trip" && body.type !== "reference") throw new ApiError(400, "type must be trip or reference");
  if (typeof body.title !== "string" || !body.title.trim()) throw new ApiError(400, "title is required");

  let slug: string | undefined;
  if (body.type === "reference") {
    if (!caller.isAdmin) throw new ApiError(403, "Only an admin can create a reference album");
    if (typeof body.slug !== "string" || !SLUG_RE.test(body.slug)) {
      throw new ApiError(400, "reference albums require a kebab-case slug (e.g. fridge, dry-storage)");
    }
    slug = body.slug;
    const existing = await queryType<Album>("ALBUM");
    if (existing.some((a) => a.slug === slug)) throw new ApiError(409, `An album with slug "${slug}" already exists`);
  } else if (body.slug !== undefined) {
    throw new ApiError(400, "slug is only valid for reference albums");
  }

  const a: Album = {
    id: randomUUID(),
    type: body.type,
    ...(slug ? { slug } : {}),
    title: body.title.trim(),
    createdBy: caller.sub,
    createdAt: new Date().toISOString(),
  };
  await saveAlbum(a);
  return a;
}

/** PUT /albums/:id — rename; creator-or-admin. */
export async function updateAlbum(caller: Caller, id: string, body: { title?: unknown }): Promise<Album> {
  const album = await getAlbum(id);
  if (album.createdBy !== caller.sub && !caller.isAdmin) {
    throw new ApiError(403, "Only the album's creator or an admin can edit it");
  }
  if (typeof body.title !== "string" || !body.title.trim()) throw new ApiError(400, "title is required");
  const updated: Album = { ...album, title: body.title.trim() };
  await saveAlbum(updated);
  return updated;
}

/** DELETE /albums/:id — admin only. Cascade delete: removes every media item in
 * the album (original + derivative S3 objects and the DynamoDB rows), then the
 * album row itself. Chosen over "only when empty" so an admin can retire a trip
 * album in one action; originals are gone for good, per PRD 5.8 delete semantics. */
export async function deleteAlbum(caller: Caller, id: string): Promise<void> {
  if (!caller.isAdmin) throw new ApiError(403, "Only an admin can delete an album");
  await getAlbum(id); // 404 before any destructive work
  const items = await listAlbumMedia(id);
  await deleteMediaObjects(items.flatMap((m) => [m.originalKey, m.webKey, m.thumbKey, m.posterKey]));
  for (const m of items) {
    await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK: `ALBUM#${id}`, SK: `MEDIA#${m.id}` } }));
  }
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK: `ALBUM#${id}`, SK: "META" } }));
}
