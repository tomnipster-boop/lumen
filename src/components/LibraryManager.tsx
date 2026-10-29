import type { Game } from "../types/game";
import { Artwork } from "./Artwork";

interface LibraryManagerProps {
  games: Game[];
  selectedId?: string;
  activeGameId?: string;
  onAdd: () => void;
  onImportFolder: () => void;
  onEdit: (game: Game) => void;
  onMove: (id: string, direction: -1 | 1) => void;
}

export function LibraryManager({
  games,
  selectedId,
  activeGameId,
  onAdd,
  onImportFolder,
  onEdit,
  onMove,
}: LibraryManagerProps) {
  return (
    <section className="library-manager">
      <div className="library-manager__actions">
        <button className="accent-outline-button" type="button" onClick={onAdd}>+ Add game</button>
        <button className="secondary-button" type="button" onClick={onImportFolder}>Import folder</button>
      </div>

      {games.length === 0 ? (
        <div className="library-manager__empty">
          <strong>No games yet</strong>
          <span>Add one script or scan a folder of .sh launchers.</span>
        </div>
      ) : (
        <div className="library-list" aria-label="Library order">
          {games.map((game, index) => {
            const running = game.id === activeGameId;
            return (
            <article className={`library-item ${game.id === selectedId ? "library-item--selected" : ""}`} key={game.id}>
              <Artwork path={game.coverPath} available={game.coverAvailable} title={game.title} className="library-item__cover" />
              <div className="library-item__copy">
                <div>
                  <strong>{game.title}</strong>
                  {!game.scriptAvailable && <span className="missing-badge">Script missing</span>}
                  {running && <span className="running-badge">Running</span>}
                </div>
                <span title={game.launchScript}>{game.launchScript}</span>
              </div>
              <div className="library-item__order" aria-label={`Reorder ${game.title}`}>
                <button type="button" onClick={() => onMove(game.id, -1)} disabled={index === 0} aria-label={`Move ${game.title} earlier`}>↑</button>
                <button type="button" onClick={() => onMove(game.id, 1)} disabled={index === games.length - 1} aria-label={`Move ${game.title} later`}>↓</button>
              </div>
              <button className="library-item__edit" type="button" onClick={() => onEdit(game)} disabled={running} title={running ? "Close the game before editing it" : undefined}>Edit</button>
            </article>
          );})}
        </div>
      )}
    </section>
  );
}
