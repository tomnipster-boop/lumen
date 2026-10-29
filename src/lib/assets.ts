import { convertFileSrc, isTauri } from "@tauri-apps/api/core";

const WEB_SOURCES = /^(data:|blob:|https?:)/;

export function toAssetUrl(path?: string): string | undefined {
  if (!path) return undefined;
  if (WEB_SOURCES.test(path) || path.startsWith("/art/")) return path;
  return isTauri() ? convertFileSrc(path) : path;
}

export function fileName(path?: string): string {
  if (!path) return "None selected";
  if (path.startsWith("data:")) return "Browser-selected image";
  return path.split(/[\\/]/).pop() || path;
}

export function inferTitleFromScript(path: string): string {
  const filename = fileName(path).replace(/\.sh$/i, "");
  return filename
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
