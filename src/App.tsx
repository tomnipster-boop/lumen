import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import "./App.css";
import { Background } from "./components/Background";
import { Carousel } from "./components/Carousel";
import { Clock } from "./components/Clock";
import { EmptyLibrary } from "./components/EmptyLibrary";
import { FolderImport } from "./components/FolderImport";
import { GameDetails } from "./components/GameDetails";
import { GameEditor } from "./components/GameEditor";
import { GameInfo } from "./components/GameInfo";
import { QuickSettings } from "./components/QuickSettings";
import { useArtworkTheme } from "./hooks/useArtworkTheme";
import { invalidateArtworkThemes, THEME_TRANSITION_MS } from "./lib/artworkTheme";
import { PlayButton } from "./components/PlayButton";
import { QuitGameDialog } from "./components/QuitGameDialog";
import { RunningGameIndicator } from "./components/RunningGameIndicator";
import { SettingsPanel } from "./components/SettingsPanel";
import { StartupSplash } from "./components/StartupSplash";
import { Toast, type ToastMessage, type ToastTone } from "./components/Toast";
import { useLaunchLifecycle } from "./hooks/useLaunchLifecycle";
import { useLibrary } from "./hooks/useLibrary";
import { useParallax } from "./hooks/useParallax";
import { useSettings } from "./hooks/useSettings";
import { useUiSounds } from "./hooks/useUiSounds";
import { type InputAction, useUnifiedInput } from "./hooks/useUnifiedInput";
import { toAssetUrl } from "./lib/assets";
import { pickLaunchScript, pickScriptDirectory } from "./lib/dialogs";
import { revealSettingsFocus, scrollSettingsBy } from "./lib/settingsMotion";
import type { DiscoveredScript, Game, GameDraft, LaunchExited } from "./types/game";
import type { LauncherSettings } from "./types/settings";
import "./Glass.css";

const STATIC_FALLBACK = "/art/backgrounds/default.svg";
const STARTUP_SPLASH_DURATION = 3000;
const STARTUP_FINAL_PULSE_AT = STARTUP_SPLASH_DURATION * 0.8;

interface EditorState {
  game?: Game;
  initialScriptPath?: string;
}

interface ImportState {
  directory: string;
  scripts: DiscoveredScript[];
}

type KeyboardHomeFocus = "carousel" | "play" | "settings" | "mode" | "quick";

const FOCUSABLE = "button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex='-1'])";

function activeOverlay(): HTMLElement | null {
  const selectors = [
    ".quit-confirm-backdrop--open .quit-confirm",
    ".import-backdrop--open .folder-import",
    ".editor-backdrop--open .game-editor",
    ".details-backdrop--open .game-details",
    ".quick-backdrop--open .quick-settings",
    ".settings-backdrop--open .settings-panel",
  ];
  for (const selector of selectors) {
    const overlay = document.querySelector<HTMLElement>(selector);
    if (overlay) return overlay;
  }
  return null;
}

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => {
    if (element.closest("[inert]")) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

function isConsoleSlider(element: Element | null): element is HTMLInputElement {
  return element instanceof HTMLInputElement
    && element.type === "range"
    && element.hasAttribute("data-console-slider");
}

function setSliderAdjustment(slider: HTMLInputElement, adjusting: boolean) {
  if (adjusting) slider.dataset.controllerAdjusting = "true";
  else delete slider.dataset.controllerAdjusting;
  slider.closest(".console-control")?.classList.toggle("console-control--adjusting", adjusting);
}

function stopFocusedSliderAdjustment(): boolean {
  const current = document.activeElement;
  if (!isConsoleSlider(current) || current.dataset.controllerAdjusting !== "true") return false;
  setSliderAdjustment(current, false);
  return true;
}

function moveOverlayFocus(direction: "left" | "right" | "up" | "down"): boolean {
  const root = activeOverlay();
  if (!root) return false;
  const candidates = focusables(root);
  if (candidates.length === 0) return false;
  const current = document.activeElement instanceof HTMLElement && root.contains(document.activeElement)
    ? document.activeElement
    : undefined;
  if (!current) {
    const inSettings = root.classList.contains("settings-panel");
    candidates[0].focus({ preventScroll: inSettings });
    if (inSettings) revealSettingsFocus(candidates[0]);
    return true;
  }
  if (root.classList.contains("quick-settings")) {
    if (isConsoleSlider(current) && current.dataset.controllerAdjusting === "true") {
      if (direction !== "left" && direction !== "right") return false;
      const previous = current.value;
      if (direction === "left") current.stepDown(); else current.stepUp();
      if (previous === current.value) return false;
      current.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
    if (direction === "left" || direction === "right") return false;
    const index = candidates.indexOf(current);
    const next = candidates[index + (direction === "down" ? 1 : -1)] ?? (index < 0 ? candidates[0] : undefined);
    if (!next) return false;
    next.focus({ preventScroll: true }); revealSettingsFocus(next); return true;
  }
  if (root.classList.contains("settings-panel")) {
    const settingsCandidates = candidates.filter((candidate) => !candidate.closest(".settings-panel__header"));
    const sliders = settingsCandidates.filter(isConsoleSlider);
    const verticalCandidates = settingsCandidates.filter((candidate) => !isConsoleSlider(candidate));
    if (isConsoleSlider(current)) {
      const adjusting = current.dataset.controllerAdjusting === "true";
      if (adjusting) {
        const previousValue = current.value;
        if (direction === "left") current.stepDown();
        else if (direction === "right") current.stepUp();
        else return false;
        if (current.value === previousValue) return false;
        current.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      }
      if (direction === "left" || direction === "right") {
        const sliderIndex = sliders.indexOf(current);
        const next = sliders[sliderIndex + (direction === "left" ? -1 : 1)];
        if (!next) return false;
        next.focus({ preventScroll: true });
        revealSettingsFocus(next);
        return true;
      }
      const next = direction === "down" ? verticalCandidates[0] : undefined;
      if (!next) return false;
      next.focus({ preventScroll: true });
      revealSettingsFocus(next);
      return true;
    }
    if (direction === "left" || direction === "right") return false;
    const currentIndex = verticalCandidates.indexOf(current);
    const next = direction === "up" && currentIndex === 0 && sliders.length > 0
      ? sliders[0]
      : verticalCandidates[currentIndex + (direction === "up" ? -1 : 1)];
    if (!next || next === current) return false;
    next.focus({ preventScroll: true });
    revealSettingsFocus(next);
    return true;
  }
  const from = current.getBoundingClientRect();
  const fromX = from.left + from.width / 2;
  const fromY = from.top + from.height / 2;
  const vertical = direction === "up" || direction === "down";
  const sign = direction === "left" || direction === "up" ? -1 : 1;
  const next = candidates
    .filter((candidate) => candidate !== current)
    .map((candidate) => {
      const rect = candidate.getBoundingClientRect();
      const dx = rect.left + rect.width / 2 - fromX;
      const dy = rect.top + rect.height / 2 - fromY;
      const primary = vertical ? dy * sign : dx * sign;
      const secondary = vertical ? Math.abs(dx) : Math.abs(dy);
      return { candidate, primary, score: primary * 4 + secondary };
    })
    .filter(({ primary }) => primary > 3)
    .sort((left, right) => left.score - right.score)[0]?.candidate;
  if (next) {
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    return true;
  }
  return false;
}

function confirmOverlayFocus(): "select" | "scroll" | false {
  const root = activeOverlay();
  if (!root) return false;
  const current = document.activeElement;
  if (current instanceof HTMLElement && root.contains(current)) {
    if (isConsoleSlider(current)) {
      setSliderAdjustment(current, current.dataset.controllerAdjusting !== "true");
      return "select";
    }
    current.click();
    return "select";
  }
  const first = focusables(root)[0];
  if (!first) return false;
  const inSettings = root.classList.contains("settings-panel");
  first.focus({ preventScroll: inSettings });
  if (inSettings) revealSettingsFocus(first);
  return "scroll";
}

function MinimizeIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
}

function CloseIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
}

function App() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const toastTimerRef = useRef<number | undefined>(undefined);
  const startupSoundPlayedRef = useRef(false);
  const [startupVisible, setStartupVisible] = useState(true);
  const [selectedId, setSelectedId] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [hardwareBrightnessAvailable, setHardwareBrightnessAvailable] = useState(false);
  const quickButtonRef = useRef<HTMLButtonElement>(null);
  const [artworkRevision, setArtworkRevision] = useState(0);
  const wallpaperRequest = useRef(0);
  const [registeredStatic, setRegisteredStatic] = useState<string>();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [quitConfirmOpen, setQuitConfirmOpen] = useState(false);
  const [editor, setEditor] = useState<EditorState>();
  const [folderImport, setFolderImport] = useState<ImportState>();
  const [keyboardHomeFocus, setKeyboardHomeFocus] = useState<KeyboardHomeFocus>("carousel");
  const [toast, setToast] = useState<ToastMessage>();
  const { playBoot, playScroll, playSelect, playBack } = useUiSounds();
  const { settings, updateSettings: persistSettings, resetSettings } = useSettings();
  const {
    games,
    warning: libraryWarning,
    error: libraryError,
    loading,
    addGame,
    updateGame,
    removeGame,
    reorderGames,
    scanFolder,
    registerAsset,
    refresh,
  } = useLibrary();

  const showToast = useCallback((title: string, message = "", tone: ToastTone = "success") => {
    window.clearTimeout(toastTimerRef.current);
    setToast({ id: Date.now(), title, message, tone });
    toastTimerRef.current = window.setTimeout(() => setToast(undefined), tone === "error" ? 6200 : 3600);
  }, []);

  const updateSettings = useCallback((updates: Partial<LauncherSettings>) => {
    const revision = "staticWallpaperPath" in updates || "wallpaperMode" in updates ? ++wallpaperRequest.current : wallpaperRequest.current;
    const apply = () => {
      if (revision !== wallpaperRequest.current) return;
      if ("staticWallpaperPath" in updates) {
        invalidateArtworkThemes(); setArtworkRevision(value => value + 1);
      }
      persistSettings(updates);
    };
    const path = updates.staticWallpaperPath;
    if (path && isTauri() && !/^(data:|blob:|https?:)/.test(path) && !path.startsWith("/art/")) {
      void registerAsset(path).then(() => {
        if (revision === wallpaperRequest.current) setRegisteredStatic(path);
        apply();
      }).catch(reason => {
        if (revision === wallpaperRequest.current) showToast("Wallpaper unavailable", typeof reason === "string" ? reason : "That image could not be opened.", "error");
      });
    } else apply();
  }, [persistSettings, registerAsset, showToast]);

  const handleGameExited = useCallback((event: LaunchExited) => {
    if (event.persistenceError || event.waitError) {
      showToast(
        "Game closed with a warning",
        event.persistenceError ?? event.waitError ?? "Session details could not be recorded.",
        "error",
      );
      return;
    }
    if (!event.started) {
      const exitNote = typeof event.exitCode === "number"
        ? `The launcher exited with status ${event.exitCode}.`
        : "The launch process ended before a game window appeared.";
      showToast("Game did not start", `${event.title} · ${exitNote}`, "error");
      return;
    }
    const exitNote = typeof event.exitCode === "number" && event.exitCode !== 0
      ? `Exited with status ${event.exitCode}.`
      : "Playtime saved.";
    showToast("Game closed", `${event.title} · ${exitNote}`, "info");
  }, [showToast]);

  const { activeLaunch, launch, resume, quit } = useLaunchLifecycle({
    onExited: handleGameExited,
    refreshLibrary: refresh,
  });

  useEffect(() => {
    if (libraryError) showToast("Library unavailable", libraryError, "error");
    else if (libraryWarning) showToast("Library needs attention", libraryWarning, "error");
  }, [libraryError, libraryWarning, showToast]);

  useEffect(() => {
    if (games.length === 0) {
      setSelectedId(undefined);
      return;
    }
    if (!selectedId || !games.some((game) => game.id === selectedId)) {
      setSelectedId(games[0].id);
    }
  }, [games, selectedId]);

  useEffect(() => {
    if (activeLaunch?.phase === "paused") setSelectedId(activeLaunch.gameId);
  }, [activeLaunch]);

  const selectedIndex = Math.max(0, games.findIndex((game) => game.id === selectedId));
  const selectedGame = games[selectedIndex];
  const overlayOpen = startupVisible || settingsOpen || quickOpen || detailsOpen || quitConfirmOpen || Boolean(editor) || Boolean(folderImport);
  const launcherOwnsController = !activeLaunch || activeLaunch.phase === "paused";
  const overlayOpenRef = useRef(overlayOpen);
  overlayOpenRef.current = overlayOpen;

  useLayoutEffect(() => {
    if (overlayOpen) return;
    const selector: Record<KeyboardHomeFocus, string> = {
      carousel: ".game-card--selected", play: ".play-button", settings: ".settings-button", mode: ".background-mode", quick: ".quick-options",
    };
    sceneRef.current?.querySelector<HTMLElement>(selector[keyboardHomeFocus])?.focus({ preventScroll: true });
  }, [keyboardHomeFocus, overlayOpen, selectedIndex]);

  const backgroundSource = useMemo(() => {
    if (settings.wallpaperMode === "static") {
      const path = settings.staticWallpaperPath;
      const local = path && isTauri() && !/^(data:|blob:|https?:)/.test(path) && !path.startsWith("/art/");
      if (local && registeredStatic !== path) return STATIC_FALLBACK;
      return toAssetUrl(path) ?? STATIC_FALLBACK;
    }
    if (selectedGame?.backgroundAvailable) return toAssetUrl(selectedGame.backgroundPath) ?? STATIC_FALLBACK;
    if (selectedGame?.coverAvailable) return toAssetUrl(selectedGame.coverPath) ?? STATIC_FALLBACK;
    return STATIC_FALLBACK;
  }, [registeredStatic, selectedGame, settings.staticWallpaperPath, settings.wallpaperMode]);

  const palette = useArtworkTheme(backgroundSource, artworkRevision);
  const themeStyle = { "--lumen-accent": palette.accent, "--theme-transition-duration": `${THEME_TRANSITION_MS}ms`, "--lumen-dim": hardwareBrightnessAvailable ? 0 : (100 - settings.lumenBrightness) / 100 } as CSSProperties;
  const toggleBackgroundMode = useCallback(() => {
    updateSettings({ wallpaperMode: settings.wallpaperMode === "dynamic" ? "static" : "dynamic" });
  }, [settings.wallpaperMode, updateSettings]);

  const selectRelative = useCallback((direction: number) => {
    if (games.length <= 1) return;
    playScroll();
    setSelectedId((currentId) => {
      const current = Math.max(0, games.findIndex((game) => game.id === currentId));
      const next = (current + direction + games.length) % games.length;
      return games[next].id;
    });
  }, [games, playScroll]);

  const previousGame = useCallback(() => selectRelative(-1), [selectRelative]);
  const nextGame = useCallback(() => selectRelative(1), [selectRelative]);

  const beginAdd = useCallback(async () => {
    try {
      const path = await pickLaunchScript();
      if (path) setEditor({ initialScriptPath: path });
    } catch {
      showToast("Script picker unavailable", "The native .sh picker could not be opened.", "error");
    }
  }, [showToast]);

  const beginFolderImport = useCallback(async () => {
    try {
      const directory = await pickScriptDirectory();
      if (!directory) return;
      const scripts = await scanFolder(directory);
      setFolderImport({ directory, scripts });
    } catch (reason) {
      showToast(
        "Folder scan failed",
        reason instanceof Error ? reason.message : "That folder could not be scanned.",
        "error",
      );
    }
  }, [scanFolder, showToast]);

  const saveEditor = useCallback(async (draft: GameDraft, id?: string) => {
    const response = id ? await updateGame(id, draft) : await addGame(draft);
    invalidateArtworkThemes();
    setArtworkRevision(value => value + 1);
    const saved = response.games.find((game) => game.id === id || game.launchScript === draft.launchScript);
    if (saved) setSelectedId(saved.id);
    setEditor(undefined);
    showToast(id ? "Changes saved" : "Game added", draft.title);
  }, [addGame, showToast, updateGame]);

  const removeEditorGame = useCallback(async (id: string) => {
    const game = games.find((entry) => entry.id === id);
    await removeGame(id);
    setEditor(undefined);
    showToast("Game removed", `${game?.title ?? "The entry"} was removed. No files were deleted.`);
  }, [games, removeGame, showToast]);

  const moveGame = useCallback(async (id: string, direction: -1 | 1) => {
    const index = games.findIndex((game) => game.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= games.length) return;
    const ordered = games.map((game) => game.id);
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    try {
      await reorderGames(ordered);
      showToast("Library order saved", "The carousel now follows this order.", "info");
    } catch (reason) {
      showToast("Reorder failed", reason instanceof Error ? reason.message : "The new order could not be saved.", "error");
    }
  }, [games, reorderGames, showToast]);

  const importScripts = useCallback(async (scripts: DiscoveredScript[]) => {
    let imported = 0;
    let lastId: string | undefined;
    const failures: string[] = [];
    for (const script of scripts) {
      try {
        const response = await addGame({ title: script.title, launchScript: script.path });
        lastId = response.games.find((game) => game.launchScript === script.path)?.id;
        imported += 1;
      } catch (reason) {
        failures.push(reason instanceof Error ? reason.message : `${script.title} could not be imported.`);
      }
    }
    if (lastId) setSelectedId(lastId);
    if (failures.length > 0) {
      throw new Error(`${imported} imported. ${failures[0]}`);
    }
    setFolderImport(undefined);
    showToast("Scripts imported", `${imported} ${imported === 1 ? "game is" : "games are"} ready to customize.`);
  }, [addGame, showToast]);

  const activatePlay = useCallback(async () => {
    if (!selectedGame) return;
    if (activeLaunch) {
      if (activeLaunch.gameId !== selectedGame.id) {
        showToast("A game is already running", `${activeLaunch.title} must close before another game can start.`, "info");
        return;
      }
      if (activeLaunch.phase === "launching") {
        showToast("Game is still starting", activeLaunch.title, "info");
        return;
      }
      try {
        await resume();
      } catch (reason) {
        showToast("Could not return to game", reason instanceof Error ? reason.message : activeLaunch.title, "error");
      }
      return;
    }
    try {
      await launch(selectedGame.id, selectedGame.title, settings.gameAudioOutput);
    } catch (reason) {
      showToast(
        "Launch failed",
        reason instanceof Error ? reason.message : `The launch script for ${selectedGame.title} could not be opened.`,
        "error",
      );
    }
  }, [activeLaunch, launch, resume, selectedGame, settings.gameAudioOutput, showToast]);

  const closeQuickSettings = useCallback(() => setQuickOpen(false), []);
  const openQuickSettings = useCallback(() => {
    overlayOpenRef.current = true;
    setSettingsOpen(false); setDetailsOpen(false); setQuickOpen(true);
    setKeyboardHomeFocus("quick");
  }, []);

  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const openSettings = useCallback(() => {
    overlayOpenRef.current = true;
    setDetailsOpen(false);
    setQuickOpen(false);
    setSettingsOpen(true);
  }, []);
  const openDetails = useCallback(() => {
    if (!selectedGame) return;
    setSettingsOpen(false);
    setQuickOpen(false);
    setDetailsOpen(true);
  }, [selectedGame]);
  const openEditor = useCallback((game: Game) => {
    setDetailsOpen(false);
    setEditor({ game });
  }, []);
  const handleBack = useCallback(() => {
    if (quitConfirmOpen) setQuitConfirmOpen(false);
    else if (folderImport) setFolderImport(undefined);
    else if (editor) setEditor(undefined);
    else if (detailsOpen) setDetailsOpen(false);
    else if (quickOpen) {
      const back = document.querySelector<HTMLElement>(".quick-backdrop--open [data-quick-back]");
      if (back) back.click(); else closeQuickSettings();
    }
    else if (settingsOpen) {
      const panel = document.querySelector<HTMLElement>(".settings-backdrop--open .settings-panel");
      const choiceBack = panel?.querySelector<HTMLElement>("[data-settings-choice-back]");
      const pageBack = panel?.querySelector<HTMLElement>("[data-settings-back]");
      if (choiceBack) choiceBack.click();
      else if (pageBack) pageBack.click();
      else closeSettings();
    }
    else if (settings.fullscreenPreferred) updateSettings({ fullscreenPreferred: false });
  }, [closeQuickSettings, closeSettings, detailsOpen, editor, folderImport, quickOpen, quitConfirmOpen, settings.fullscreenPreferred, settingsOpen, updateSettings]);

  const confirmQuit = useCallback(async () => {
    setQuitConfirmOpen(false);
    try {
      await quit();
      showToast("Closing game", activeLaunch?.title ?? "The running game", "info");
    } catch (reason) {
      showToast("Could not close game", reason instanceof Error ? reason.message : "The game did not respond.", "error");
    }
  }, [activeLaunch?.title, quit, showToast]);

  const scrollSettings = useCallback((pixels: number) => {
    const panel = document.querySelector<HTMLElement>(".quick-backdrop--open .quick-settings, .settings-backdrop--open .settings-panel");
    const body = Array.from(panel?.querySelectorAll<HTMLElement>("[data-controller-scroll]") ?? [])
      .find((element) => !element.closest("[inert]"));
    if (body) scrollSettingsBy(body, pixels);
  }, []);

  const handleInputAction = useCallback((action: InputAction) => {
    if (startupVisible) return;
    if (action === "REQUEST_QUIT") {
      if (activeLaunch && !quitConfirmOpen) {
        playSelect();
        setSettingsOpen(false);
        setQuickOpen(false);
        setDetailsOpen(false);
        setQuitConfirmOpen(true);
      }
      return;
    }
    if (overlayOpenRef.current || activeOverlay()) {
      if (action === "BACK") {
        playBack();
        if (!stopFocusedSliderAdjustment()) handleBack();
      } else if (action === "NAV_LEFT") {
        if (moveOverlayFocus("left")) playScroll();
      } else if (action === "NAV_RIGHT") {
        if (moveOverlayFocus("right")) playScroll();
      } else if (action === "NAV_UP") {
        if (moveOverlayFocus("up")) playScroll();
      } else if (action === "NAV_DOWN") {
        if (moveOverlayFocus("down")) playScroll();
      } else if (action === "CONFIRM") {
        const result = confirmOverlayFocus();
        if (result === "select") playSelect();
        else if (result === "scroll") playScroll();
      }
      return;
    }

    if (action === "NAV_LEFT") {
      setKeyboardHomeFocus("carousel"); previousGame();
    } else if (action === "NAV_RIGHT") {
      setKeyboardHomeFocus("carousel"); nextGame();
    } else if (action === "NAV_UP" || action === "NAV_DOWN") {
      const order: KeyboardHomeFocus[] = ["settings", "carousel", "play", "mode", "quick"];
      const index = order.indexOf(keyboardHomeFocus);
      const next = order[Math.max(0, Math.min(order.length - 1, index + (action === "NAV_UP" ? -1 : 1)))];
      if (next !== keyboardHomeFocus) playScroll();
      setKeyboardHomeFocus(next);
    } else if (action === "CONFIRM") {
      if (keyboardHomeFocus === "settings") { playSelect(); openSettings(); }
      else if (keyboardHomeFocus === "mode") { playSelect(); toggleBackgroundMode(); }
      else if (keyboardHomeFocus === "quick") { playSelect(); openQuickSettings(); }
      else if (selectedGame) { playSelect(); void activatePlay(); }
    } else if (action === "OPEN_QUICK_SETTINGS") {
      playSelect(); openQuickSettings();
    } else if (action === "OPEN_SETTINGS") {
      playSelect();
      openSettings();
    } else if (action === "OPEN_DETAILS") {
      if (!selectedGame) return;
      playSelect();
      openDetails();
    } else if (action === "BACK" && settings.fullscreenPreferred) {
      playBack();
      handleBack();
    }
  }, [activeLaunch, activatePlay, handleBack, keyboardHomeFocus, nextGame, openDetails, openQuickSettings, openSettings, playBack, playScroll, playSelect, previousGame, quitConfirmOpen, selectedGame, settings.fullscreenPreferred, startupVisible, toggleBackgroundMode]);

  const { mode: inputMode, controllerConnected, rotationActive } = useUnifiedInput({
    // A running/launching game owns the controller. The native Guide watcher
    // remains active and is the only path allowed to bring Lumen back.
    gamepadEnabled: !startupVisible && launcherOwnsController,
    overlayOpen,
    inputResetKey: `${activeLaunch?.gameId ?? "idle"}:${activeLaunch?.phase ?? "idle"}`,
    controllerScrollMode: settings.controllerScrollMode,
    rightStickScrollEnabled: settingsOpen || quickOpen,
    onRightStickScroll: scrollSettings,
    onAction: handleInputAction,
  });

  useParallax(
    sceneRef,
    settings.parallaxEnabled && (!activeLaunch || activeLaunch.phase === "paused"),
    inputMode === "mouse" && !overlayOpen,
    JSON.stringify([selectedIndex, games.map((game) => game.id)]),
  );

  useEffect(() => {
    if (games.length === 0) return;
    const nearby = new Set([
      selectedIndex,
      (selectedIndex - 1 + games.length) % games.length,
      (selectedIndex + 1) % games.length,
    ]);
    games.filter((_, index) => nearby.has(index)).forEach((game) => {
      [game.coverAvailable ? game.coverPath : undefined, game.backgroundAvailable ? game.backgroundPath : undefined]
        .filter((path): path is string => Boolean(path))
        .forEach((path) => {
          const source = toAssetUrl(path);
          if (source) {
            const image = new Image();
            image.src = source;
          }
        });
    });
  }, [games, selectedIndex]);

  useEffect(() => {
    const path = settings.staticWallpaperPath;
    if (!path || /^(data:|blob:|https?:)/.test(path) || path.startsWith("/art/")) return;
    let stale = false;
    void registerAsset(path).then(() => { if (!stale) setRegisteredStatic(path); }).catch(reason => {
      if (!stale) showToast("Static wallpaper unavailable", typeof reason === "string" ? reason : "Choose another image in Settings.", "error");
    });
    return () => { stale = true; };
  }, [registerAsset, settings.staticWallpaperPath, showToast]);

  useEffect(() => {
    if (!isTauri()) return;
    getCurrentWindow().setFullscreen(settings.fullscreenPreferred).catch((reason) => console.warn("Fullscreen preference could not be applied.", reason));
  }, [settings.fullscreenPreferred]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (startupSoundPlayedRef.current) return;
      startupSoundPlayedRef.current = true;
      playBoot();
    }, STARTUP_FINAL_PULSE_AT);
    return () => window.clearTimeout(timer);
  }, [playBoot]);

  useEffect(() => {
    const timer = window.setTimeout(() => setStartupVisible(false), STARTUP_SPLASH_DURATION);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimerRef.current), []);

  const minimizeWindow = async () => { if (isTauri()) await getCurrentWindow().minimize(); };
  const closeWindow = async () => { if (isTauri()) await getCurrentWindow().close(); };

  return (
    <div
      className="launcher"
      ref={sceneRef}
      data-theme={settings.theme}
      style={themeStyle}
      data-background-mode={settings.wallpaperMode}
      data-input-mode={inputMode}
      data-controller-connected={controllerConnected || undefined}
      data-rotation-active={rotationActive || undefined}
      onMouseDownCapture={(event) => {
        if (!event.nativeEvent.isTrusted || !(event.target instanceof Element)) return;
        if (event.target.matches(".settings-choice-backdrop, .settings-backdrop--open, .details-backdrop--open, .editor-backdrop--open")) {
          playBack();
        }
      }}
      onClickCapture={(event) => {
        if (!event.nativeEvent.isTrusted || !(event.target instanceof Element)) return;
        const control = event.target.closest<HTMLElement>("[data-ui-sound], button:not(:disabled)");
        if (!control) return;
        const sound = control.dataset.uiSound ?? "select";
        if (sound === "none") return;
        if (sound === "scroll") {
          if (control.getAttribute("aria-current") !== "true") playScroll();
        } else if (sound === "back") playBack();
        else playSelect();
      }}
    >
      <Background
        source={backgroundSource}
        blur={settings.backgroundBlur}
        vignette={settings.vignetteStrength}
      />

      <header className="topbar" data-tauri-drag-region inert={overlayOpen}>
        <div className="brand" data-tauri-drag-region>
          <span className="brand__sigil" aria-hidden="true"><i /><i /></span>
          <div data-tauri-drag-region><strong>Lumen</strong><span>Game library</span></div>
        </div>
        <Clock />
        <nav className="topbar__actions" aria-label="Launcher actions">
          <button className={`settings-button ${keyboardHomeFocus === "settings" ? "logical-focus" : ""}`} type="button" onClick={openSettings} onFocus={() => setKeyboardHomeFocus("settings")} aria-label="Open settings with Y"><kbd aria-hidden="true">Y</kbd></button>
          <span className="topbar__divider" aria-hidden="true" />
          <button className="window-button" type="button" onClick={minimizeWindow} aria-label="Minimize window"><MinimizeIcon /></button>
          <button className="window-button window-button--close" type="button" data-ui-sound="back" onClick={closeWindow} aria-label="Close launcher"><CloseIcon /></button>
        </nav>
      </header>

      <main className={`launcher__content ${games.length === 0 ? "launcher__content--empty" : ""}`} inert={overlayOpen}>
        {games.length === 0 ? (
          <EmptyLibrary loading={loading} onAdd={beginAdd} onImportFolder={beginFolderImport} />
        ) : selectedGame ? (
          <>
            <GameInfo
              game={selectedGame}
              position={selectedIndex + 1}
              total={games.length}
              playing={activeLaunch?.gameId === selectedGame.id && activeLaunch.phase !== "launching"}
              onDetails={openDetails}
            />
            <Carousel
              games={games}
              selectedIndex={selectedIndex}
              active={!overlayOpen && launcherOwnsController}
              rotationActive={rotationActive}
              onSelect={(index) => setSelectedId(games[index]?.id)}
            />
            <div className={`primary-action ${keyboardHomeFocus === "play" ? "primary-action--focused" : ""}`}>
              <div className="play-glass" onFocus={() => setKeyboardHomeFocus("play")}>
              <PlayButton
                gameTitle={selectedGame.title}
                onPlay={activatePlay}
                launching={activeLaunch?.phase === "launching"}
                activeGameTitle={activeLaunch?.title}
                activeGameSelected={activeLaunch?.gameId === selectedGame.id}
                activeGamePaused={activeLaunch?.phase === "paused"}
              />
              </div>
              <div className="library-position" aria-label={`${selectedIndex + 1} of ${games.length}`}>
                {games.map((game, index) => <span key={game.id} className={index === selectedIndex ? "active" : ""} />)}
              </div>
              <span className="library-count">{games.length} {games.length === 1 ? "game" : "games"}</span>
            </div>
          </>
        ) : null}
      </main>

      <div className="library-tools" inert={overlayOpen}>
        <button className={`background-mode glass-control ${keyboardHomeFocus === "mode" ? "logical-focus" : ""}`} type="button"
          aria-label={`Background mode: ${settings.wallpaperMode}. Switch to ${settings.wallpaperMode === "dynamic" ? "static" : "dynamic"}`}
          aria-pressed={settings.wallpaperMode === "dynamic"} onFocus={() => setKeyboardHomeFocus("mode")} onClick={toggleBackgroundMode}>
          <span className="mode-light" aria-hidden="true" />{settings.wallpaperMode.toUpperCase()}
        </button>
        <button ref={quickButtonRef} className={`quick-options glass-control ${keyboardHomeFocus === "quick" ? "logical-focus" : ""}`} type="button"
          aria-label="Open quick settings" aria-expanded={quickOpen} onFocus={() => setKeyboardHomeFocus("quick")} onClick={openQuickSettings}>
          <kbd aria-hidden="true">View</kbd> QUICK OPTIONS
        </button>
      </div>
      <QuickSettings onHardwareBrightness={setHardwareBrightnessAvailable} open={quickOpen} settings={settings} onChange={updateSettings} onClose={closeQuickSettings} returnFocusRef={quickButtonRef} />
      <div className="lumen-dimmer" aria-hidden="true" />

      <RunningGameIndicator launch={activeLaunch} />

      <GameDetails
        open={detailsOpen}
        game={selectedGame}
        running={activeLaunch?.gameId === selectedGame?.id}
        activeGameTitle={activeLaunch?.title}
        onPlay={activatePlay}
        onEdit={() => { if (selectedGame) openEditor(selectedGame); }}
        onClose={() => setDetailsOpen(false)}
      />

      <SettingsPanel
        onHardwareBrightness={setHardwareBrightnessAvailable}
        open={settingsOpen}
        settings={settings}
        games={games}
        selectedId={selectedId}
        activeGameId={activeLaunch?.gameId}
        previewFallback={STATIC_FALLBACK}
        onChange={updateSettings}
        onReset={resetSettings}
        onAdd={beginAdd}
        onImportFolder={beginFolderImport}
        onEdit={openEditor}
        onMove={moveGame}
        onClose={closeSettings}
      />

      <GameEditor
        open={Boolean(editor)}
        game={editor?.game}
        initialScriptPath={editor?.initialScriptPath}
        locked={Boolean(editor?.game && activeLaunch?.gameId === editor.game.id)}
        onSave={saveEditor}
        onRemove={removeEditorGame}
        onClose={() => setEditor(undefined)}
      />

      <FolderImport
        open={Boolean(folderImport)}
        directory={folderImport?.directory ?? ""}
        scripts={folderImport?.scripts ?? []}
        games={games}
        onImport={importScripts}
        onClose={() => setFolderImport(undefined)}
      />

      <QuitGameDialog
        open={quitConfirmOpen}
        gameTitle={activeLaunch?.title}
        onConfirm={() => { void confirmQuit(); }}
        onCancel={() => setQuitConfirmOpen(false)}
      />

      <Toast toast={toast} />
      {startupVisible && <StartupSplash />}
    </div>
  );
}

export default App;
