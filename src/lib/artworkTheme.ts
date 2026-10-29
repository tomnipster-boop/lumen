export interface ThemePalette { accent: string; }
export const DEFAULT_PALETTE: ThemePalette = { accent: "#699dcd" };
export const THEME_TRANSITION_MS = 380;

export function rgbToHsl(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const delta = max - min, lightness = (max + min) / 2;
  if (!delta) return { hue: 0, saturation: 0, lightness };
  const hue = (max === r ? ((g - b) / delta + (g < b ? 6 : 0))
    : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60;
  return { hue, saturation: delta / (1 - Math.abs(2 * lightness - 1)), lightness };
}

export function hslToRgb(hue: number, saturation: number, lightness: number) {
  const a = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    return Math.round(255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [channel(0), channel(8), channel(4)];
}

export function normalizeAccent(hue: number, saturation: number): ThemePalette {
  const rgb = hslToRgb(hue, Math.min(0.68, Math.max(0.42, saturation)), 0.62);
  return { accent: `#${rgb.map(value => value.toString(16).padStart(2, "0")).join("")}` };
}

/** A hue histogram rejects noise and scores broad, chromatic image regions. */
export function extractPalette(pixels: ArrayLike<number>): ThemePalette {
  const clusters = new Map<number, { count: number; weight: number; x: number; y: number; saturation: number }>();
  let opaque = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 180) continue;
    opaque++;
    const { hue, saturation, lightness } = rgbToHsl(pixels[i], pixels[i + 1], pixels[i + 2]);
    if (lightness < 0.09 || lightness > 0.91 || saturation < 0.18) continue;
    const bin = Math.round(hue / 20) % 18;
    const cluster = clusters.get(bin) ?? { count: 0, weight: 0, x: 0, y: 0, saturation: 0 };
    const weight = 0.35 + saturation * (1 - Math.abs(lightness - 0.5));
    cluster.count++;
    cluster.weight += weight;
    cluster.x += Math.cos(hue * Math.PI / 180) * weight;
    cluster.y += Math.sin(hue * Math.PI / 180) * weight;
    cluster.saturation += saturation;
    clusters.set(bin, cluster);
  }
  const candidates = [...clusters.values()].filter(cluster => cluster.count >= Math.max(3, opaque * 0.015));
  candidates.sort((a, b) => b.weight - a.weight);
  const best = candidates[0];
  if (!best) return DEFAULT_PALETTE;
  const hue = (Math.atan2(best.y, best.x) * 180 / Math.PI + 360) % 360;
  return normalizeAccent(hue, best.saturation / best.count);
}

const palettes = new Map<string, Promise<ThemePalette>>();
const MAX_PALETTES = 128;

/** Editing artwork invalidates even when it was replaced at the same path. */
export function invalidateArtworkThemes() { palettes.clear(); }

export function getArtworkPalette(source: string): Promise<ThemePalette> {
  const cached = palettes.get(source);
  if (cached) { palettes.delete(source); palettes.set(source, cached); return cached; }
  const pending: Promise<ThemePalette> = new Promise<ThemePalette>((resolve) => {
    const image = new Image();
    let finished = false;
    const finish = (palette: ThemePalette, failed = false) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      image.onload = image.onerror = null;
      if (failed && palettes.get(source) === pending) palettes.delete(source);
      resolve(palette);
    };
    const timeout = window.setTimeout(() => finish(DEFAULT_PALETTE, true), 6000);
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 48;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) { finish(DEFAULT_PALETTE, true); return; }
        context.drawImage(image, 0, 0, 48, 48);
        finish(extractPalette(context.getImageData(0, 0, 48, 48).data));
      } catch { finish(DEFAULT_PALETTE, true); }
    };
    image.onerror = () => finish(DEFAULT_PALETTE, true);
    image.src = source;
  });
  palettes.set(source, pending);
  if (palettes.size > MAX_PALETTES) palettes.delete(palettes.keys().next().value!);
  return pending;
}
