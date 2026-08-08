/**
 * MediaItem entity (PRD 5.8 Photo Gallery, PRD 5.9 Print Queue, PRD 7 Data Model).
 *
 * Shared contract between the media-processing Lambda (src/media/handler.ts) and the
 * gallery/print-queue API routes — both sides must read and write exactly this shape.
 *
 * DynamoDB layout (single table, see CLAUDE.md "Data model"):
 *   PK     `ALBUM#<albumId>`
 *   SK     `MEDIA#<id>`
 *   GSI1PK `MEDIA`
 *   GSI1SK createdAt (ISO timestamp)
 */
export interface MediaItem {
  id: string;
  albumId: string;
  mediaType: "photo" | "video";
  /** S3 key of the untouched upload: `originals/<albumId>/<id>/original.<ext>` (PRD 5.8). */
  originalKey: string;
  /** Lowercased original file extension, e.g. "heic", "mov", "jpg". */
  originalFormat: string;
  /** Web-size derivative: photos `derived/.../web.jpg`, videos `derived/.../web.mp4`. */
  webKey?: string;
  /** Photo thumbnail derivative `derived/.../thumb.jpg`. */
  thumbKey?: string;
  /** Video poster frame `derived/.../poster.jpg`. */
  posterKey?: string;
  /** Lifecycle: presigned PUT issued → S3 event picked up → derivatives written (or not). */
  processingStatus: "uploading" | "processing" | "ready" | "failed";
  /** Present only when processingStatus is "failed". */
  error?: string;
  caption?: string;
  /** Cognito sub of the uploader. */
  uploadedBy: string;
  uploadedByName: string;
  /** Optional taken-date, YYYY-MM-DD (PRD 5.8 metadata). */
  takenDate?: string;
  createdAt: string;
  /** Print queue (PRD 5.9) — photos only; videos stay "none". */
  printStatus: "none" | "requested" | "printed";
  printRequestedBy?: string;
  printedDate?: string;
}
