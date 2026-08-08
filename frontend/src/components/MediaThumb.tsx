import { useEffect, useState } from "react";
import { mediaUrl } from "../media";

/**
 * Thumbnail image served from the signed-cookie /media/* CloudFront behavior
 * (PRD 5.8 viewing). When the key is missing or the request fails — e.g. local
 * dev where /media/* doesn't resolve — it degrades to a placeholder tile
 * instead of a broken-image icon.
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
  const [broken, setBroken] = useState(false);
  // A retried upload or refreshed derivative can change the key — reset the fallback.
  useEffect(() => setBroken(false), [mediaKey]);

  const src = mediaUrl(mediaKey);
  if (!src || broken) {
    return (
      <div className="media-thumb fallback" role="img" aria-label={alt}>
        <span>{video ? "🎞️" : "🖼️"}</span>
      </div>
    );
  }
  return <img className="media-thumb" src={src} alt={alt} loading="lazy" onError={() => setBroken(true)} />;
}
