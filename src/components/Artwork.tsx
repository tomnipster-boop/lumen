import { useEffect, useState } from "react";
import { toAssetUrl } from "../lib/assets";

interface ArtworkProps {
  path?: string;
  available?: boolean;
  title: string;
  className?: string;
  alt?: string;
}

export function Artwork({
  path,
  available = true,
  title,
  className = "",
  alt = "",
}: ArtworkProps) {
  const [failed, setFailed] = useState(false);
  const source = available && !failed ? toAssetUrl(path) : undefined;

  useEffect(() => setFailed(false), [path]);

  return (
    <span className={`artwork ${className} ${source ? "" : "artwork--fallback"}`}>
      {source ? (
        <img
          src={source}
          alt={alt}
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="artwork__fallback" aria-label={alt || `${title} has no artwork`}>
          <strong>{title.trim().charAt(0).toUpperCase() || "L"}</strong>
          <small>No artwork</small>
        </span>
      )}
    </span>
  );
}
