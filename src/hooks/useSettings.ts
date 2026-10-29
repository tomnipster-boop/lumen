import { useCallback, useState } from "react";
import {
  DEFAULT_SETTINGS,
  type AccentTheme,
  type ControllerScrollMode,
  type LauncherSettings,
} from "../types/settings";

const STORAGE_KEY = "lumen.launcher.settings.v1";
const THEMES: AccentTheme[] = [
  "dark-purple",
  "pink",
  "red",
  "light-blue",
  "dark-blue",
];
const CONTROLLER_SCROLL_MODES: ControllerScrollMode[] = ["rotation", "horizontal"];

function numericSetting(value: unknown, fallback: number, minimum: number, maximum: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function readSettings(): LauncherSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;

    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return DEFAULT_SETTINGS;

    const saved = value as Record<string, unknown>;
    const staticWallpaperPath =
      typeof saved.staticWallpaperPath === "string" &&
      saved.staticWallpaperPath.length > 0
        ? saved.staticWallpaperPath
        : undefined;
    const gameAudioOutput =
      typeof saved.gameAudioOutput === "string" && saved.gameAudioOutput.length > 0
        ? saved.gameAudioOutput
        : undefined;

    return {
      theme: THEMES.includes(saved.theme as AccentTheme)
        ? (saved.theme as AccentTheme)
        : DEFAULT_SETTINGS.theme,
      wallpaperMode:
        saved.wallpaperMode === "static" ? "static" : "dynamic",
      staticWallpaperPath,
      parallaxEnabled:
        typeof saved.parallaxEnabled === "boolean"
          ? saved.parallaxEnabled
          : DEFAULT_SETTINGS.parallaxEnabled,
      backgroundBlur: numericSetting(
        saved.backgroundBlur,
        DEFAULT_SETTINGS.backgroundBlur,
        0,
        20,
      ),
      vignetteStrength: numericSetting(
        saved.vignetteStrength,
        DEFAULT_SETTINGS.vignetteStrength,
        0,
        100,
      ),
      controllerScrollMode: CONTROLLER_SCROLL_MODES.includes(
        saved.controllerScrollMode as ControllerScrollMode,
      )
        ? (saved.controllerScrollMode as ControllerScrollMode)
        : DEFAULT_SETTINGS.controllerScrollMode,
      // Lumen is a console-style shell: every new session starts embedded in
      // fullscreen. The in-session toggle can still leave fullscreen.
      fullscreenPreferred: true,
      gameAudioOutput,
      lumenBrightness: numericSetting(saved.lumenBrightness, 100, 35, 100),
    };
  } catch (error) {
    console.warn("Saved launcher settings were invalid; defaults restored.", error);
    return DEFAULT_SETTINGS;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<LauncherSettings>(readSettings);

  const updateSettings = useCallback(
    (updates: Partial<LauncherSettings>) => {
      setSettings((current) => {
        const next = { ...current, ...updates };
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch (error) {
          console.warn("Launcher settings could not be saved.", error);
        }
        return next;
      });
    },
    [],
  );

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.warn("Launcher settings could not be reset.", error);
    }
  }, []);

  return { settings, updateSettings, resetSettings };
}
