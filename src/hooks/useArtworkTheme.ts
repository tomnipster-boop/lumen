import { useEffect, useState } from "react";
import { DEFAULT_PALETTE, getArtworkPalette } from "../lib/artworkTheme";

export function useArtworkTheme(source: string, revision: number) {
  const [palette, setPalette] = useState(DEFAULT_PALETTE);
  useEffect(() => {
    let stale = false;
    // Let navigation paint before decoding; repeated input replaces this work.
    const timer = window.setTimeout(() => {
      void getArtworkPalette(source).then(next => { if (!stale) setPalette(next); });
    }, 55);
    return () => { stale = true; window.clearTimeout(timer); };
  }, [revision, source]);
  return palette;
}
