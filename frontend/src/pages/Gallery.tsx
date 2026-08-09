import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../App";
import { branding } from "../branding";
import {
  UPLOAD_ACCEPT,
  fileContentType,
  fmtDay,
  mediaApi,
  mediaUrl,
  uploadToS3,
  useMediaSessionState,
  type AlbumDetail,
  type AlbumSummary,
  type AlbumType,
  type MediaItem,
} from "../media";
import MediaThumb from "../components/MediaThumb";

/** Photo gallery (PRD 5.8): trip albums + reference albums over one media pipeline. */
export default function GalleryPage() {
  const { albumId } = useParams();
  return albumId ? <AlbumDetailView key={albumId} albumId={albumId} /> : <AlbumListView />;
}

/* ---------------------------------------------------------------------------
 * Album list
 * ------------------------------------------------------------------------- */

const EMPTY_ALBUM_FORM = { type: "trip" as AlbumType, title: "", slug: "" };

/** Reference albums are addressed by slug (PRD 5.8 deep links) and the API
 * requires kebab-case, so derive one from the title rather than making the
 * admin guess the format. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function AlbumListView() {
  const { isAdmin } = useAuth();
  const [albums, setAlbums] = useState<AlbumSummary[] | null>(null);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_ALBUM_FORM);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () => mediaApi.listAlbums().then(setAlbums).catch((e) => setError((e as Error).message)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await mediaApi.createAlbum({
        type: form.type,
        title: form.title.trim(),
        // The API requires a kebab-case slug on reference albums and rejects one
        // on trip albums, so fall back to the title-derived slug when blank.
        ...(form.type === "reference"
          ? { slug: slugify(form.slug.trim() || form.title) }
          : {}),
      });
      setForm(EMPTY_ALBUM_FORM);
      setShowCreate(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const trips = (albums ?? []).filter((a) => a.type === "trip");
  const references = (albums ?? []).filter((a) => a.type === "reference");

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Photo gallery</h1>
        <button className="btn" onClick={() => setShowCreate(!showCreate)}>+ New album</button>
      </div>
      {error && <div className="error">{error}</div>}

      {showCreate && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <h2>New album</h2>
          <form onSubmit={create}>
            <div className="row">
              <div className="field">
                <label>Title</label>
                <input
                  value={form.title}
                  placeholder="e.g. July 4th weekend"
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Kind</label>
                {/* Reference-album creation is admin-only (PRD 5.8) — hide the option for members. */}
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as AlbumType })}
                >
                  <option value="trip">Trip album</option>
                  {isAdmin && <option value="reference">Reference album</option>}
                </select>
              </div>
              {form.type === "reference" && (
                <div className="field">
                  <label>Slug</label>
                  <input
                    value={form.slug}
                    placeholder={slugify(form.title) || "e.g. fridge"}
                    onChange={(e) => setForm({ ...form, slug: e.target.value })}
                  />
                  <small className="muted">Used in links; defaults to the title.</small>
                </div>
              )}
            </div>
            <button className="btn" disabled={busy}>Create album</button>
          </form>
        </div>
      )}

      {albums === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="section">
            <h2>Trip albums</h2>
            {trips.length === 0 ? (
              <p className="muted">
                No trip albums yet — start one for your next visit to the {branding.propertyNoun} and fill it with photos.
              </p>
            ) : (
              <div className="album-grid">
                {trips.map((a) => <AlbumCard key={a.id} album={a} />)}
              </div>
            )}
          </div>

          <div className="section">
            <h2>Reference albums</h2>
            <p className="muted">
              {/* PRD 5.8: newest photo in a reference album is the canonical "current state" shot. */}
              Living “current state of X” documentation — the newest photo in each is what it looks like right now.
            </p>
            {references.length === 0 ? (
              <p className="muted">No reference albums yet.</p>
            ) : (
              <div className="album-grid">
                {references.map((a) => <AlbumCard key={a.id} album={a} currentState />)}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

function AlbumCard({ album, currentState = false }: { album: AlbumSummary; currentState?: boolean }) {
  return (
    <Link to={`/gallery/${album.id}`} className="album-card">
      <div className="album-cover">
        <MediaThumb mediaKey={album.coverThumbKey} alt={album.title} />
        {currentState && album.coverThumbKey && <span className="chip in_progress overlay">current state</span>}
      </div>
      <div className="album-meta">
        <strong>{album.title}</strong>
        <span className="muted">
          {album.itemCount} item{album.itemCount === 1 ? "" : "s"}
        </span>
      </div>
    </Link>
  );
}

/* ---------------------------------------------------------------------------
 * Album detail: thumb grid, uploads, lightbox
 * ------------------------------------------------------------------------- */

interface UploadRow {
  id: string;
  name: string;
  percent: number;
  error?: string;
}

const POLL_INTERVAL_MS = 10_000;
/** Long enough for a big video transcode, short enough that a dead upload row
 * doesn't poll forever. */
const POLL_MAX_MS = 30 * 60_000;

function AlbumDetailView({ albumId }: { albumId: string }) {
  const navigate = useNavigate();
  const { me, isAdmin } = useAuth();
  const [data, setData] = useState<AlbumDetail | null>(null);
  const [error, setError] = useState("");
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [albumBusy, setAlbumBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadSeq = useRef(0);

  const load = useCallback(
    () => mediaApi.getAlbum(albumId).then(setData).catch((e) => setError((e as Error).message)),
    [albumId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  // PRD 5.8: items show as "processing" until derivatives land — poll while any are
  // pending. A ready video's poster comes from a separate MediaConvert output that
  // can land after the item flips to ready, so keep polling for that too.
  const items = data?.items ?? [];
  const shouldPoll = items.some(
    (i) =>
      i.processingStatus === "uploading" ||
      i.processingStatus === "processing" ||
      (i.mediaType === "video" && i.processingStatus === "ready" && !i.posterKey),
  );
  useEffect(() => {
    if (!shouldPoll) return;
    // Bounded: an upload whose S3 PUT never completed stays "uploading" forever,
    // and an unbounded interval would poll the API for the life of the tab.
    let elapsedMs = 0;
    const timer = window.setInterval(() => {
      elapsedMs += POLL_INTERVAL_MS;
      if (elapsedMs > POLL_MAX_MS) {
        window.clearInterval(timer);
        return;
      }
      void load();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [shouldPoll, load]);

  const patchUpload = (id: string, patch: Partial<UploadRow>) =>
    setUploads((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const uploadFiles = async (files: File[]) => {
    // Presign → PUT the untouched original to S3 → item appears as "processing" (PRD 5.8).
    await Promise.all(
      files.map(async (file) => {
        const rowId = `u${uploadSeq.current++}`;
        setUploads((rows) => [...rows, { id: rowId, name: file.name, percent: 0 }]);
        try {
          const { uploadUrl, contentType } = await mediaApi.presignUpload(albumId, {
            fileName: file.name,
            contentType: fileContentType(file),
          });
          await uploadToS3(uploadUrl, file, contentType, (percent) => patchUpload(rowId, { percent }));
          setUploads((rows) => rows.filter((r) => r.id !== rowId));
        } catch (err) {
          patchUpload(rowId, { error: (err as Error).message });
        }
      }),
    );
    await load();
  };

  const onFilesPicked = (list: FileList | null) => {
    if (list && list.length > 0) void uploadFiles(Array.from(list));
    if (fileInput.current) fileInput.current.value = "";
  };

  const selected = selectedId ? items.find((i) => i.id === selectedId) ?? null : null;
  const readyItems = items.filter((i) => i.processingStatus === "ready");
  const newestReadyId = data?.type === "reference" ? readyItems[0]?.id : undefined;

  // PUT/DELETE /albums/:id exist on the API but had no UI, so a mistyped album title
  // was permanent and a retired trip album could only be removed out of band.
  // Rename is creator-or-admin and delete is admin-only — mirror the API's rules so
  // the buttons aren't offered where they'd 403.
  const canRename = isAdmin || data?.createdBy === me.id;

  const startRename = () => {
    setRenameTitle(data?.title ?? "");
    setError("");
    setRenaming(true);
  };

  const submitRename = async (e: FormEvent) => {
    e.preventDefault();
    setAlbumBusy(true);
    setError("");
    try {
      await mediaApi.updateAlbum(albumId, { title: renameTitle.trim() });
      setRenaming(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAlbumBusy(false);
    }
  };

  const removeAlbum = async () => {
    // Spelled out because the cascade is irreversible: the album's originals go too.
    const count = items.length;
    const what = count === 0 ? "This album is empty." : `All ${count} item${count === 1 ? "" : "s"} in it, originals included, are deleted for good.`;
    if (!window.confirm(`Delete the album "${data?.title ?? ""}"? ${what}`)) return;
    setAlbumBusy(true);
    setError("");
    try {
      await mediaApi.deleteAlbum(albumId);
      navigate("/gallery");
    } catch (err) {
      setError((err as Error).message);
      setAlbumBusy(false);
    }
  };

  return (
    <>
      <p style={{ margin: "0.25rem 0" }}>
        <Link to="/gallery" className="muted">← All albums</Link>
      </p>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        <h1 style={{ margin: "0.25rem 0 0.75rem" }}>{data ? data.title : "Album"}</h1>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          {data && canRename && !renaming && (
            <button className="btn small secondary" onClick={startRename}>Rename</button>
          )}
          {data && isAdmin && (
            <button className="btn danger small" disabled={albumBusy} onClick={() => void removeAlbum()}>
              Delete album
            </button>
          )}
          <button className="btn" onClick={() => fileInput.current?.click()}>+ Add photos &amp; videos</button>
        </div>
      </div>

      {renaming && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <form onSubmit={submitRename}>
            <div className="field">
              <label>Album title</label>
              <input value={renameTitle} onChange={(e) => setRenameTitle(e.target.value)} required autoFocus />
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button className="btn small" disabled={albumBusy}>Save title</button>
              <button type="button" className="btn small secondary" onClick={() => setRenaming(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}
      {data?.type === "reference" && (
        <p className="muted">
          Reference album — upload a new photo whenever things change; the newest one is treated as the current state.
        </p>
      )}
      {error && <div className="error">{error}</div>}
      <input
        ref={fileInput}
        type="file"
        multiple
        accept={UPLOAD_ACCEPT}
        style={{ display: "none" }}
        onChange={(e) => onFilesPicked(e.target.files)}
      />

      {uploads.length > 0 && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          {uploads.map((u) => (
            <div className="item-row" key={u.id}>
              <div className="grow">
                <strong>{u.name}</strong>
                {u.error ? (
                  <div className="error" style={{ margin: "0.3rem 0 0" }}>{u.error}</div>
                ) : (
                  <div className="progress"><div style={{ width: `${u.percent}%` }} /></div>
                )}
              </div>
              {u.error ? (
                <button
                  className="btn small secondary"
                  onClick={() => setUploads((rows) => rows.filter((r) => r.id !== u.id))}
                >
                  Dismiss
                </button>
              ) : (
                <span className="muted">{u.percent}%</span>
              )}
            </div>
          ))}
        </div>
      )}

      {data && items.length === 0 && uploads.length === 0 && (
        <p className="muted">
          Nothing here yet — add the first photos from your last trip to the {branding.propertyNoun}.
        </p>
      )}

      <div className="media-grid">
        {/* Every tile opens the lightbox, including not-ready ones: a failed
            conversion or an upload whose PUT never finished would otherwise have
            no reachable delete (PRD 5.8 uploader-or-admin delete). */}
        {items.map((item) =>
          item.processingStatus === "ready" ? (
            <button className="media-tile" key={item.id} onClick={() => setSelectedId(item.id)}>
              <MediaThumb
                mediaKey={item.thumbKey ?? item.posterKey}
                alt={item.caption || item.mediaType}
                video={item.mediaType === "video"}
              />
              {item.mediaType === "video" && <span className="tile-play">▶</span>}
              {item.printStatus === "requested" && <span className="chip medium overlay">🖨️ print requested</span>}
              {item.id === newestReadyId && <span className="chip in_progress overlay">current state</span>}
            </button>
          ) : item.processingStatus === "failed" ? (
            <button
              className="media-tile placeholder"
              key={item.id}
              title={item.error}
              onClick={() => setSelectedId(item.id)}
            >
              <span>⚠️</span>
              <span>Processing failed</span>
            </button>
          ) : (
            <button className="media-tile placeholder" key={item.id} onClick={() => setSelectedId(item.id)}>
              <span className="spin">⏳</span>
              <span>Processing…</span>
            </button>
          ),
        )}
      </div>

      {selected && (
        <Lightbox
          item={selected}
          // Prev/next only steps through viewable items.
          items={readyItems}
          onSelect={setSelectedId}
          onClose={() => setSelectedId(null)}
          onChanged={load}
          onDeleted={() => {
            setSelectedId(null);
            void load();
          }}
        />
      )}

      {/* Back out gracefully if the album vanished (deleted in another tab). */}
      {error && !data && (
        <p><button className="linkbtn" onClick={() => navigate("/gallery")}>Back to the gallery</button></p>
      )}
    </>
  );
}

/* ---------------------------------------------------------------------------
 * Lightbox: full-size viewer + caption / print / delete (PRD 5.8, 5.9)
 * ------------------------------------------------------------------------- */

function Lightbox({
  item,
  items,
  onSelect,
  onClose,
  onChanged,
  onDeleted,
}: {
  item: MediaItem;
  items: MediaItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onDeleted: () => void;
}) {
  const { me, isAdmin } = useAuth();
  const { epoch } = useMediaSessionState();
  const [caption, setCaption] = useState(item.caption ?? "");
  const [takenDate, setTakenDate] = useState(item.takenDate ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Re-seed the edit fields when navigating between items.
  useEffect(() => {
    setCaption(item.caption ?? "");
    setTakenDate(item.takenDate ?? "");
    setError("");
  }, [item.id, item.caption, item.takenDate]);

  const index = items.findIndex((i) => i.id === item.id);
  const prev = index > 0 ? items[index - 1] : null;
  const next = index >= 0 && index < items.length - 1 ? items[index + 1] : null;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const metadataDirty = caption !== (item.caption ?? "") || takenDate !== (item.takenDate ?? "");
  const canDelete = isAdmin || item.uploadedBy === me.id;
  const isReady = item.processingStatus === "ready";
  // The API takes print requests on ready photos only, and cancelling is
  // requester-or-admin (PRD 5.9) — don't offer buttons that would 400/403.
  const canPrintRequest = isReady && item.mediaType === "photo";
  const canCancelPrint = isAdmin || item.printRequestedBy === me.id;

  const remove = async () => {
    if (!window.confirm("Delete this from the album? The original is removed too.")) return;
    setBusy(true);
    setError("");
    try {
      await mediaApi.deleteMedia(item.albumId, item.id);
      onDeleted();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const webSrc = isReady ? mediaUrl(item.webKey, epoch) : null;
  return (
    <div className="lightbox" onClick={onClose}>
      <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-media">
          {prev && <button className="lb-nav" onClick={() => onSelect(prev.id)} aria-label="Previous">‹</button>}
          {!isReady ? (
            // Not viewable yet (or never will be) — still reachable so it can be deleted.
            <div className="media-thumb fallback" style={{ minHeight: "40vh", flexDirection: "column", gap: "0.5rem" }}>
              <span>{item.processingStatus === "failed" ? "⚠️" : "⏳"}</span>
              <span className="muted">
                {item.processingStatus === "failed"
                  ? item.error || "Processing failed"
                  : item.processingStatus === "uploading"
                    ? "Waiting for the upload to finish"
                    : "Processing…"}
              </span>
            </div>
          ) : item.mediaType === "video" ? (
            <video controls src={webSrc ?? undefined} poster={mediaUrl(item.posterKey, epoch) ?? undefined} />
          ) : webSrc ? (
            <img src={webSrc} alt={item.caption || "photo"} />
          ) : (
            <div className="media-thumb fallback" style={{ minHeight: "40vh" }}><span>🖼️</span></div>
          )}
          {next && <button className="lb-nav" onClick={() => onSelect(next.id)} aria-label="Next">›</button>}
        </div>

        <div className="lightbox-panel">
          {error && <div className="error">{error}</div>}
          <div className="row" style={{ alignItems: "flex-end" }}>
            <div className="field" style={{ flex: 2, marginBottom: 0 }}>
              <label>Caption</label>
              <input value={caption} placeholder="Add a caption" onChange={(e) => setCaption(e.target.value)} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Taken on</label>
              <input type="date" value={takenDate} onChange={(e) => setTakenDate(e.target.value)} />
            </div>
            {metadataDirty && (
              <button
                className="btn small"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    // takenDate sent unconditionally — "" is the backend's "clear it" signal.
                    mediaApi.updateMedia(item.albumId, item.id, { caption, takenDate }),
                  )
                }
              >
                Save
              </button>
            )}
          </div>

          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.75rem" }}>
            {/* Print queue (PRD 5.9): any member can flag any photo "print this". */}
            {item.printStatus === "printed" ? (
              <span className="chip done">
                🖨️ printed{item.printedDate ? ` ${fmtDay(item.printedDate)}` : ""}
              </span>
            ) : item.printStatus === "requested" ? (
              <>
                <span className="chip medium">
                  🖨️ print requested{item.printRequestedByName ? ` by ${item.printRequestedByName}` : ""}
                </span>
                {canCancelPrint && (
                  <button
                    className="btn small secondary"
                    disabled={busy}
                    onClick={() => void run(() => mediaApi.cancelPrintRequest(item.albumId, item.id))}
                  >
                    Cancel request
                  </button>
                )}
              </>
            ) : (
              canPrintRequest && (
                <button
                  className="btn small secondary"
                  disabled={busy}
                  onClick={() => void run(() => mediaApi.requestPrint(item.albumId, item.id))}
                >
                  🖨️ Print this
                </button>
              )
            )}
            <span className="spacer" style={{ flex: 1 }} />
            {canDelete && (
              <button className="btn danger small" disabled={busy} onClick={() => void remove()}>Delete</button>
            )}
            <button className="btn small secondary" onClick={onClose}>Close</button>
          </div>

          <p className="muted" style={{ marginBottom: 0 }}>
            Uploaded by {item.uploadedByName} · {new Date(item.createdAt).toLocaleDateString()}
          </p>
        </div>
      </div>
    </div>
  );
}
