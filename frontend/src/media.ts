import { useEffect } from "react";
import { api } from "./api";

/**
 * Gallery / print-queue API contract (PRD 5.8, 5.9).
 *
 * The backend for these endpoints is built in parallel — EVERY endpoint path,
 * payload shape, and media-URL convention lives in this one module so any
 * contract mismatch is a one-file fix. Pages import from here only.
 */

export type AlbumType = "trip" | "reference";

export interface Album {
  id: string;
  type: AlbumType;
  slug?: string;
  title: string;
  createdBy: string;
  createdAt: string;
  itemCount: number;
  coverThumbKey?: string;
}

export type ProcessingStatus = "uploading" | "processing" | "ready" | "failed";
export type PrintStatus = "none" | "requested" | "printed";

export interface MediaItem {
  id: string;
  albumId: string;
  mediaType: "photo" | "video";
  webKey?: string;
  thumbKey?: string;
  posterKey?: string;
  processingStatus: ProcessingStatus;
  error?: string;
  caption?: string;
  uploadedBy: string;
  uploadedByName: string;
  takenDate?: string;
  createdAt: string;
  printStatus: PrintStatus;
  printRequestedBy?: string;
  printedDate?: string;
}

export interface AlbumDetail {
  album: Album;
  /** Newest first per contract. */
  items: MediaItem[];
}

export interface PrintQueue {
  requested: MediaItem[];
  printed: MediaItem[];
}

export interface PresignedUpload {
  mediaId: string;
  uploadUrl: string;
}

export const mediaApi = {
  listAlbums: () => api.get<Album[]>("/albums"),
  /** Reference-album creation is admin-only (PRD 5.8) — callers hide the option for members. */
  createAlbum: (body: { type: AlbumType; title: string; slug?: string }) =>
    api.post<Album>("/albums", body),
  getAlbum: (albumId: string) => api.get<AlbumDetail>(`/albums/${albumId}`),
  /** Presigned S3 PUT for the untouched original (PRD 5.8 upload mechanics). */
  presignUpload: (albumId: string, body: { fileName: string; contentType: string }) =>
    api.post<PresignedUpload>(`/albums/${albumId}/media`, body),
  updateMedia: (albumId: string, id: string, body: { caption?: string; takenDate?: string }) =>
    api.put(`/media/${albumId}/${id}`, body),
  /** Uploader-or-admin (PRD 5.8 metadata rules). */
  deleteMedia: (albumId: string, id: string) => api.del(`/media/${albumId}/${id}`),
  requestPrint: (albumId: string, id: string) =>
    api.post(`/media/${albumId}/${id}/print-request`, {}),
  cancelPrintRequest: (albumId: string, id: string) =>
    api.del(`/media/${albumId}/${id}/print-request`),
  /** Admin only (PRD 5.9). */
  markPrinted: (albumId: string, id: string) => api.post(`/media/${albumId}/${id}/printed`, {}),
  getPrintQueue: () => api.get<PrintQueue>("/print-queue"),
};

/** App dates are YYYY-MM-DD strings; tolerate a full ISO timestamp defensively. */
export function fmtDay(d: string): string {
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T12:00:00` : d).toLocaleDateString();
}

/**
 * Media is served same-origin from the private bucket via the /media/* CloudFront
 * behavior, gated by signed cookies (PRD 5.8 viewing). In dev (localhost:5173)
 * these URLs don't resolve — <MediaThumb> degrades to a placeholder tile.
 */
export function mediaUrl(key: string | undefined): string | null {
  return key ? `/media/${key}` : null;
}

/* ---------------------------------------------------------------------------
 * CloudFront signed-cookie session (PRD 5.8 viewing)
 * ------------------------------------------------------------------------- */

interface MediaSession {
  cookies: Record<string, string>;
  /** ISO timestamp (epoch seconds/ms also tolerated defensively). */
  expiresAt: string | number;
}

function expiresAtMs(expiresAt: string | number): number {
  if (typeof expiresAt === "number") return expiresAt > 1e12 ? expiresAt : expiresAt * 1000;
  return Date.parse(expiresAt);
}

/** Fetch signed cookies and install them; returns ms until they expire. */
async function refreshMediaSession(): Promise<number> {
  const session = await api.post<MediaSession>("/media-session", {});
  for (const [name, value] of Object.entries(session.cookies)) {
    document.cookie = `${name}=${value}; Path=/media; Secure; SameSite=Lax`;
  }
  return expiresAtMs(session.expiresAt) - Date.now();
}

/**
 * Keep a media session alive while signed in: fetch cookies on load and
 * re-fetch shortly before they expire. Errors retry on a backoff so a missing
 * backend (dev) or a hiccup never breaks the app — media just shows fallbacks.
 */
export function useMediaSession(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    let cancelled = false;
    const run = async () => {
      let delayMs = 60_000; // retry fallback when the call fails
      try {
        const remainingMs = await refreshMediaSession();
        if (Number.isFinite(remainingMs)) {
          // Refresh 5 minutes early, but never sooner than 1 minute out.
          delayMs = Math.max(60_000, remainingMs - 5 * 60_000);
        }
      } catch {
        // Swallow — see docstring.
      }
      if (!cancelled) timer = window.setTimeout(() => void run(), delayMs);
    };
    void run();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [enabled]);
}

/* ---------------------------------------------------------------------------
 * Upload helpers (PRD 5.8 upload mechanics)
 * ------------------------------------------------------------------------- */

/** iPhone HEIC/MOV files often reach the browser with an empty File.type. */
const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
};

export const UPLOAD_ACCEPT = "image/*,video/*,.heic,.heif,.mov,.mp4,.m4v";

export function fileContentType(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/**
 * PUT the raw original to S3 with the presigned URL. XHR instead of fetch so
 * we get per-file upload progress events.
 */
export function uploadToS3(
  uploadUrl: string,
  file: File,
  contentType: string,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error("Upload failed (network error)"));
    xhr.send(file);
  });
}
