import { useEffect, useMemo, useState } from "react";
import type { DiscoveredScript, Game } from "../types/game";

interface FolderImportProps {
  open: boolean;
  directory: string;
  scripts: DiscoveredScript[];
  games: Game[];
  onImport: (scripts: DiscoveredScript[]) => Promise<void>;
  onClose: () => void;
}

export function FolderImport({
  open,
  directory,
  scripts,
  games,
  onImport,
  onClose,
}: FolderImportProps) {
  const existing = useMemo(() => new Set(games.map((game) => game.launchScript)), [games]);
  const available = useMemo(() => scripts.filter((script) => !existing.has(script.path)), [existing, scripts]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setSelected(new Set(available.map((script) => script.path)));
    setError("");
  }, [available, open]);

  const submit = async () => {
    setImporting(true);
    setError("");
    try {
      await onImport(available.filter((script) => selected.has(script.path)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The selected scripts could not be imported.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className={`import-backdrop ${open ? "import-backdrop--open" : ""}`} aria-hidden={!open} inert={!open}>
      <section className="folder-import" role="dialog" aria-modal="true" aria-labelledby="folder-import-title">
        <header>
          <div><span>Folder scan</span><h2 id="folder-import-title">Choose launchers</h2></div>
          <button className="icon-button icon-button--large" type="button" data-ui-sound="back" onClick={onClose} disabled={importing} aria-label="Close folder import">×</button>
        </header>
        <p className="folder-import__path" title={directory}>{directory}</p>
        <div className="folder-import__list">
          {scripts.length === 0 ? (
            <div className="folder-import__empty">No .sh files were found in this folder.</div>
          ) : scripts.map((script) => {
            const duplicate = existing.has(script.path);
            const checked = selected.has(script.path);
            return (
              <label className={`import-item ${duplicate ? "import-item--duplicate" : ""}`} key={script.path}>
                <input
                  type="checkbox"
                  checked={!duplicate && checked}
                  disabled={duplicate || importing}
                  data-ui-sound="select"
                  onChange={() => setSelected((current) => {
                    const next = new Set(current);
                    if (next.has(script.path)) next.delete(script.path); else next.add(script.path);
                    return next;
                  })}
                />
                <span><strong>{script.title}</strong><small>{script.path}</small></span>
                {duplicate && <em>Already added</em>}
              </label>
            );
          })}
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <footer>
          <span>{selected.size} selected</span>
          <div>
            <button className="secondary-button" type="button" data-ui-sound="back" onClick={onClose} disabled={importing}>Cancel</button>
            <button className="accent-button" type="button" onClick={submit} disabled={importing || selected.size === 0}>
              {importing ? "Importing…" : "Import selected"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
