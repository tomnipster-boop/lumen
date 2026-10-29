import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { LauncherSettings } from "../types/settings";
import { bindSettingsScroll } from "../lib/settingsMotion";
import { QuickControls } from "./SettingsPanel";

interface AudioOutput { id: string; label: string; isDefault: boolean; }
interface QuickSettingsProps {
  open: boolean;
  onHardwareBrightness: (available: boolean) => void;
  settings: LauncherSettings;
  onChange: (updates: Partial<LauncherSettings>) => void;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}

export function QuickSettings({ open, settings, onChange, onClose, returnFocusRef, onHardwareBrightness }: QuickSettingsProps) {
  const panelRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLButtonElement>(null);
  const previousOpen = useRef(false);
  const previousChoosing = useRef(false);
  const [outputs, setOutputs] = useState<AudioOutput[]>([]);
  const [choosing, setChoosing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [outputRevision, setOutputRevision] = useState(0);
  const lifetime = useRef(0);

  useEffect(() => {
    const generation = ++lifetime.current;
    if (!open) return;
    setError(""); setLoading(true);
    if (!isTauri()) { setLoading(false); setError("System audio is available in the desktop app."); return; }
    void invoke<AudioOutput[]>("get_audio_outputs")
      .then(next => { if (lifetime.current === generation) setOutputs(next); })
      .catch(reason => { if (lifetime.current === generation) setError(typeof reason === "string" ? reason : "Audio devices could not be read."); })
      .finally(() => { if (lifetime.current === generation) setLoading(false); });
    return () => { lifetime.current++; };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      if (previousOpen.current) returnFocusRef.current?.focus({ preventScroll: true });
      previousOpen.current = false;
      setLoading(true);
      setChoosing(false);
      return;
    }
    previousOpen.current = true;
    const body = bodyRef.current;
    if (!body) return;
    const dispose = bindSettingsScroll(body);
    panelRef.current?.focus({ preventScroll: true });
    const focusInitial = () => {
      if (document.activeElement !== panelRef.current) { observer.disconnect(); return; }
      const target = body.querySelector<HTMLElement>("[data-page-first]:not(:disabled)");
      if (target) { target.focus({ preventScroll: true }); observer.disconnect(); }
    };
    const observer = new MutationObserver(focusInitial);
    observer.observe(body, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled"] });
    focusInitial();
    return () => { observer.disconnect(); dispose(); };
  }, [open, returnFocusRef]);

  useLayoutEffect(() => {
    if (!open) return;
    if (!choosing && previousChoosing.current) outputRef.current?.focus({ preventScroll: true });
    previousChoosing.current = choosing;
    if (choosing) bodyRef.current?.querySelector<HTMLElement>(".quick-output-list button[aria-pressed='true'], .quick-output-list button")?.focus({ preventScroll: true });
  }, [choosing, open]);

  const chooseOutput = async (id: string) => {
    if (busy) return;
    const generation = lifetime.current;
    setBusy(true); setError("");
    try {
      await invoke("set_default_audio_output", { id });
      const next = await invoke<AudioOutput[]>("get_audio_outputs");
      if (generation !== lifetime.current) return;
      setOutputs(next); setChoosing(false); setOutputRevision(value => value + 1);
      if (!settings.gameAudioOutput) {
        void invoke("set_game_audio_output", { audioOutput: null }).catch(reason => {
          if (generation === lifetime.current) setError(typeof reason === "string" ? reason : "The running game could not follow the new output.");
        });
      }
      outputRef.current?.focus({ preventScroll: true });
    } catch (reason) {
      if (generation === lifetime.current) setError(typeof reason === "string" ? reason : "The audio output could not be changed.");
    } finally { setBusy(false); }
  };
  const closeOutput = () => { setChoosing(false); outputRef.current?.focus({ preventScroll: true }); };

  return (
    <div className={`quick-backdrop ${open ? "quick-backdrop--open" : ""}`} inert={!open} aria-hidden={!open}
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={panelRef} className="quick-settings" role="dialog" aria-modal="true" aria-labelledby="quick-title" tabIndex={-1}>
        <header><div><span>QUICK OPTIONS</span><h2 id="quick-title">Make yourself comfortable</h2></div>
          <button type="button" className="quick-close" aria-label="Close quick settings" data-ui-sound="back" onClick={onClose}>×</button></header>
        <div ref={bodyRef} className="quick-settings__body" data-controller-scroll>
          <QuickControls onHardwareBrightness={onHardwareBrightness} key={outputRevision} panelOpen={open && !loading} audioOutput={outputs.find(output => output.isDefault)?.id} first volumeTitle="Audio" volumeFirst
            lumenBrightness={settings.lumenBrightness} onLumenBrightness={lumenBrightness => onChange({ lumenBrightness })} />
          <button ref={outputRef} className="quick-output" type="button" disabled={loading || outputs.length === 0 || busy}
            aria-expanded={choosing} onClick={() => setChoosing(value => !value)}>
            <span>Audio output device</span><strong>{loading ? "Finding devices…" : outputs.find(output => output.isDefault)?.label ?? "No audio output available"}</strong><i>⌄</i>
          </button>
          {choosing && <div className="quick-output-list" role="group" aria-label="Audio output devices">
            {outputs.map(output => <button key={output.id} type="button" aria-pressed={output.isDefault} disabled={busy}
              onClick={() => { void chooseOutput(output.id); }}>{output.label}<span>{output.isDefault ? "✓" : ""}</span></button>)}
            <button type="button" data-quick-back data-ui-sound="back" onClick={closeOutput}>Back to quick settings</button>
          </div>}
          {error && <p className="settings-error" role="status">{error}</p>}
        </div>
        <footer><span><kbd>A</kbd> Select / adjust</span><span><kbd>B</kbd> Back</span></footer>
      </section>
    </div>
  );
}
