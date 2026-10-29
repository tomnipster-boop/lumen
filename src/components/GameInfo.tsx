import type { Game } from "../types/game";
import { formatLastPlayed, formatPlaytime } from "../lib/playtime";

interface GameInfoProps {
  game: Game;
  position: number;
  total: number;
  playing?: boolean;
  onDetails: () => void;
}

export function GameInfo({ game, position, total, playing = false, onDetails }: GameInfoProps) {
  return (
    <header className="game-info" key={game.id}>
      <div className="game-info__eyebrow">
        <span>{playing ? "Playing" : "Local game"}</span>
        <span className="game-info__rule" />
        <span>
          {String(position).padStart(2, "0")} / {String(total).padStart(2, "0")}
        </span>
      </div>
      <h1>{game.title}</h1>
      <div className="game-info__meta">
        <span>{formatPlaytime(game.totalPlaytimeSeconds)} · {formatLastPlayed(game.lastPlayed)}</span>
        {!game.scriptAvailable && <span className="game-info__warning">Launch script missing</span>}
        <button type="button" onClick={onDetails} aria-label={`View details for ${game.title}`}>
          Details →
        </button>
      </div>
    </header>
  );
}
