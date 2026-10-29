import { useEffect, useRef, useState, type FormEvent } from "react";
import { inferTitleFromScript } from "../lib/assets";
import { pickArtwork, pickLaunchScript } from "../lib/dialogs";
import type { Game, GameDraft } from "../types/game";
import { Artwork } from "./Artwork";

interface GameEditorProps {
  open: boolean;
  game?: Game;
  initialScriptPath?: string;
  locked?: boolean;
  onSave: (draft: GameDraft, id?: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onClose: () => void;
}

const EMPTY_DRAFT: GameDraft = { title: "", launchScript: "" };

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function GameEditor({
  open,
  game,
  initialScriptPath,
  locked = false,
  onSave,
  onRemove,
  onClose,
}: GameEditorProps) {
  const titleRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<GameDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    if (!open) return;
    const script = game?.launchScript ?? initialScriptPath ?? "";
    setDraft(
      game
        ? {
            title: game.title,
            launchScript: game.launchScript,
            coverPath: game.coverPath,
            backgroundPath: game.backgroundPath,
          }
        : {
            title: script ? inferTitleFromScript(script) : "",
            launchScript: script,
          },
    );
    setError("");
    setConfirmRemove(false);
    const frame = window.requestAnimationFrame(() => titleRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [game, initialScriptPath, open]);

  const chooseScript = async () => {
    try {
      const path = await pickLaunchScript();
      if (!path) return;
      setDraft((current) => ({
        ...current,
        launchScript: path,
        title: current.title.trim() ? current.title : inferTitleFromScript(path),
      }));
    } catch {
      setError("The launch-script picker could not be opened.");
    }
  };

  const chooseImage = async (field: "coverPath" | "backgroundPath") => {
    try {
      const path = await pickArtwork(
        field === "coverPath" ? "Choose square cover art" : "Choose game background art",
      );
      if (path) setDraft((current) => ({ ...current, [field]: path }));
    } catch {
      setError("The artwork picker could not be opened.");
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave(draft, game?.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The game could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!game) return;
    setSaving(true);
    setError("");
    try {
      await onRemove(game.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The game could not be removed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`editor-backdrop ${open ? "editor-backdrop--open" : ""}`}
      aria-hidden={!open}
      inert={!open}
      onMouseDown={(event) => {
        if (!saving && event.target === event.currentTarget) onClose();
      }}
    >
      <form className="game-editor" role="dialog" aria-modal="true" aria-labelledby="game-editor-title" onSubmit={submit}>
        <header className="game-editor__header">
          <div>
            <span>{game ? "Library entry" : "New local game"}</span>
            <h2 id="game-editor-title">{game ? `Edit ${game.title}` : "Add game"}</h2>
          </div>
          <button className="icon-button icon-button--large" type="button" data-ui-sound="back" onClick={onClose} disabled={saving} aria-label="Close game editor">
            <CloseIcon />
          </button>
        </header>

        <div className="game-editor__body">
          {locked && <p className="editor-lock" role="status">This game is running. Close it before changing or removing its library entry.</p>}
          <label className="editor-field">
            <span>Title</span>
            <input
              ref={titleRef}
              value={draft.title}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              placeholder="Game title"
              autoComplete="off"
              disabled={locked}
            />
          </label>

          <div className="editor-field">
            <span>Launch script</span>
            <div className="path-control">
              <input value={draft.launchScript} readOnly placeholder="Choose a .sh file" />
              <button type="button" onClick={chooseScript} disabled={locked}>Choose</button>
            </div>
            <small>Lumen runs this file with Bash from the script's own folder.</small>
          </div>

          <div className="editor-art-grid">
            <section className="editor-art">
              <div className="editor-art__heading">
                <div><span>Cover art</span><small>Square artwork works best</small></div>
                {draft.coverPath && <button type="button" onClick={() => setDraft((current) => ({ ...current, coverPath: undefined }))} disabled={locked}>Clear</button>}
              </div>
              <Artwork path={draft.coverPath} available={!game || game.coverPath !== draft.coverPath || game.coverAvailable} title={draft.title || "Game"} className="editor-art__cover" alt="Cover art preview" />
              <button className="editor-art__choose" type="button" onClick={() => chooseImage("coverPath")} disabled={locked}>Choose cover</button>
            </section>

            <section className="editor-art">
              <div className="editor-art__heading">
                <div><span>Background art</span><small>Wide artwork fills the scene</small></div>
                {draft.backgroundPath && <button type="button" onClick={() => setDraft((current) => ({ ...current, backgroundPath: undefined }))} disabled={locked}>Clear</button>}
              </div>
              <Artwork path={draft.backgroundPath} available={!game || game.backgroundPath !== draft.backgroundPath || game.backgroundAvailable} title={draft.title || "Game"} className="editor-art__background" alt="Background art preview" />
              <button className="editor-art__choose" type="button" onClick={() => chooseImage("backgroundPath")} disabled={locked}>Choose background</button>
            </section>
          </div>

          {error && <p className="form-error" role="alert">{error}</p>}

          {confirmRemove && game && (
            <div className="remove-confirmation" role="alertdialog" aria-label="Confirm removal">
              <div>
                <strong>Remove “{game.title}” from the library?</strong>
                <span>Your script, artwork, and game files will not be deleted.</span>
              </div>
              <button type="button" data-ui-sound="back" onClick={() => setConfirmRemove(false)}>Keep</button>
              <button className="danger-button" type="button" onClick={remove}>Remove</button>
            </div>
          )}
        </div>

        <footer className="game-editor__footer">
          {game && !confirmRemove ? (
            <button className="remove-button" type="button" onClick={() => setConfirmRemove(true)} disabled={saving || locked}>Remove game</button>
          ) : <span />}
          <div>
            <button className="secondary-button" type="button" data-ui-sound="back" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="accent-button" type="submit" disabled={saving || locked || !draft.title.trim() || !draft.launchScript}>
              {saving ? "Saving…" : "Save game"}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
