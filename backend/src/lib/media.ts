import { S3Client, DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

/** Private media bucket (PRD 5.8) — wired by Terraform. Absent in local runs and tests. */
export const MEDIA_BUCKET = process.env.MEDIA_BUCKET || "";

export const s3 = new S3Client({});

/** Every object of one media item lives under these two prefixes (PRD 5.8 key
 * layout), so deleting by prefix also removes derivatives the processing Lambda
 * wrote but had not yet recorded on the row — a real window for video, where
 * MediaConvert output lands minutes after the row is written. */
export function mediaPrefixes(albumId: string, mediaId?: string): string[] {
  const suffix = mediaId ? `${albumId}/${mediaId}/` : `${albumId}/`;
  return [`originals/${suffix}`, `derived/${suffix}`];
}

async function listKeysUnder(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: MEDIA_BUCKET, Prefix: prefix, ContinuationToken: token })
    );
    for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key);
    token = res.NextContinuationToken;
  } while (token);
  return keys;
}

async function deleteKeys(keys: string[]): Promise<void> {
  // DeleteObjects caps at 1000 keys per call; batch defensively.
  for (let i = 0; i < keys.length; i += 1000) {
    const res = await s3.send(
      new DeleteObjectsCommand({
        Bucket: MEDIA_BUCKET,
        Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
      })
    );
    // Quiet mode still returns per-key failures; surfacing them keeps the caller
    // from deleting the DynamoDB row that is the only record the object exists.
    if (res.Errors?.length) {
      const detail = res.Errors.slice(0, 3)
        .map((e) => `${e.Key}: ${e.Code}`)
        .join("; ");
      throw new Error(`Failed to delete ${res.Errors.length} media object(s) — ${detail}`);
    }
  }
}

/** Remove every S3 object belonging to a media item (or a whole album when
 * mediaId is omitted). Falls back to the row's known keys if the bucket cannot
 * be listed, so a missing s3:ListBucket grant degrades instead of failing. */
export async function deleteMediaObjects(
  albumId: string,
  mediaId: string | undefined,
  knownKeys: Array<string | undefined>
): Promise<void> {
  if (!MEDIA_BUCKET) return;
  const fallback = knownKeys.filter((k): k is string => Boolean(k));
  let keys: string[];
  try {
    const listed = await Promise.all(mediaPrefixes(albumId, mediaId).map(listKeysUnder));
    keys = [...new Set([...listed.flat(), ...fallback])];
  } catch (err) {
    console.error("media: prefix listing failed, deleting known keys only", err);
    keys = fallback;
  }
  if (keys.length) await deleteKeys(keys);
}
