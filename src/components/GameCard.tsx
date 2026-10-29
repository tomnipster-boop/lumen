import type { CSSProperties } from "react";
import { getCardGeometry } from "../lib/carouselGeometry";
import type { Game } from "../types/game";
import { Artwork } from "./Artwork";

interface GameCardProps {
  game: Game;
  offset: number;
  opposite: boolean;
  selected: boolean;
  onSelect: () => void;
}

type CardStyle = CSSProperties & {
  "--distance": number;
  "--card-angle": string;
  "--card-opacity": number;
};

export function GameCard({ game, offset, opposite, selected, onSelect }: GameCardProps) {
  const geometry = getCardGeometry(offset);
  const style: CardStyle = {
    "--distance": geometry.distance,
    "--card-angle": `${geometry.angle}deg`,
    "--card-opacity": geometry.opacity,
  };

  return (
    <button
      className={`game-card ${selected ? "game-card--selected" : ""} ${opposite ? "game-card--opposite" : ""} ${geometry.culled ? "game-card--culled" : ""}`}
      style={style}
      data-offset={offset}
      data-game-id={game.id}
      data-distance={geometry.distance}
      data-ui-sound="scroll"
      type="button"
      aria-label={`${selected ? "Selected game" : "Select"}: ${game.title}`}
      aria-current={selected ? "true" : undefined}
      aria-hidden={opposite || geometry.culled || undefined}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
    >
      <span className="game-card__idle">
        <span className="game-card__visual">
          <Artwork
            path={game.coverPath}
            available={game.coverAvailable}
            title={game.title}
            alt={`${game.title} cover art`}
            className="game-card__artwork"
          />
          <span className="game-card__overlays" aria-hidden="true">
            <span className="game-card__shade" />
          </span>
          <span className="game-card__title">{game.title}</span>
        </span>
      </span>
    </button>
  );
}
