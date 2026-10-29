import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

async function pick(options: Parameters<typeof open>[0]): Promise<string | null> {
  if (!isTauri()) return null;
  const selection = await open(options);
  return typeof selection === "string" ? selection : null;
}

export function pickLaunchScript() {
  return pick({
    title: "Choose a game launch script",
    multiple: false,
    directory: false,
    filters: [{ name: "Shell scripts", extensions: ["sh"] }],
  });
}

export function pickArtwork(title: string) {
  return pick({
    title,
    multiple: false,
    directory: false,
    filters: [
      {
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"],
      },
    ],
  });
}

export function pickScriptDirectory() {
  return pick({
    title: "Choose a folder containing launch scripts",
    multiple: false,
    directory: true,
  });
}
