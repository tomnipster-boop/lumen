interface EmptyLibraryProps {
  loading: boolean;
  onAdd: () => void;
  onImportFolder: () => void;
}

export function EmptyLibrary({ loading, onAdd, onImportFolder }: EmptyLibraryProps) {
  return (
    <section className="empty-library" aria-busy={loading}>
      <span className="empty-library__sigil" aria-hidden="true"><i /><i /></span>
      <p className="empty-library__kicker">Local library</p>
      <h1>{loading ? "Opening your library" : "Your library is empty"}</h1>
      <p className="empty-library__copy">
        {loading
          ? "Reading your saved games…"
          : "Add your first launch script. Lumen keeps the script and game files exactly where they are."}
      </p>
      {!loading && (
        <div className="empty-library__actions">
          <button className="play-button empty-library__primary" type="button" onClick={onAdd}>
            <span className="play-button__icon" aria-hidden="true">+</span>
            <span>Add game</span>
          </button>
          <button className="text-action" type="button" onClick={onImportFolder}>
            Import a folder
          </button>
        </div>
      )}
    </section>
  );
}
