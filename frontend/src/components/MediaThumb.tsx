import { useEffect, useState } from "react";
import { mediaUrl, useMediaSessionState } from "../media";

/**
 * Thumbnail image served from the signed-cookie /media/* CloudFront behavior
 * (PRD 5.8 viewing). When the key is missing or the request fails — e.g. local
 * dev where /media/* doesn't resolve — it degrades to a placeholder tile
 * instead of a broken-image icon.
 *
 * Nothing is requested until the signed cookies are installed: without them
 * CloudFront 403s, and the SPA's distribution-wide 403 handler turns that into
 * an index.html body the browser can't decode, which would latch the fallback.
 */
export default function MediaThumb({
  mediaKey,
  alt,
  video = false,
}: {
  mediaKey?: string;
  alt: string;
  video?: boolean;
}) {
  const { status, epoch } = useMediaSessionState();
  const [broken, setBroken] = useState(false);
  // A retried upload or refreshed derivative can change the key, and a new
  // session (epoch bump) makes a previously-403'd request worth retrying.
  useEffect(() => setBroken(false), [mediaKey, epoch]);

  const src = status === "ready" ? mediaUrl(mediaKey, epoch) : null;
  if (!src || broken) {
    return (
      <div className="media-thumb fallback" role="img" aria-label={alt}>
        <span>{video ? "🎞️" : "🖼️"}</span>
      </div>
    );
  }
  return <img className="media-thumb" src={src} alt={alt} loading="lazy" onError={() => setBroken(true)} />;
}
