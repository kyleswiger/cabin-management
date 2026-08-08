import { S3Client, DeleteObjectsCommand } from "@aws-sdk/client-s3";

/** Private media bucket (PRD 5.8) — wired by Terraform. Absent in local runs and tests. */
export const MEDIA_BUCKET = process.env.MEDIA_BUCKET || "";

export const s3 = new S3Client({});

/** Best-effort removal of a media item's S3 objects (original + derivatives).
 * Callers pass the known key set from the row; keys the processing Lambda never
 * wrote are simply absent. DeleteObjects tolerates already-deleted keys. */
export async function deleteMediaObjects(keys: Array<string | undefined>): Promise<void> {
  const present = keys.filter((k): k is string => Boolean(k));
  if (!present.length || !MEDIA_BUCKET) return;
  // DeleteObjects caps at 1000 keys per call; batch defensively.
  for (let i = 0; i < present.length; i += 1000) {
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: MEDIA_BUCKET,
        Delete: { Objects: present.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
      })
    );
  }
}
