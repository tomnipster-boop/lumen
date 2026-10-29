import { useEffect, useRef } from "react";

interface QuitGameDialogProps {
  open: boolean;
  gameTitle?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function QuitGameDialog({ open, gameTitle, onConfirm, onCancel }: QuitGameDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => cancelRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  return (
    <div
      className={`quit-confirm-backdrop ${open ? "quit-confirm-backdrop--open" : ""}`}
      aria-hidden={!open}
      inert={!open}
    >
      <section className="quit-confirm" role="alertdialog" aria-modal="true" aria-labelledby="quit-confirm-title" aria-describedby="quit-confirm-copy">
        <span className="quit-confirm__kicker">Running game</span>
        <h2 id="quit-confirm-title">Quit {gameTitle ?? "this game"}?</h2>
        <p id="quit-confirm-copy">Unsaved progress in the game may be lost.</p>
        <div>
          <button ref={cancelRef} className="secondary-button" type="button" data-ui-sound="back" onClick={onCancel}>No, go back</button>
          <button className="danger-button quit-confirm__yes" type="button" onClick={onConfirm}>Yes, quit</button>
        </div>
      </section>
    </div>
  );
}
