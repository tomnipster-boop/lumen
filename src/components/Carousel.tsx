import { useMemo, useRef, type CSSProperties } from "react";
import type { Game } from "../types/game";
import { getRelativeOffset } from "../lib/carouselGeometry";
import { CAROUSEL_MOTION } from "../lib/carouselMotion";
import { useCarouselIdle } from "../hooks/useCarouselIdle";
import { GameCard } from "./GameCard";

interface CarouselProps {
  games: Game[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  active: boolean;
  rotationActive: boolean;
}

export function Carousel({
  games,
  selectedIndex,
  onSelect,
  active,
  rotationActive,
}: CarouselProps) {
  const carouselRef = useRef<HTMLElement>(null);
  const libraryKey = useMemo(() => JSON.stringify(games.map((game) => game.id)), [games]);
  useCarouselIdle(carouselRef, selectedIndex, libraryKey, active, rotationActive);
  const style = {
    "--carousel-travel-duration": `${rotationActive ? CAROUSEL_MOTION.rotationTravelMs : CAROUSEL_MOTION.travelMs}ms`,
    "--carousel-travel-easing": CAROUSEL_MOTION.travelEasing,
  } as CSSProperties;

  return (
    <section ref={carouselRef} className="carousel" style={style} aria-label="Game library">
      <div className="carousel__stage">
        <div className="carousel__ring">
          {games.map((game, index) => {
            const offset = getRelativeOffset(index, selectedIndex, games.length);
            const opposite = games.length > 1
              && games.length % 2 === 0
              && Math.abs(offset) === games.length / 2;
            return (
              <GameCard
                key={game.id}
                game={game}
                offset={offset}
                opposite={opposite}
                selected={index === selectedIndex}
                onSelect={() => onSelect(index)}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}
