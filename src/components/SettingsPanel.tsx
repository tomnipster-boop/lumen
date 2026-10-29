import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
} from "react";
import { fileName, toAssetUrl } from "../lib/assets";
import { pickArtwork } from "../lib/dialogs";
import { bindSettingsScroll, resetSettingsScroll, revealSettingsFocus, SETTINGS_MOTION } from "../lib/settingsMotion";
import type { Game } from "../types/game";
import {
  type AccentTheme,
  type LauncherSettings,
} from "../types/settings";
import { createCoalescedWrite } from "../lib/coalescedWrite";
import { invalidateArtworkThemes } from "../lib/artworkTheme";
import { LibraryManager } from "./LibraryManager";
import "./SettingsMotion.css";

const SETTINGS_MOTION_STYLE = {
  "--settings-panel-duration": `${SETTINGS_MOTION.panelDurationMs}ms`,
  "--settings-panel-fade-duration": `${SETTINGS_MOTION.panelFadeDurationMs}ms`,
  "--settings-backdrop-duration": `${SETTINGS_MOTION.backdropDurationMs}ms`,
  "--settings-entrance-easing": SETTINGS_MOTION.entranceEasing,
} as CSSProperties;

interface SettingsPanelProps {
  onHardwareBrightness: (available: boolean) => void;
  open: boolean;
  settings: LauncherSettings;
  games: Game[];
  selectedId?: string;
  activeGameId?: string;
  previewFallback: string;
  onChange: (updates: Partial<LauncherSettings>) => void;
  onReset: () => void;
  onAdd: () => void;
  onImportFolder: () => void;
  onEdit: (game: Game) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onClose: () => void;
}

interface AudioOutput {
  id: string;
  label: string;
  isDefault: boolean;
}

interface SystemControls {
  brightness?: number | null;
  volume: number;
  muted: boolean;
  audioAvailable?: boolean;
  audioError?: string;
}

const systemControlsCache = new Map<string, SystemControls>();

function systemControlsCacheKey(audioOutput?: string) {
  return audioOutput ?? "__system-default__";
}

interface ChoiceOption {
  id: string;
  label: string;
  detail?: string;
  tone?: AccentTheme;
}

interface ChoiceState {
  title: string;
  current?: string;
  options: ChoiceOption[];
  onSelect: (id: string) => void;
}

type SettingsPage = "home" | "appearance" | "display" | "controller" | "audio" | "library";
type ConsoleIconName = "appearance" | "display" | "controller" | "audio" | "library" | "sun" | "speaker";

const PAGE_TITLES: Record<SettingsPage, string> = {
  home: "Settings",
  appearance: "Appearance",
  display: "Display & motion",
  controller: "Controller",
  audio: "Audio",
  library: "Game library",
};

function ConsoleIcon({ name }: { name: ConsoleIconName }) {
  if (name === "appearance") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18h1.1a1.9 1.9 0 0 0 0-3.8h-.8a1.6 1.6 0 0 1 0-3.2H15a6 6 0 0 0 0-12h-3Z" /><circle cx="7.5" cy="10" r="1" /><circle cx="9" cy="6.7" r="1" /><circle cx="13" cy="6" r="1" /></svg>;
  }
  if (name === "display") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></svg>;
  }
  if (name === "controller") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.2 8h7.6a5.1 5.1 0 0 1 4.9 3.7l1.1 4c.6 2.2-1.9 3.9-3.7 2.5l-2.7-2.1H8.6l-2.7 2.1c-1.8 1.4-4.3-.3-3.7-2.5l1.1-4A5.1 5.1 0 0 1 8.2 8Z" /><path d="M7 11v4M5 13h4" /><circle cx="16.5" cy="11.5" r=".8" /><circle cx="18.5" cy="13.5" r=".8" /></svg>;
  }
  if (name === "audio" || name === "speaker") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6L8 10H4Z" /><path d="M16 9a4.2 4.2 0 0 1 0 6M18.5 6.5a7.7 7.7 0 0 1 0 11" /></svg>;
  }
  if (name === "library") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="7" height="16" rx="1.5" /><rect x="14" y="4" width="7" height="16" rx="1.5" /><path d="M6 8h1M17 8h1" /></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" /></svg>;
}

function CloseIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>;
}

function BackIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>;
}

function ConsoleMenuRow({
  icon,
  title,
  description,
  value,
  first = false,
  toggle,
  onClick,
}: {
  icon: ConsoleIconName;
  title: string;
  description: string;
  value?: string;
  first?: boolean;
  toggle?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="console-menu-row"
      type="button"
      data-page-first={first || undefined}
      aria-pressed={toggle === undefined ? undefined : toggle}
      onClick={onClick}
    >
      <span className="console-menu-row__icon"><ConsoleIcon name={icon} /></span>
      <span className="console-menu-row__copy"><strong>{title}</strong><small>{description}</small></span>
      {toggle === undefined
        ? <><span className="console-menu-row__value">{value}</span><span className="console-menu-row__chevron">›</span></>
        : <span className={`console-switch ${toggle ? "console-switch--on" : ""}`}><i /></span>}
    </button>
  );
}

export function ControlSlider({
  icon,
  title,
  detail,
  value,
  minimum = 0,
  maximum = 100,
  step = 5,
  unit = "%",
  lowLabel,
  highLabel,
  disabled = false,
  first = false,
  onChange,
}: {
  icon: ConsoleIconName;
  title: string;
  detail: string;
  value: number;
  minimum?: number;
  maximum?: number;
  step?: number;
  unit?: string;
  lowLabel?: string;
  highLabel?: string;
  disabled?: boolean;
  first?: boolean;
  onChange: (value: number) => void;
}) {
  const level = maximum === minimum ? 0 : ((value - minimum) / (maximum - minimum)) * 100;
  const style = { "--control-level": `${Math.min(100, Math.max(0, level))}%` } as CSSProperties;
  const minimumLabel = lowLabel ?? (icon === "sun" ? "☼" : "−");
  const maximumLabel = highLabel ?? (icon === "sun" ? "☀" : "+");
  return (
    <div className={`console-control ${disabled ? "console-control--disabled" : ""}`}>
      <div className="console-control__heading">
        <span className="console-control__icon"><ConsoleIcon name={icon} /></span>
        <span><strong>{title}</strong><small>{detail}</small></span>
        <output>{disabled ? "—" : `${value}${unit}`}</output>
      </div>
      <div className="console-control__rail">
        <span>{minimumLabel}</span>
        <input
          type="range"
          min={minimum}
          max={maximum}
          step={step}
          value={value}
          style={style}
          disabled={disabled}
          data-page-first={first || undefined}
          data-console-slider
          data-ui-sound="scroll"
          aria-label={title}
          aria-valuetext={`${value}${unit}`}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
        />
        <span>{maximumLabel}</span>
      </div>
    </div>
  );
}

export function QuickControls({
  panelOpen, audioOutput, showBrightness = true, showVolume = true, first = false,
  lumenBrightness = 100, onLumenBrightness, onHardwareBrightness, volumeTitle = "Game volume", volumeFirst = false,
}: {
  panelOpen: boolean; audioOutput?: string; showBrightness?: boolean; showVolume?: boolean;
  onHardwareBrightness?: (available: boolean) => void;
  first?: boolean; lumenBrightness?: number; onLumenBrightness?: (value: number) => void; volumeTitle?: string; volumeFirst?: boolean;
}) {
  const cacheKey = systemControlsCacheKey(audioOutput);
  const cached = systemControlsCache.get(cacheKey);
  const [controls, setControls] = useState<SystemControls>(() => cached ?? { volume: 0, muted: false });
  const [loaded, setLoaded] = useState(Boolean(cached));
  const [audioAvailable, setAudioAvailable] = useState(Boolean(cached));
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const writers = useRef<{
    brightness: ReturnType<typeof createCoalescedWrite<number>>;
    volume: ReturnType<typeof createCoalescedWrite<{ value: number; audioOutput?: string }>>;
  } | null>(null);
  if (!writers.current) {
    const failed = (reason: unknown) => { if (mounted.current) setError(typeof reason === "string" ? reason : "System control could not be changed."); };
    writers.current = {
      brightness: createCoalescedWrite(value => invoke("set_system_brightness", { value }), 180, failed),
      volume: createCoalescedWrite(value => invoke("set_system_volume", { audioOutput: value.audioOutput ?? null, value: value.value }), 60, failed),
    };
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void writers.current?.brightness.flush();
      void writers.current?.volume.flush();
    };
  }, []);
  useEffect(() => {
    if (!panelOpen) {
      void writers.current?.brightness.flush();
      void writers.current?.volume.flush();
      return;
    }
    let stale = false;
    setLoaded(false);
    setError("");
    if (!isTauri()) { setLoaded(true); setAudioAvailable(false); return; }
    void invoke<SystemControls>("get_system_controls", { audioOutput: audioOutput ?? null })
      .then(state => {
        if (stale) return;
        const next = { ...state, volume: state.muted ? 0 : state.volume };
        systemControlsCache.set(cacheKey, next);
        setControls(next);
        onHardwareBrightness?.(state.brightness !== undefined && state.brightness !== null);
        setAudioAvailable(state.audioAvailable !== false);
        if (state.audioError) setError(state.audioError);
      })
      .catch(reason => { if (!stale) { onHardwareBrightness?.(false); setAudioAvailable(false); setControls({ volume: 0, muted: false }); setError(typeof reason === "string" ? reason : "System controls are unavailable."); } })
      .finally(() => { if (!stale) setLoaded(true); });
    return () => { stale = true; };
  }, [audioOutput, cacheKey, onHardwareBrightness, panelOpen]);

  const hardwareBrightness = typeof controls.brightness === "number";
  const setBrightness = (value: number) => {
    if (!hardwareBrightness) { onLumenBrightness?.(value); return; }
    const next = { ...controls, brightness: value };
    setControls(next); systemControlsCache.set(cacheKey, next); setError("");
    writers.current?.brightness.push(value);
  };
  const setVolume = (value: number) => {
    const next = { ...controls, volume: value, muted: false };
    setControls(next); systemControlsCache.set(cacheKey, next); setError("");
    writers.current?.volume.push({ value, audioOutput });
  };
  const brightnessControl = showBrightness && <ControlSlider icon="sun" title={loaded && !hardwareBrightness ? "Lumen brightness" : "Brightness"}
    detail={!loaded ? "Reading display…" : hardwareBrightness ? "Monitor brightness" : "Dims Lumen only · monitor control unavailable"}
    value={hardwareBrightness ? controls.brightness! : lumenBrightness} minimum={hardwareBrightness ? 0 : 35}
    disabled={!loaded || (!hardwareBrightness && !onLumenBrightness)} first={first && !volumeFirst} onChange={setBrightness} />;
  const volumeControl = showVolume && <ControlSlider icon="speaker" title={volumeTitle} detail={audioOutput && volumeTitle !== "Audio" ? "Preferred game output" : "System default output"}
    value={controls.volume} disabled={!loaded || !audioAvailable} first={first && (volumeFirst || !showBrightness)} onChange={setVolume} />;
  return (
    <div className={`console-controls ${showBrightness && showVolume ? "console-controls--pair" : ""}`}>
      {volumeFirst ? volumeControl : brightnessControl}
      {volumeFirst ? brightnessControl : volumeControl}
      {error && <p className="console-controls__error" role="status">{error}</p>}
    </div>
  );
}

export function ChoiceSheet({ choice, open, onClose }: { choice: ChoiceState; open: boolean; onClose: () => void }) {
  const initialRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!open || !list) return;
    const dispose = bindSettingsScroll(list);
    const target = initialRef.current ?? list.querySelector<HTMLButtonElement>("button");
    target?.focus({ preventScroll: true });
    if (target) revealSettingsFocus(target, true);
    return dispose;
  }, [choice, open]);

  return (
    <div className="settings-choice-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="settings-choice" role="dialog" aria-modal="true" aria-label={choice.title}>
        <header>
          <div><span>Select option</span><h3>{choice.title}</h3></div>
          <button type="button" className="settings-choice__close" data-settings-choice-back data-ui-sound="back" onClick={onClose} aria-label="Close options"><CloseIcon /></button>
        </header>
        <div ref={listRef} className="settings-choice__list" data-controller-scroll>
          {choice.options.map((option, index) => {
            const active = option.id === choice.current;
            return (
              <button
                key={option.id}
                ref={active || (!choice.current && index === 0) ? initialRef : undefined}
                type="button"
                className={active ? "active" : ""}
                aria-pressed={active}
                onClick={() => { choice.onSelect(option.id); onClose(); }}
              >
                {option.tone && <span className={`choice-swatch choice-swatch--${option.tone}`} />}
                <span><strong>{option.label}</strong>{option.detail && <small>{option.detail}</small>}</span>
                <i>{active ? "✓" : ""}</i>
              </button>
            );
          })}
        </div>
        <footer><span className="controller-key">A</span> Select <span className="controller-key">B</span> Back</footer>
      </section>
    </div>
  );
}

export function SettingsPanel({
  onHardwareBrightness,
  open: isOpen,
  settings,
  games,
  selectedId,
  activeGameId,
  previewFallback,
  onChange,
  onReset,
  onAdd,
  onImportFolder,
  onEdit,
  onMove,
  onClose,
}: SettingsPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const choiceReturnRef = useRef<HTMLElement | null>(null);
  const focusContextRef = useRef<{ open: boolean; page: SettingsPage }>({ open: false, page: "home" });
  const [page, setPage] = useState<SettingsPage>("home");
  const [choice, setChoice] = useState<ChoiceState>();
  const [pickerError, setPickerError] = useState("");
  const [audioError, setAudioError] = useState("");
  const [outputs, setOutputs] = useState<AudioOutput[]>([]);
  const [outputsLoading, setOutputsLoading] = useState(false);
  const wallpaperSource = toAssetUrl(settings.staticWallpaperPath) ?? previewFallback;

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!isOpen || choice || !body) return;
    return bindSettingsScroll(body);
  }, [choice, isOpen]);

  useLayoutEffect(() => {
    const previous = focusContextRef.current;
    focusContextRef.current = { open: isOpen, page };
    if (!isOpen) return;
    const body = bodyRef.current;
    if (!body) return;
    const opening = !previous.open;
    if (opening) {
      choiceReturnRef.current = null;
      resetSettingsScroll(body);
      // Complete the home-page reset before the entrance can paint. Reopening
      // never exposes the previous page or lets native focus move its scroll.
      if (page !== "home" || choice) {
        setPage("home");
        setChoice(undefined);
        return;
      }
    }
    if (choice) return;
    if (previous.page !== page) resetSettingsScroll(body);
    const returned = choiceReturnRef.current;
    choiceReturnRef.current = null;
    if (!opening && previous.page === page && returned?.isConnected && body.contains(returned)) {
      returned.focus({ preventScroll: true });
      return;
    }
    const marked = body.querySelector<HTMLElement>("[data-page-first]");
    const target = marked?.matches("button:not(:disabled), input:not(:disabled)")
      ? marked
      : marked?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled)")
        ?? body.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled)");
    target?.focus({ preventScroll: true });
  }, [choice, isOpen, page]);

  useEffect(() => {
    if (!isOpen || !isTauri()) return;
    let disposed = false;
    setOutputsLoading(true);
    setAudioError("");
    void invoke<AudioOutput[]>("get_audio_outputs")
      .then((devices) => { if (!disposed) setOutputs(devices); })
      .catch((reason) => {
        if (!disposed) setAudioError(typeof reason === "string" ? reason : "Audio outputs could not be loaded.");
      })
      .finally(() => { if (!disposed) setOutputsLoading(false); });
    return () => { disposed = true; };
  }, [isOpen]);

  const openChoice = (next: ChoiceState) => {
    choiceReturnRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setChoice(next);
  };

  const closeChoice = () => {
    setChoice(undefined);
  };

  const chooseNativeWallpaper = async () => {
    invalidateArtworkThemes();
    setPickerError("");
    if (!isTauri()) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const selection = await pickArtwork("Choose a static wallpaper");
      if (selection) onChange({ staticWallpaperPath: selection, wallpaperMode: "static" });
    } catch {
      setPickerError("The image picker could not be opened.");
    }
  };

  const chooseBrowserWallpaper = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") onChange({ staticWallpaperPath: reader.result, wallpaperMode: "static" });
    });
    reader.addEventListener("error", () => setPickerError("That image could not be read."));
    reader.readAsDataURL(file);
  };

  const chooseAudioOutput = (id: string) => {
    const gameAudioOutput = id === "system-default" ? undefined : id;
    onChange({ gameAudioOutput });
    setAudioError("");
    if (isTauri()) {
      void invoke("set_game_audio_output", { audioOutput: gameAudioOutput ?? null }).catch((reason) => {
        setAudioError(typeof reason === "string" ? reason : "The running game's audio could not be moved.");
      });
    }
  };

  const selectedOutput = outputs.find((output) => output.id === settings.gameAudioOutput);
  const outputLabel = outputsLoading
    ? "Finding devices…"
    : settings.gameAudioOutput
      ? selectedOutput?.label ?? "Unavailable device"
      : "Follow system default";

  const renderHome = () => (
    <>
      <div className="settings-page-intro"><span>Quick controls</span><p>Adjust the room, then jump into a focused settings category.</p></div>
      <QuickControls onHardwareBrightness={onHardwareBrightness} lumenBrightness={settings.lumenBrightness} onLumenBrightness={(lumenBrightness) => onChange({ lumenBrightness })} panelOpen={isOpen} audioOutput={settings.gameAudioOutput} />
      <div className="console-menu console-menu--categories">
        <ConsoleMenuRow first icon="appearance" title="Appearance" description="Artwork colour, wallpaper and visual style" value={settings.wallpaperMode === "dynamic" ? "Dynamic colour" : "Static colour"} onClick={() => setPage("appearance")} />
        <ConsoleMenuRow icon="display" title="Display & motion" description="Brightness, blur, vignette and parallax" value={`${settings.backgroundBlur}px · ${settings.vignetteStrength}%`} onClick={() => setPage("display")} />
        <ConsoleMenuRow icon="controller" title="Controller" description="Choose how Lumen responds to the sticks" value={settings.controllerScrollMode === "rotation" ? "Rotation" : "Horizontal"} onClick={() => setPage("controller")} />
        <ConsoleMenuRow icon="audio" title="Audio" description="Volume and per-game output routing" value={outputLabel} onClick={() => setPage("audio")} />
        <ConsoleMenuRow icon="library" title="Game library" description="Add, arrange and edit installed games" value={`${games.length} games`} onClick={() => setPage("library")} />
      </div>
    </>
  );

  const renderAppearance = () => (
    <>
      <div className="settings-page-intro"><span>Personalise Lumen</span><p>Each option opens as a controller-friendly console sheet.</p></div>
      <div className="console-menu">
        <div className="artwork-colour-note"><strong>Colour from your artwork</strong><span>The background sets the cover glow, Play button and Settings highlights.</span></div>
        <ConsoleMenuRow
          first icon="display" title="Wallpaper behaviour" description="Follow each selected game or keep one background" value={settings.wallpaperMode === "dynamic" ? "Dynamic" : "Static"}
          onClick={() => openChoice({
            title: "Wallpaper behaviour",
            current: settings.wallpaperMode,
            options: [
              { id: "dynamic", label: "Dynamic", detail: "Use the selected game's background" },
              { id: "static", label: "Static", detail: "Keep one background across the library" },
            ],
            onSelect: (id) => onChange({ wallpaperMode: id === "static" ? "static" : "dynamic" }),
          })}
        />
        <button className="console-wallpaper-row" type="button" onClick={chooseNativeWallpaper}>
          <img src={wallpaperSource} alt="Static wallpaper preview" />
          <span><strong>Static wallpaper</strong><small>{fileName(settings.staticWallpaperPath)} · Select to replace</small></span>
          <i>›</i>
        </button>
      </div>
      <input ref={fileInputRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" onChange={chooseBrowserWallpaper} tabIndex={-1} />
      {pickerError && <p className="settings-error">{pickerError}</p>}
    </>
  );

  const renderDisplay = () => (
    <>
      <div className="settings-page-intro"><span>Display</span><p>Left and right move between sliders. Press A to adjust, then A again to confirm.</p></div>
      <QuickControls onHardwareBrightness={onHardwareBrightness} lumenBrightness={settings.lumenBrightness} onLumenBrightness={(lumenBrightness) => onChange({ lumenBrightness })} panelOpen={isOpen} audioOutput={settings.gameAudioOutput} showVolume={false} first />
      <div className="console-controls console-controls--pair console-controls--visual">
        <ControlSlider
          icon="display"
          title="Background blur"
          detail="Softness applied to game artwork"
          value={settings.backgroundBlur}
          maximum={20}
          step={1}
          unit="px"
          lowLabel="0"
          highLabel="20"
          onChange={(backgroundBlur) => onChange({ backgroundBlur })}
        />
        <ControlSlider
          icon="appearance"
          title="Vignette"
          detail="Darkness around the screen edges"
          value={settings.vignetteStrength}
          lowLabel="○"
          highLabel="●"
          onChange={(vignetteStrength) => onChange({ vignetteStrength })}
        />
      </div>
      <div className="console-menu">
        <ConsoleMenuRow icon="display" title="Background parallax" description="Subtle depth follows pointer movement" toggle={settings.parallaxEnabled} onClick={() => onChange({ parallaxEnabled: !settings.parallaxEnabled })} />
        <ConsoleMenuRow icon="display" title="Fullscreen preference" description="Keep Lumen embedded as a dedicated game shell" toggle={settings.fullscreenPreferred} onClick={() => onChange({ fullscreenPreferred: !settings.fullscreenPreferred })} />
      </div>
    </>
  );

  const renderController = () => (
    <>
      <div className="settings-page-intro"><span>Controller</span><p>D-Pad navigates, A selects, B returns, and the right stick scrolls long pages.</p></div>
      <div className="console-menu">
        <ConsoleMenuRow
          first icon="controller" title="Library scrolling" description={settings.controllerScrollMode === "rotation" ? "Rotate the left stick to move through games" : "Push the left stick left or right to browse"}
          value={settings.controllerScrollMode === "rotation" ? "Rotation" : "Left / right"}
          onClick={() => openChoice({
            title: "Library scrolling",
            current: settings.controllerScrollMode,
            options: [
              { id: "rotation", label: "Stick rotation", detail: "Turn the left stick like a dial" },
              { id: "horizontal", label: "Left and right", detail: "Use a conventional horizontal stick input" },
            ],
            onSelect: (id) => onChange({ controllerScrollMode: id === "horizontal" ? "horizontal" : "rotation" }),
          })}
        />
      </div>
      <div className="controller-map">
        <div><span className="controller-key">✣</span><strong>D-Pad</strong><small>Navigate and adjust</small></div>
        <div><span className="controller-key controller-key--a">A</span><strong>Select</strong><small>Open or confirm</small></div>
        <div><span className="controller-key controller-key--b">B</span><strong>Back</strong><small>Return one level</small></div>
        <div><span className="controller-key">R</span><strong>Right stick</strong><small>Scroll long pages</small></div>
      </div>
    </>
  );

  const renderAudio = () => (
    <>
      <div className="settings-page-intro"><span>Game audio</span><p>Press A to adjust volume. Output changes apply to a running game immediately.</p></div>
      <QuickControls onHardwareBrightness={onHardwareBrightness} lumenBrightness={settings.lumenBrightness} onLumenBrightness={(lumenBrightness) => onChange({ lumenBrightness })} panelOpen={isOpen} audioOutput={settings.gameAudioOutput} showBrightness={false} first />
      <div className="console-menu">
        <ConsoleMenuRow
          icon="audio" title="Preferred game output" description={activeGameId ? "The paused game moves as soon as you select" : "Used the next time a game starts"} value={outputLabel}
          onClick={() => openChoice({
            title: "Preferred game output",
            current: settings.gameAudioOutput ?? "system-default",
            options: [
              { id: "system-default", label: "Follow system default", detail: outputs.find((output) => output.isDefault)?.label },
              ...outputs.map((output) => ({ id: output.id, label: output.label, detail: output.isDefault ? "System default" : "Available" })),
            ],
            onSelect: chooseAudioOutput,
          })}
        />
      </div>
      {audioError && <p className="settings-error">{audioError}</p>}
    </>
  );

  const renderLibrary = () => (
    <>
      <div className="settings-page-intro"><span>{games.length} games</span><p>Every action is reachable with D-Pad and A. Use the right stick to move through the list.</p></div>
      <div className="console-library" data-page-first>
        <LibraryManager games={games} selectedId={selectedId} activeGameId={activeGameId} onAdd={onAdd} onImportFolder={onImportFolder} onEdit={onEdit} onMove={onMove} />
      </div>
    </>
  );

  const renderPage = () => {
    if (page === "appearance") return renderAppearance();
    if (page === "display") return renderDisplay();
    if (page === "controller") return renderController();
    if (page === "audio") return renderAudio();
    if (page === "library") return renderLibrary();
    return renderHome();
  };

  const reset = () => {
    onReset();
    if (isTauri()) void invoke("set_game_audio_output", { audioOutput: null });
  };

  return (
    <div
      className={`settings-backdrop ${isOpen ? "settings-backdrop--open" : ""}`}
      style={SETTINGS_MOTION_STYLE}
      aria-hidden={!isOpen}
      inert={!isOpen}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <aside className="settings-panel settings-panel--console" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="settings-panel__shell" inert={Boolean(choice)}>
          <header className="settings-panel__header">
            <div className="settings-panel__heading">
              {page !== "home" && (
                <button type="button" className="settings-back-button" data-settings-back data-ui-sound="back" onClick={() => setPage("home")} aria-label="Back to settings"><BackIcon /></button>
              )}
              <div><span className="settings-panel__kicker">Lumen console</span><h2 id="settings-title">{PAGE_TITLES[page]}</h2></div>
            </div>
            <button className="icon-button icon-button--large" type="button" data-ui-sound="back" onClick={onClose} aria-label="Close settings"><CloseIcon /></button>
          </header>

          <div ref={bodyRef} className="settings-panel__body" data-controller-scroll>
            {renderPage()}
          </div>

          <footer className="settings-panel__footer">
            <span className="settings-controller-hints"><b className="controller-key">✣</b> Move <b className="controller-key controller-key--a">A</b> Select / adjust <b className="controller-key controller-key--b">B</b> Back</span>
            {page === "home" && <button className="reset-button" type="button" onClick={reset}>Reset settings</button>}
          </footer>
        </div>
        {choice && <ChoiceSheet choice={choice} open={isOpen} onClose={closeChoice} />}
      </aside>
    </div>
  );
}
