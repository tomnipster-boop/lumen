import { useEffect, useRef } from "react";
import { formatLastPlayed, formatPlaytime } from "../lib/playtime";
import type { Game } from "../types/game";
import { Artwork } from "./Artwork";

interface GameDetailsProps {
  game?: Game;
  open: boolean;
  running: boolean;
  activeGameTitle?: string;
  onPlay: () => void;
  onEdit: () => void;
  onClose: () => void;
}

function CloseIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
}

export function GameDetails({ game, open, running, activeGameTitle, onPlay, onEdit, onClose }: GameDetailsProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  return (
    <div
      className={`details-backdrop ${open ? "details-backdrop--open" : ""}`}
      aria-hidden={!open}
      inert={!open}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      {game && (
        <section className="game-details" role="dialog" aria-modal="true" aria-labelledby="game-details-title">
          <div className="game-details__visual">
            <Artwork path={game.coverPath} available={game.coverAvailable} title={game.title} alt={`${game.title} cover art`} className="game-details__cover" />
            <span className="game-details__visual-wash" />
          </div>
          <div className="game-details__content">
            <header>
              <div><span>Game details</span><h2 id="game-details-title">{game.title}</h2></div>
              <button ref={closeRef} className="icon-button icon-button--large" type="button" data-ui-sound="back" onClick={onClose} aria-label="Close details"><CloseIcon /></button>
            </header>
            <div className="game-details__stats">
              <div><span>Total playtime</span><strong>{formatPlaytime(game.totalPlaytimeSeconds)}</strong></div>
              <div><span>Last played</span><strong>{formatLastPlayed(game.lastPlayed)}</strong></div>
            </div>
            <div className="game-details__path">
              <span>Launch script</span>
              <code title={game.launchScript}>{game.launchScript}</code>
              {!game.scriptAvailable && <em>Script missing</em>}
            </div>
            {running && <p className="game-details__running">{game.title} is running. Management is locked until it closes.</p>}
            <footer>
              <button className="secondary-button" type="button" onClick={onEdit} disabled={running}>Edit game</button>
              <button className="play-button game-details__play" type="button" onClick={onPlay} disabled={Boolean(activeGameTitle) || !game.scriptAvailable}>
                <span className="play-button__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8.3 5.8v12.4L18 12 8.3 5.8Z" fill="currentColor" /></svg></span>
                <span>{running ? "Running" : activeGameTitle ? "Unavailable" : "Play"}</span>
              </button>
            </footer>
          </div>
        </section>
      )}
    </div>
  );
}
