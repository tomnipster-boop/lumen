export type WallpaperMode = "dynamic" | "static";
export type ControllerScrollMode = "rotation" | "horizontal";
export type AccentTheme =
  | "dark-purple"
  | "pink"
  | "red"
  | "light-blue"
  | "dark-blue";

export interface LauncherSettings {
  theme: AccentTheme;
  wallpaperMode: WallpaperMode;
  staticWallpaperPath?: string;
  parallaxEnabled: boolean;
  backgroundBlur: number;
  vignetteStrength: number;
  controllerScrollMode: ControllerScrollMode;
  fullscreenPreferred: boolean;
  gameAudioOutput?: string;
  lumenBrightness: number;
}

export const DEFAULT_SETTINGS: LauncherSettings = {
  theme: "dark-purple",
  wallpaperMode: "dynamic",
  parallaxEnabled: true,
  backgroundBlur: 3,
  vignetteStrength: 58,
  controllerScrollMode: "rotation",
  fullscreenPreferred: true,
  lumenBrightness: 100,
};
