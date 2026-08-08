import { createRequire } from "node:module";
import type { S3Event } from "aws-lambda";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { MediaConvertClient, DescribeEndpointsCommand, CreateJobCommand } from "@aws-sdk/client-mediaconvert";
import type { OutputGroup } from "@aws-sdk/client-mediaconvert";
import { ddb, GetCommand, UpdateCommand, TABLE } from "../lib/db.js";
import type { SharpConstructor } from "sharp";
import type { MediaItem } from "../types/media.js";

/**
 * sharp comes from the custom Lambda layer (backend/layers/sharp-heif — libvips compiled
 * with libheif for HEIC/HEIF decode, PRD 5.8) at /opt/nodejs/node_modules, so it must NOT
 * be bundled (esbuild marks it external). Lambda only exposes /opt/nodejs/node_modules via
 * NODE_PATH, which ESM `import` ignores — CJS require() honors it, hence createRequire.
 */
const requireFromLayer = createRequire(import.meta.url);
// sharp's CJS entry is `module.exports = Sharp` — the constructor itself.
const sharp = requireFromLayer("sharp") as SharpConstructor;

const MEDIA_BUCKET = process.env.MEDIA_BUCKET!;
const MEDIACONVERT_ROLE_ARN = process.env.MEDIACONVERT_ROLE_ARN!;

const s3 = new S3Client({});

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "heic", "heif", "webp"]);
const VIDEO_EXTS = new Set(["mov", "mp4", "m4v", "hevc"]);

// Key shapes this Lambda reacts to (PRD 5.8). Anything else under the bucket —
// including the web.jpg/thumb.jpg/poster.jpg derivatives this Lambda writes itself —
// deliberately matches nothing, so recursive invocations are inert.
const ORIGINAL_KEY = /^originals\/([^/]+)\/([^/]+)\/original\.([A-Za-z0-9]+)$/;
const DERIVED_WEB_MP4 = /^derived\/([^/]+)\/([^/]+)\/web\.mp4$/;
const DERIVED_POSTER_SEQ = /^derived\/([^/]+)\/([^/]+)\/poster\.\d+\.jpg$/;

/**
 * Media-processing Lambda (PRD 5.8). Invoked by S3 events on the private media bucket:
 *
 *  - `originals/<albumId>/<mediaId>/original.<ext>` — a fresh upload. Photos are derived
 *    inline with sharp; videos go to MediaConvert (async).
 *  - `derived/<albumId>/<mediaId>/web.mp4` — the video derivative landed (MediaConvert
 *    output, or our own copy for already-web-playable originals). This second invocation
 *    is how the async video pipeline completes: it flips the row to "ready".
 *  - `derived/<albumId>/<mediaId>/poster.<seq>.jpg` — MediaConvert frame capture always
 *    appends a sequence number; promote it to the canonical `poster.jpg`.
 *
 * Never throws unhandled: any failure marks the row processingStatus "failed" with an
 * `error` field so the gallery UI can surface it instead of spinning forever.
 */
export async function handler(event: S3Event): Promise<void> {
  for (const record of event.Records ?? []) {
    // S3 event keys are URL-encoded with '+' for spaces.
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
    const size = record.s3.object.size ?? 0;
    try {
      await route(key, size);
    } catch (err) {
      console.error(`media: processing failed for ${key}:`, err);
      const original = ORIGINAL_KEY.exec(key);
      if (original) {
        const message = err instanceof Error ? err.message : String(err);
        await markFailed(original[1], original[2], message).catch((e) =>
          console.error(`media: could not mark ${key} failed:`, e)
        );
      }
    }
  }
}

async function route(key: string, size: number): Promise<void> {
  let m: RegExpExecArray | null;
  if ((m = ORIGINAL_KEY.exec(key))) return processOriginal(m[1], m[2], m[3].toLowerCase(), key, size);
  if ((m = DERIVED_WEB_MP4.exec(key))) return finalizeVideo(m[1], m[2], key);
  if ((m = DERIVED_POSTER_SEQ.exec(key))) return promotePoster(m[1], m[2], key);
  console.log(`media: ignoring key ${key} (no matching route)`);
}

// ---------------------------------------------------------------------------
// Originals
// ---------------------------------------------------------------------------

async function processOriginal(albumId: string, mediaId: string, ext: string, key: string, size: number): Promise<void> {
  const item = await getMediaItem(albumId, mediaId);
  if (!item) {
    // Stray upload with no row (e.g. presign flow abandoned mid-way) — nothing to update.
    console.warn(`media: no MediaItem row for ${key}; skipping`);
    return;
  }
  await updateMedia(albumId, mediaId, { processingStatus: "processing" }, ["error"]);

  if (IMAGE_EXTS.has(ext)) {
    await processImage(albumId, mediaId, key);
  } else if (VIDEO_EXTS.has(ext)) {
    await processVideo(albumId, mediaId, ext, key, size);
  } else {
    await markFailed(albumId, mediaId, `Unsupported media format: .${ext}`);
  }
}

/**
 * PRD 5.8: photos get a web-size JPEG (~2560px long edge) + thumbnail, written next to
 * the original under derived/. sharp decodes HEIC/HEIF via the layer's libvips+libheif.
 */
async function processImage(albumId: string, mediaId: string, key: string): Promise<void> {
  const obj = await s3.send(new GetObjectCommand({ Bucket: MEDIA_BUCKET, Key: key }));
  const buffer = Buffer.from(await obj.Body!.transformToByteArray());

  // .rotate() with no args applies the EXIF orientation, then strips it — the derived
  // JPEGs are upright without relying on viewer EXIF handling.
  const base = sharp(buffer, { failOn: "none" }).rotate();
  const derive = (longEdge: number, quality: number) =>
    base
      .clone()
      .resize(longEdge, longEdge, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
  const [web, thumb] = await Promise.all([derive(2560, 82), derive(400, 82)]);

  const webKey = `derived/${albumId}/${mediaId}/web.jpg`;
  const thumbKey = `derived/${albumId}/${mediaId}/thumb.jpg`;
  await Promise.all([
    s3.send(new PutObjectCommand({ Bucket: MEDIA_BUCKET, Key: webKey, Body: web, ContentType: "image/jpeg" })),
    s3.send(new PutObjectCommand({ Bucket: MEDIA_BUCKET, Key: thumbKey, Body: thumb, ContentType: "image/jpeg" })),
  ]);
  await updateMedia(albumId, mediaId, { webKey, thumbKey, processingStatus: "ready" }, ["error"]);
}

// ---------------------------------------------------------------------------
// Videos (PRD 5.8: poster frame always; H.264 MP4 only when not already web-playable)
// ---------------------------------------------------------------------------

async function processVideo(albumId: string, mediaId: string, ext: string, key: string, size: number): Promise<void> {
  const destPrefix = `derived/${albumId}/${mediaId}`;
  const alreadyWebPlayable = (ext === "mp4" || ext === "m4v") && (await sniffIsH264Mp4(key, size));

  // Poster frame comes from MediaConvert's frame-capture output group either way.
  // Frame capture cannot emit `poster.jpg` directly (it always appends a sequence
  // number), so the DERIVED_POSTER_SEQ route promotes poster.0000000.jpg afterwards.
  const outputGroups: OutputGroup[] = [posterOutputGroup(destPrefix)];
  if (!alreadyWebPlayable) outputGroups.push(webMp4OutputGroup(destPrefix));

  const mc = await getMediaConvert();
  await mc.send(
    new CreateJobCommand({
      Role: MEDIACONVERT_ROLE_ARN,
      UserMetadata: { albumId, mediaId },
      Settings: {
        Inputs: [
          {
            FileInput: `s3://${MEDIA_BUCKET}/${key}`,
            TimecodeSource: "ZEROBASED",
            // AUTO applies the container rotation metadata (portrait iPhone clips).
            VideoSelector: { Rotate: "AUTO" },
            AudioSelectors: { "Audio Selector 1": { DefaultSelection: "DEFAULT" } },
          },
        ],
        OutputGroups: outputGroups,
      },
    })
  );

  if (alreadyWebPlayable) {
    // Skip the transcode: copy the original to web.mp4. The copy raises the same
    // derived/ web.mp4 S3 event as a MediaConvert output would, so completion is
    // uniform — finalizeVideo() flips the row to "ready" (PRD 5.8).
    await s3.send(
      new CopyObjectCommand({
        Bucket: MEDIA_BUCKET,
        CopySource: `${MEDIA_BUCKET}/${encodeURIComponent(key).replace(/%2F/g, "/")}`,
        Key: `${destPrefix}/web.mp4`,
        ContentType: "video/mp4",
        MetadataDirective: "REPLACE",
      })
    );
  }
  // Row stays "processing" until the derived/ web.mp4 event arrives. Known gap: if the
  // MediaConvert job itself fails, no S3 event fires and the row stays "processing" —
  // surfacing job-state-change events via EventBridge is future hardening (PRD 5.8).
}

/** Second S3-event invocation on derived/<albumId>/<mediaId>/web.mp4 — the video is ready. */
async function finalizeVideo(albumId: string, mediaId: string, webKey: string): Promise<void> {
  const item = await getMediaItem(albumId, mediaId);
  if (!item) {
    console.warn(`media: no MediaItem row for ${webKey}; skipping finalize`);
    return;
  }
  const posterKey = `derived/${albumId}/${mediaId}/poster.jpg`;
  // The poster may or may not have been promoted yet (frame capture is a separate,
  // usually-faster output; but in the copy path the mp4 lands before the job runs).
  // promotePoster() fills posterKey whenever it arrives, so "ready" never waits on it.
  const hasPoster = await objectExists(posterKey);
  await updateMedia(
    albumId,
    mediaId,
    { webKey, processingStatus: "ready", ...(hasPoster ? { posterKey } : {}) },
    ["error"]
  );
}

/** Promote MediaConvert's poster.<seq>.jpg to the canonical poster.jpg (PRD 5.8). */
async function promotePoster(albumId: string, mediaId: string, seqKey: string): Promise<void> {
  const posterKey = `derived/${albumId}/${mediaId}/poster.jpg`;
  await s3.send(
    new CopyObjectCommand({
      Bucket: MEDIA_BUCKET,
      CopySource: `${MEDIA_BUCKET}/${seqKey}`,
      Key: posterKey,
      ContentType: "image/jpeg",
      MetadataDirective: "REPLACE",
    })
  );
  await s3.send(new DeleteObjectCommand({ Bucket: MEDIA_BUCKET, Key: seqKey }));
  // Only set posterKey — processingStatus belongs to the web.mp4 completion path.
  await updateMedia(albumId, mediaId, { posterKey });
}

/**
 * Heuristic H.264 sniff without an ffprobe dependency: scan the head and tail of the
 * MP4 (the moov box lives at one end or the other) for codec sample-entry fourccs.
 * Only returns true when an AVC entry is present and no HEVC/AV1 entry is — anything
 * ambiguous transcodes, which is always safe, just slower.
 */
async function sniffIsH264Mp4(key: string, size: number): Promise<boolean> {
  const window = 1024 * 1024;
  const ranges = [`bytes=0-${Math.min(window, size) - 1}`];
  if (size > window) ranges.push(`bytes=${Math.max(size - window, window)}-${size - 1}`);
  const chunks = await Promise.all(
    ranges.map(async (range) => {
      const res = await s3.send(new GetObjectCommand({ Bucket: MEDIA_BUCKET, Key: key, Range: range }));
      return Buffer.from(await res.Body!.transformToByteArray());
    })
  );
  const haystack = Buffer.concat(chunks);
  const has = (fourcc: string) => haystack.includes(fourcc, 0, "latin1");
  if (has("hvc1") || has("hev1") || has("av01")) return false;
  return has("avc1");
}

// ---------------------------------------------------------------------------
// MediaConvert
// ---------------------------------------------------------------------------

let mediaConvert: MediaConvertClient | undefined;

/** MediaConvert needs its account-specific endpoint, discovered once per container. */
async function getMediaConvert(): Promise<MediaConvertClient> {
  if (!mediaConvert) {
    const probe = new MediaConvertClient({});
    const res = await probe.send(new DescribeEndpointsCommand({ MaxResults: 1 }));
    const endpoint = res.Endpoints?.[0]?.Url;
    if (!endpoint) throw new Error("MediaConvert DescribeEndpoints returned no endpoint");
    mediaConvert = new MediaConvertClient({ endpoint });
  }
  return mediaConvert;
}

/** H.264 MP4 web derivative — QVBR, source resolution, AAC stereo (PRD 5.8). */
function webMp4OutputGroup(destPrefix: string): OutputGroup {
  return {
    Name: "web-mp4",
    OutputGroupSettings: {
      Type: "FILE_GROUP_SETTINGS",
      FileGroupSettings: { Destination: `s3://${MEDIA_BUCKET}/${destPrefix}/web` },
    },
    Outputs: [
      {
        ContainerSettings: { Container: "MP4" },
        VideoDescription: {
          CodecSettings: {
            Codec: "H_264",
            H264Settings: {
              RateControlMode: "QVBR",
              QvbrSettings: { QvbrQualityLevel: 7 },
              MaxBitrate: 6_000_000,
              SceneChangeDetect: "ENABLED",
            },
          },
        },
        AudioDescriptions: [
          {
            AudioSourceName: "Audio Selector 1",
            CodecSettings: {
              Codec: "AAC",
              AacSettings: { Bitrate: 128_000, CodingMode: "CODING_MODE_2_0", SampleRate: 48_000 },
            },
          },
        ],
      },
    ],
  };
}

/** Single poster frame at t=0; MediaConvert names it poster.0000000.jpg (promoted later). */
function posterOutputGroup(destPrefix: string): OutputGroup {
  return {
    Name: "poster",
    OutputGroupSettings: {
      Type: "FILE_GROUP_SETTINGS",
      FileGroupSettings: { Destination: `s3://${MEDIA_BUCKET}/${destPrefix}/poster` },
    },
    Outputs: [
      {
        ContainerSettings: { Container: "RAW" },
        VideoDescription: {
          CodecSettings: {
            Codec: "FRAME_CAPTURE",
            FrameCaptureSettings: { FramerateNumerator: 1, FramerateDenominator: 1, MaxCaptures: 1, Quality: 80 },
          },
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// DynamoDB helpers (single-table layout, see src/types/media.ts)
// ---------------------------------------------------------------------------

async function getMediaItem(albumId: string, mediaId: string): Promise<MediaItem | undefined> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { PK: `ALBUM#${albumId}`, SK: `MEDIA#${mediaId}` } })
  );
  return res.Item as MediaItem | undefined;
}

/**
 * Partial update of the MediaItem row. Attribute names are aliased throughout because
 * "error" is a DynamoDB reserved word. Condition guards against resurrecting a row the
 * API deleted mid-processing.
 */
async function updateMedia(
  albumId: string,
  mediaId: string,
  set: Partial<MediaItem>,
  remove: (keyof MediaItem)[] = []
): Promise<void> {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets = Object.entries(set).map(([k, v], i) => {
    names[`#s${i}`] = k;
    values[`:s${i}`] = v;
    return `#s${i} = :s${i}`;
  });
  const removes = remove.map((k, i) => {
    names[`#r${i}`] = k;
    return `#r${i}`;
  });
  const expression = [
    sets.length ? `SET ${sets.join(", ")}` : "",
    removes.length ? `REMOVE ${removes.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: `ALBUM#${albumId}`, SK: `MEDIA#${mediaId}` },
        UpdateExpression: expression,
        ConditionExpression: "attribute_exists(PK)",
        ExpressionAttributeNames: names,
        ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
      })
    );
  } catch (err) {
    if (err instanceof Error && err.name === "ConditionalCheckFailedException") {
      console.warn(`media: MediaItem ${albumId}/${mediaId} no longer exists; skipping update`);
      return;
    }
    throw err;
  }
}

async function markFailed(albumId: string, mediaId: string, message: string): Promise<void> {
  await updateMedia(albumId, mediaId, { processingStatus: "failed", error: message });
}

async function objectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: MEDIA_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}
