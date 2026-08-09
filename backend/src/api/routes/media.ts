import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getSignedCookies } from "@aws-sdk/cloudfront-signer";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { ddb, GetCommand, PutCommand, DeleteCommand, TABLE, queryType } from "../../lib/db.js";
import { ApiError, assertDate, todayISO, type Caller } from "../../lib/http.js";
import { getProfile } from "../../lib/users.js";
import { deleteMediaObjects, MEDIA_BUCKET, s3 } from "../../lib/media.js";
import { getAlbum, type Album, type MediaItem } from "./albums.js";

// ---------------------------------------------------------------------------
// Media items — PRD 5.8
// ---------------------------------------------------------------------------

/** Originals are uploaded untouched in their native format (PRD 5.8): iPhone
 * HEIC/HEIF and MOV included. The processing Lambda produces the web derivatives. */
const PHOTO_EXTS = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif"]);
const VIDEO_EXTS = new Set(["mov", "mp4", "m4v"]);

/** ContentType is always derived server-side from the validated extension —
 * never from the client. /media/* is served same-origin with the SPA, so a
 * client-chosen text/html would be a stored XSS on the app's own origin. */
const EXT_CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  mov: "video/quicktime",
  mp4: "video/mp4",
  m4v: "video/mp4",
};

const UPLOAD_URL_TTL_SECONDS = 15 * 60;

async function getMediaItem(albumId: string, id: string): Promise<MediaItem> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: `ALBUM#${albumId}`, SK: `MEDIA#${id}` } }));
  if (!res.Item) throw new ApiError(404, "Media item not found");
  return res.Item as MediaItem;
}

async function saveMediaItem(m: MediaItem): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      // Spread first, as in albums/guestbook/treks: every caller except
      // requestUpload() re-reads the row with getMediaItem(), which hands back the
      // raw DynamoDB item — PK/SK/GSI1PK/GSI1SK included. Spreading last let those
      // stale copies win over the freshly computed keys.
      Item: { ...m, PK: `ALBUM#${m.albumId}`, SK: `MEDIA#${m.id}`, GSI1PK: "MEDIA", GSI1SK: m.createdAt },
    })
  );
}

/** POST /albums/:id/media — create the MediaItem row ("uploading") and hand the
 * browser a presigned S3 PUT for the untouched original (PRD 5.8). The S3 upload
 * event then triggers the processing Lambda, which owns every later
 * processingStatus transition and the derivative keys. */
export async function requestUpload(
  caller: Caller,
  albumId: string,
  body: { fileName?: unknown; contentType?: unknown } // contentType accepted but ignored — see EXT_CONTENT_TYPES
): Promise<{ mediaId: string; uploadUrl: string; contentType: string }> {
  await getAlbum(albumId); // 404 for unknown album
  if (typeof body.fileName !== "string" || !body.fileName.trim()) throw new ApiError(400, "fileName is required");
  if (!MEDIA_BUCKET) throw new ApiError(500, "Media storage is not configured for this deployment");

  const ext = body.fileName.split(".").pop()?.toLowerCase() ?? "";
  const isPhoto = PHOTO_EXTS.has(ext);
  if (!isPhoto && !VIDEO_EXTS.has(ext)) {
    throw new ApiError(400, `Unsupported file type ".${ext}" — allowed: ${[...PHOTO_EXTS, ...VIDEO_EXTS].join(", ")}`);
  }

  const id = randomUUID();
  const profile = await getProfile(caller.sub);
  const m: MediaItem = {
    id,
    albumId,
    mediaType: isPhoto ? "photo" : "video",
    originalKey: `originals/${albumId}/${id}/original.${ext}`,
    originalFormat: ext,
    processingStatus: "uploading",
    uploadedBy: caller.sub,
    uploadedByName: profile?.name ?? caller.name,
    createdAt: new Date().toISOString(),
    printStatus: "none",
  };
  await saveMediaItem(m);

  const contentType = EXT_CONTENT_TYPES[ext];
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: MEDIA_BUCKET, Key: m.originalKey, ContentType: contentType }),
    { expiresIn: UPLOAD_URL_TTL_SECONDS }
  );
  // The browser must PUT with this exact Content-Type — it's part of the signature.
  return { mediaId: id, uploadUrl, contentType };
}

/** PUT /media/:albumId/:id — caption/taken-date metadata; uploader-or-admin (PRD 5.8). */
export async function updateMediaItem(
  caller: Caller,
  albumId: string,
  id: string,
  body: { caption?: unknown; takenDate?: unknown }
): Promise<MediaItem> {
  const item = await getMediaItem(albumId, id);
  if (item.uploadedBy !== caller.sub && !caller.isAdmin) {
    throw new ApiError(403, "Only the uploader or an admin can edit this item");
  }
  const updated: MediaItem = { ...item };
  if (body.caption !== undefined) {
    if (typeof body.caption !== "string") throw new ApiError(400, "caption must be a string");
    updated.caption = body.caption;
  }
  if (body.takenDate !== undefined) {
    updated.takenDate = body.takenDate === null || body.takenDate === "" ? undefined : assertDate(body.takenDate, "takenDate");
  }
  await saveMediaItem(updated);
  return updated;
}

/** DELETE /media/:albumId/:id — uploader-or-admin; removes original +
 * derivatives from S3 and the row (PRD 5.8). */
export async function deleteMediaItem(caller: Caller, albumId: string, id: string): Promise<void> {
  const item = await getMediaItem(albumId, id);
  if (item.uploadedBy !== caller.sub && !caller.isAdmin) {
    throw new ApiError(403, "Only the uploader or an admin can delete this item");
  }
  await deleteMediaObjects(albumId, id, [item.originalKey, item.webKey, item.thumbKey, item.posterKey]);
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK: `ALBUM#${albumId}`, SK: `MEDIA#${id}` } }));
}

// ---------------------------------------------------------------------------
// Print queue — PRD 5.9
// ---------------------------------------------------------------------------

/** POST /media/:albumId/:id/print-request — any member flags a photo for the
 * physical album. Photos only, and only once processing succeeded. */
export async function requestPrint(caller: Caller, albumId: string, id: string): Promise<MediaItem> {
  const item = await getMediaItem(albumId, id);
  if (item.mediaType !== "photo") throw new ApiError(400, "Only photos can be printed");
  if (item.processingStatus !== "ready") throw new ApiError(400, "Photo is still processing");
  if (item.printStatus === "requested") throw new ApiError(409, "Print already requested");
  if (item.printStatus === "printed") throw new ApiError(409, "Photo has already been printed");
  const profile = await getProfile(caller.sub);
  const updated: MediaItem = {
    ...item,
    printStatus: "requested",
    printRequestedBy: caller.sub,
    printRequestedByName: profile?.name ?? caller.name,
  };
  await saveMediaItem(updated);
  return updated;
}

/** DELETE /media/:albumId/:id/print-request — requester-or-admin withdraws the flag. */
export async function cancelPrintRequest(caller: Caller, albumId: string, id: string): Promise<MediaItem> {
  const item = await getMediaItem(albumId, id);
  if (item.printStatus !== "requested") throw new ApiError(400, "No pending print request for this photo");
  if (item.printRequestedBy !== caller.sub && !caller.isAdmin) {
    throw new ApiError(403, "Only the requester or an admin can cancel a print request");
  }
  const updated: MediaItem = { ...item, printStatus: "none", printRequestedBy: undefined, printRequestedByName: undefined };
  await saveMediaItem(updated); // removeUndefinedValues drops the cleared fields
  return updated;
}

/** POST /media/:albumId/:id/printed — admin marks it printed; date logged
 * automatically (PRD 5.9), becoming the record of what's in the physical album. */
export async function markPrinted(caller: Caller, albumId: string, id: string): Promise<MediaItem> {
  if (!caller.isAdmin) throw new ApiError(403, "Only an admin can mark a photo printed");
  const item = await getMediaItem(albumId, id);
  if (item.printStatus !== "requested") throw new ApiError(400, "Photo is not in the print queue");
  const updated: MediaItem = { ...item, printStatus: "printed", printedDate: todayISO() };
  await saveMediaItem(updated);
  return updated;
}

/** GET /print-queue — pending requests plus printed history (PRD 5.9), each item
 * annotated with its album title for display. GSI1 fetch + in-memory filter. */
export async function getPrintQueue(): Promise<{
  requested: Array<MediaItem & { albumTitle: string }>;
  printed: Array<MediaItem & { albumTitle: string }>;
}> {
  const [media, albums] = await Promise.all([queryType<MediaItem>("MEDIA"), queryType<Album>("ALBUM")]);
  const titles = new Map(albums.map((a) => [a.id, a.title]));
  const annotate = (m: MediaItem) => ({ ...m, albumTitle: titles.get(m.albumId) ?? "" });
  return {
    requested: media
      .filter((m) => m.printStatus === "requested")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(annotate),
    printed: media
      .filter((m) => m.printStatus === "printed")
      .sort((a, b) => (b.printedDate ?? "").localeCompare(a.printedDate ?? "") || b.createdAt.localeCompare(a.createdAt))
      .map(annotate),
  };
}

// ---------------------------------------------------------------------------
// Media session — CloudFront signed cookies (PRD 5.8 "Viewing")
// ---------------------------------------------------------------------------

/** Wired by Terraform. MEDIA_SITE_URL always points at the distribution serving
 * /media/* (custom domain when configured, else the CloudFront domain); SITE_URL
 * is kept as a fallback but is empty on custom-domain-less deployments. */
const SITE_URL = process.env.MEDIA_SITE_URL || process.env.SITE_URL || "";
const CF_KEY_PAIR_ID = process.env.MEDIA_CF_KEY_PAIR_ID || "";
const CF_PRIVATE_KEY_PARAM = process.env.MEDIA_CF_PRIVATE_KEY_PARAM || "";

const SESSION_TTL_SECONDS = 12 * 60 * 60;

/** The RSA signing key lives in SSM (SecureString); cache it across warm
 * invocations so a session issue is one SSM read per cold start, not per call.
 *
 * The cache expires so key rotation converges on its own: without a TTL a warm
 * container would keep signing with the retired key while CloudFront trusts only
 * the new one, handing out cookies that 403 for the life of that container
 * (scripts/media-cf-keys.sh documents the rotation sequence). */
const PRIVATE_KEY_TTL_MS = 5 * 60_000;
let cachedPrivateKey: { key: string; fetchedAtMs: number } | undefined;

async function getPrivateKey(): Promise<string> {
  if (cachedPrivateKey && Date.now() - cachedPrivateKey.fetchedAtMs < PRIVATE_KEY_TTL_MS) {
    return cachedPrivateKey.key;
  }
  const ssm = new SSMClient({});
  const res = await ssm.send(new GetParameterCommand({ Name: CF_PRIVATE_KEY_PARAM, WithDecryption: true }));
  const key = res.Parameter?.Value;
  if (!key) throw new ApiError(500, "Media signing key is not configured");
  cachedPrivateKey = { key, fetchedAtMs: Date.now() };
  return key;
}

/** POST /media-session — issues CloudFront signed cookies scoped to /media/* for
 * ~12h (PRD 5.8: one auth decision per session, full CDN caching). Returned in
 * the body — the SPA sets them via document.cookie with Path=/media, because the
 * cross-origin dev server makes a Set-Cookie header impractical. */
export async function createMediaSession(): Promise<{ cookies: Record<string, string>; expiresAt: string }> {
  if (!SITE_URL || !CF_KEY_PAIR_ID || !CF_PRIVATE_KEY_PARAM) {
    throw new ApiError(500, "Media serving is not configured for this deployment");
  }
  const expiresEpoch = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const policy = JSON.stringify({
    Statement: [
      {
        // Deliberately the whole distribution, not `/media/*`: a viewer-request
        // CloudFront Function rewrites /media/<key> → /<key> (infra/media.tf), and
        // AWS does not document whether signature validation sees the URI before
        // or after that rewrite. A `/media/*` resource would 403 every request if
        // it validates after. Nothing is over-granted — /media/* is the only
        // behavior with a trusted key group, so it is the only path a cookie gates.
        Resource: `${SITE_URL}/*`,
        Condition: { DateLessThan: { "AWS:EpochTime": expiresEpoch } },
      },
    ],
  });
  const cookies = getSignedCookies({ policy, keyPairId: CF_KEY_PAIR_ID, privateKey: await getPrivateKey() });
  return { cookies: cookies as unknown as Record<string, string>, expiresAt: new Date(expiresEpoch * 1000).toISOString() };
}
