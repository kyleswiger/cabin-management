import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../App";
import { branding } from "../branding";
import { fmtDay, mediaApi, type MediaItem, type PrintQueue } from "../media";
import MediaThumb from "../components/MediaThumb";

/**
 * Print queue (PRD 5.9): photos flagged "print this" from the gallery, worked
 * through by whoever has the printer between trips. Printed history below is
 * the record of what's already in the physical album.
 */
export default function PrintsPage() {
  const { isAdmin } = useAuth();
  const [queue, setQueue] = useState<PrintQueue | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () => mediaApi.getPrintQueue().then(setQueue).catch((e) => setError((e as Error).message)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const thumbLink = (item: MediaItem) => (
    <Link to={`/gallery/${item.albumId}`} className="print-thumb" title="Open album">
      <MediaThumb
        mediaKey={item.thumbKey ?? item.posterKey}
        alt={item.caption || item.mediaType}
        video={item.mediaType === "video"}
      />
    </Link>
  );

  return (
    <>
      <h1>Print queue</h1>
      <p className="muted">
        Photos flagged for the physical {branding.propertyNoun} album. Flag more from the <Link to="/gallery">gallery</Link>.
      </p>
      {error && <div className="error">{error}</div>}
      {queue === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="section">
            <h2>Waiting to be printed ({queue.requested.length})</h2>
            {queue.requested.length === 0 ? (
              <p className="muted">Nothing in the queue — the physical album is all caught up. 🎉</p>
            ) : (
              <div className="card">
                {queue.requested.map((item) => (
                  <div className="item-row" key={item.id}>
                    {thumbLink(item)}
                    <div className="grow">
                      <strong>{item.caption || "Untitled photo"}</strong>
                      <div className="muted">
                        {item.printRequestedBy ? <>Asked for by {item.printRequestedBy} · </> : null}
                        uploaded by {item.uploadedByName}
                      </div>
                    </div>
                    {/* Marking printed is admin-only (PRD 5.9 — printer-owner workflow). */}
                    {isAdmin && (
                      <>
                        <button
                          className="btn small"
                          disabled={busy}
                          onClick={() => void run(() => mediaApi.markPrinted(item.albumId, item.id))}
                        >
                          Mark printed
                        </button>
                        <button
                          className="btn small secondary"
                          disabled={busy}
                          onClick={() => void run(() => mediaApi.cancelPrintRequest(item.albumId, item.id))}
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="section">
            <h2>Already printed ({queue.printed.length})</h2>
            <p className="muted">What's in the physical album — check here before requesting a duplicate.</p>
            {queue.printed.length === 0 ? (
              <p className="muted">Nothing printed yet.</p>
            ) : (
              <div className="card">
                {queue.printed.map((item) => (
                  <div className="item-row" key={item.id}>
                    {thumbLink(item)}
                    <div className="grow">
                      <strong>{item.caption || "Untitled photo"}</strong>
                      <div className="muted">uploaded by {item.uploadedByName}</div>
                    </div>
                    <span className="chip done">
                      printed{item.printedDate ? ` ${fmtDay(item.printedDate)}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
