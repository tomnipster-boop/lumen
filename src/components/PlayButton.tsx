interface PlayButtonProps {
  gameTitle: string;
  onPlay: () => void;
  launching: boolean;
  activeGameTitle?: string;
  activeGameSelected?: boolean;
  activeGamePaused?: boolean;
}

export function PlayButton({ gameTitle, onPlay, launching, activeGameTitle, activeGameSelected = false, activeGamePaused = false }: PlayButtonProps) {
  const unavailable = launching || Boolean(activeGameTitle && !activeGameSelected);
  const label = launching
    ? "Launching…"
    : activeGameSelected
      ? activeGamePaused ? "Resume" : "Return"
      : activeGameTitle ? "Running" : "Play";
  return (
    <button
      className="play-button"
      type="button"
      onClick={onPlay}
      disabled={unavailable}
      aria-label={launching
        ? `Launching ${gameTitle}`
        : activeGameSelected
          ? `${activeGamePaused ? "Resume" : "Return to"} ${gameTitle}`
          : activeGameTitle ? `${activeGameTitle} is running` : `Play ${gameTitle}`}
    >
      <span className="play-button__icon" aria-hidden="true">
        <kbd>A</kbd>
      </span>
      <span>{label}</span>
    </button>
  );
}
