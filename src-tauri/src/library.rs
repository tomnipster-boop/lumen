use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashSet,
    fs::{self, File},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};

use crate::launcher::LaunchTracker;

const LIBRARY_VERSION: u32 = 2;
const LIBRARY_FILE: &str = "library.json";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    pub id: String,
    pub title: String,
    pub launch_script: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background_path: Option<String>,
    pub sort_order: usize,
    #[serde(default)]
    pub total_playtime_seconds: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_played: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameDraft {
    pub title: String,
    pub launch_script: String,
    pub cover_path: Option<String>,
    pub background_path: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameView {
    #[serde(flatten)]
    pub game: Game,
    pub script_available: bool,
    pub cover_available: bool,
    pub background_available: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryResponse {
    pub version: u32,
    pub games: Vec<GameView>,
    pub warning: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredScript {
    pub path: String,
    pub title: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMetadata {
    pub total_playtime_seconds: u64,
    pub last_played: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
struct Library {
    version: u32,
    games: Vec<Game>,
}

struct LoadedLibrary {
    library: Library,
    warning: Option<String>,
    can_save: bool,
}

fn app_library_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(LIBRARY_FILE))
        .map_err(|error| format!("Lumen's library location is unavailable: {error}"))
}

fn normalize_orders(games: &mut [Game]) {
    games.sort_by_key(|game| game.sort_order);
    for (index, game) in games.iter_mut().enumerate() {
        game.sort_order = index;
    }
}

fn validate_loaded_game(game: &Game) -> bool {
    !game.id.trim().is_empty()
        && !game.title.trim().is_empty()
        && !game.launch_script.trim().is_empty()
        && Path::new(&game.launch_script).is_absolute()
}

fn load_library_file(path: &Path) -> Result<LoadedLibrary, String> {
    if !path.exists() {
        return Ok(LoadedLibrary {
            library: Library {
                version: LIBRARY_VERSION,
                games: Vec::new(),
            },
            warning: None,
            can_save: true,
        });
    }

    let raw = fs::read_to_string(path)
        .map_err(|error| format!("The library file could not be read: {error}"))?;
    if raw.trim().is_empty() {
        return Ok(LoadedLibrary {
            library: Library {
                version: LIBRARY_VERSION,
                games: Vec::new(),
            },
            warning: None,
            can_save: true,
        });
    }

    let value: Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(error) => {
            return Ok(LoadedLibrary {
                library: Library {
                    version: LIBRARY_VERSION,
                    games: Vec::new(),
                },
                warning: Some(format!(
                    "library.json is malformed and was left untouched ({error})."
                )),
                can_save: false,
            });
        }
    };

    let Some(entries) = value.get("games").and_then(Value::as_array) else {
        return Ok(LoadedLibrary {
            library: Library {
                version: LIBRARY_VERSION,
                games: Vec::new(),
            },
            warning: Some("library.json has no valid games list and was left untouched.".into()),
            can_save: false,
        });
    };

    let mut games = Vec::with_capacity(entries.len());
    let mut skipped = 0usize;
    let mut ids = HashSet::new();
    let mut scripts = HashSet::new();

    for entry in entries {
        let Ok(game) = serde_json::from_value::<Game>(entry.clone()) else {
            skipped += 1;
            continue;
        };
        let normalized_script = normalize_for_compare(&game.launch_script);
        if !validate_loaded_game(&game)
            || !ids.insert(game.id.clone())
            || !scripts.insert(normalized_script)
        {
            skipped += 1;
            continue;
        }
        games.push(game);
    }

    normalize_orders(&mut games);
    Ok(LoadedLibrary {
        library: Library {
            version: LIBRARY_VERSION,
            games,
        },
        warning: (skipped > 0).then(|| {
            format!(
                "{skipped} invalid or duplicate library {} skipped; valid games are still available.",
                if skipped == 1 { "entry was" } else { "entries were" }
            )
        }),
        can_save: true,
    })
}

fn save_library_file(path: &Path, library: &Library) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "The library location has no parent directory.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("The library directory could not be created: {error}"))?;

    let mut snapshot = library.clone();
    snapshot.version = LIBRARY_VERSION;
    let serialized = serde_json::to_vec_pretty(&snapshot)
        .map_err(|error| format!("The library could not be encoded: {error}"))?;
    let temporary = parent.join(format!("{LIBRARY_FILE}.tmp"));
    fs::write(&temporary, serialized)
        .map_err(|error| format!("The library update could not be written: {error}"))?;
    fs::rename(&temporary, path)
        .map_err(|error| format!("The library update could not be committed: {error}"))?;
    Ok(())
}

fn load_for_mutation(app: &AppHandle) -> Result<(PathBuf, Library), String> {
    let path = app_library_path(app)?;
    let loaded = load_library_file(&path)?;
    if !loaded.can_save {
        return Err(format!(
            "Lumen will not overwrite the current library file. {}",
            loaded
                .warning
                .unwrap_or_else(|| "Repair or move library.json, then try again.".into())
        ));
    }
    Ok((path, loaded.library))
}

fn is_readable_file(path: &Path) -> bool {
    path.is_file() && File::open(path).is_ok()
}

fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp"
            )
        })
        .unwrap_or(false)
}

fn allow_game_assets(app: &AppHandle, games: &[Game]) {
    let scope = app.asset_protocol_scope();
    for path in games.iter().flat_map(|game| {
        [game.cover_path.as_deref(), game.background_path.as_deref()]
            .into_iter()
            .flatten()
    }) {
        if Path::new(path).is_file() {
            let _ = scope.allow_file(path);
        }
    }
}

fn to_response(app: &AppHandle, loaded: LoadedLibrary) -> LibraryResponse {
    allow_game_assets(app, &loaded.library.games);
    let games =
        loaded
            .library
            .games
            .into_iter()
            .map(|game| {
                let script_available = is_readable_file(Path::new(&game.launch_script));
                let cover_available = game.cover_path.as_deref().is_some_and(|path| {
                    is_readable_file(Path::new(path)) && is_image(Path::new(path))
                });
                let background_available = game.background_path.as_deref().is_some_and(|path| {
                    is_readable_file(Path::new(path)) && is_image(Path::new(path))
                });
                GameView {
                    game,
                    script_available,
                    cover_available,
                    background_available,
                }
            })
            .collect();

    LibraryResponse {
        version: loaded.library.version.max(LIBRARY_VERSION),
        games,
        warning: loaded.warning,
    }
}

fn response_after_save(app: &AppHandle, library: Library) -> LibraryResponse {
    to_response(
        app,
        LoadedLibrary {
            library,
            warning: None,
            can_save: true,
        },
    )
}

fn canonical_file(path: &str, kind: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(path.trim());
    if !candidate.is_absolute() {
        return Err(format!("The {kind} path must be absolute."));
    }
    if !candidate.exists() {
        return Err(format!(
            "The {kind} no longer exists: {}",
            candidate.display()
        ));
    }
    if !candidate.is_file() {
        return Err(format!(
            "The {kind} path is not a file: {}",
            candidate.display()
        ));
    }
    File::open(&candidate)
        .map_err(|_| format!("The {kind} could not be opened: {}", candidate.display()))?;
    candidate
        .canonicalize()
        .map_err(|error| format!("The {kind} path could not be resolved: {error}"))
}

fn validate_script(path: &str) -> Result<PathBuf, String> {
    let canonical = canonical_file(path, "launch script")?;
    let is_shell_script = canonical
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("sh"));
    if !is_shell_script {
        return Err(format!(
            "Choose a .sh launch script: {}",
            canonical.display()
        ));
    }
    Ok(canonical)
}

fn validate_artwork(path: Option<String>, label: &str) -> Result<Option<String>, String> {
    let Some(path) = path.filter(|path| !path.trim().is_empty()) else {
        return Ok(None);
    };
    let canonical = canonical_file(&path, label)?;
    if !is_image(&canonical) {
        return Err(format!(
            "Choose a PNG, JPG, JPEG, WebP, GIF, or BMP for {label}: {}",
            canonical.display()
        ));
    }
    Ok(Some(canonical.to_string_lossy().into_owned()))
}

fn validate_draft(draft: GameDraft) -> Result<GameDraft, String> {
    let title = draft.title.trim().to_string();
    if title.is_empty() {
        return Err("Enter a game title before saving.".into());
    }
    let script = validate_script(&draft.launch_script)?;
    Ok(GameDraft {
        title,
        launch_script: script.to_string_lossy().into_owned(),
        cover_path: validate_artwork(draft.cover_path, "cover art")?,
        background_path: validate_artwork(draft.background_path, "background art")?,
    })
}

fn normalize_for_compare(path: &str) -> String {
    Path::new(path)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(path))
        .to_string_lossy()
        .into_owned()
}

fn find_duplicate<'a>(
    games: &'a [Game],
    launch_script: &str,
    excluded_id: Option<&str>,
) -> Option<&'a Game> {
    let normalized = normalize_for_compare(launch_script);
    games.iter().find(|game| {
        excluded_id != Some(game.id.as_str())
            && normalize_for_compare(&game.launch_script) == normalized
    })
}

fn next_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("game-{nanos:x}-{:x}", std::process::id())
}

pub fn infer_title(path: &Path) -> String {
    let stem = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("Game");
    stem.split(|character: char| character == '-' || character == '_' || character == '.')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut characters = part.chars();
            match characters.next() {
                Some(first) => first.to_uppercase().collect::<String>() + characters.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[tauri::command]
pub fn get_library(app: AppHandle) -> Result<LibraryResponse, String> {
    let loaded = load_library_file(&app_library_path(&app)?)?;
    Ok(to_response(&app, loaded))
}

#[tauri::command]
pub fn add_game(app: AppHandle, draft: GameDraft) -> Result<LibraryResponse, String> {
    let draft = validate_draft(draft)?;
    let (path, mut library) = load_for_mutation(&app)?;
    if let Some(existing) = find_duplicate(&library.games, &draft.launch_script, None) {
        return Err(format!(
            "{} is already in the library as \"{}\".",
            draft.launch_script, existing.title
        ));
    }

    let sort_order = library.games.len();
    library.games.push(Game {
        id: next_id(),
        title: draft.title,
        launch_script: draft.launch_script,
        cover_path: draft.cover_path,
        background_path: draft.background_path,
        sort_order,
        total_playtime_seconds: 0,
        last_played: None,
    });
    library.version = LIBRARY_VERSION;
    save_library_file(&path, &library)?;
    Ok(response_after_save(&app, library))
}

#[tauri::command]
pub fn update_game(
    app: AppHandle,
    tracker: State<'_, LaunchTracker>,
    id: String,
    draft: GameDraft,
) -> Result<LibraryResponse, String> {
    if tracker.is_game_running(&id) {
        return Err("Wait for this game to close before editing it.".into());
    }
    let draft = validate_draft(draft)?;
    let (path, mut library) = load_for_mutation(&app)?;
    if let Some(existing) = find_duplicate(&library.games, &draft.launch_script, Some(&id)) {
        return Err(format!(
            "{} is already in the library as \"{}\".",
            draft.launch_script, existing.title
        ));
    }

    let game = library
        .games
        .iter_mut()
        .find(|game| game.id == id)
        .ok_or_else(|| "That game is no longer in the library.".to_string())?;
    game.title = draft.title;
    game.launch_script = draft.launch_script;
    game.cover_path = draft.cover_path;
    game.background_path = draft.background_path;
    save_library_file(&path, &library)?;
    Ok(response_after_save(&app, library))
}

#[tauri::command]
pub fn remove_game(
    app: AppHandle,
    tracker: State<'_, LaunchTracker>,
    id: String,
) -> Result<LibraryResponse, String> {
    if tracker.is_game_running(&id) {
        return Err("Wait for this game to close before removing it.".into());
    }
    let (path, mut library) = load_for_mutation(&app)?;
    let original_length = library.games.len();
    library.games.retain(|game| game.id != id);
    if library.games.len() == original_length {
        return Err("That game is no longer in the library.".into());
    }
    normalize_orders(&mut library.games);
    save_library_file(&path, &library)?;
    Ok(response_after_save(&app, library))
}

#[tauri::command]
pub fn reorder_games(app: AppHandle, ordered_ids: Vec<String>) -> Result<LibraryResponse, String> {
    let (path, mut library) = load_for_mutation(&app)?;
    let unique_ids: HashSet<_> = ordered_ids.iter().collect();
    if ordered_ids.len() != library.games.len() || unique_ids.len() != ordered_ids.len() {
        return Err("The new library order is incomplete or contains duplicates.".into());
    }
    let existing_ids: HashSet<_> = library.games.iter().map(|game| &game.id).collect();
    if !ordered_ids.iter().all(|id| existing_ids.contains(id)) {
        return Err("The new library order contains an unknown game.".into());
    }

    for game in &mut library.games {
        game.sort_order = ordered_ids
            .iter()
            .position(|id| id == &game.id)
            .expect("IDs were checked before reordering");
    }
    normalize_orders(&mut library.games);
    save_library_file(&path, &library)?;
    Ok(response_after_save(&app, library))
}

#[tauri::command]
pub fn scan_script_folder(directory: String) -> Result<Vec<DiscoveredScript>, String> {
    let directory = PathBuf::from(directory.trim());
    if !directory.is_absolute() || !directory.is_dir() {
        return Err(format!(
            "Choose an existing script folder: {}",
            directory.display()
        ));
    }

    let mut scripts = fs::read_dir(&directory)
        .map_err(|error| format!("The script folder could not be read: {error}"))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("sh"))
        })
        .filter_map(|path| path.canonicalize().ok())
        .map(|path| DiscoveredScript {
            title: infer_title(&path),
            path: path.to_string_lossy().into_owned(),
        })
        .collect::<Vec<_>>();
    scripts.sort_by(|left, right| left.title.to_lowercase().cmp(&right.title.to_lowercase()));
    Ok(scripts)
}

#[tauri::command]
pub fn register_asset_path(app: AppHandle, path: String) -> Result<(), String> {
    let canonical = canonical_file(&path, "image")?;
    if !is_image(&canonical) {
        return Err("The selected asset is not a supported image.".into());
    }
    app.asset_protocol_scope()
        .allow_file(&canonical)
        .map_err(|error| format!("The image could not be added to Lumen's asset scope: {error}"))
}

pub(crate) fn resolve_game_for_launch(
    app: &AppHandle,
    id: &str,
) -> Result<(Game, PathBuf), String> {
    let loaded = load_library_file(&app_library_path(&app)?)?;
    let game = loaded
        .library
        .games
        .into_iter()
        .find(|game| game.id == id)
        .ok_or_else(|| "That game is no longer in the library.".to_string())?;
    let script = validate_script(&game.launch_script)?;
    Ok((game, script))
}

pub(crate) fn record_game_session(
    app: &AppHandle,
    id: &str,
    elapsed_seconds: u64,
    last_played: String,
) -> Result<SessionMetadata, String> {
    // Always reload here so a session ending cannot overwrite newer library edits.
    let (path, mut library) = load_for_mutation(app)?;
    let game = library
        .games
        .iter_mut()
        .find(|game| game.id == id)
        .ok_or_else(|| "The finished game is no longer in the library.".to_string())?;
    game.total_playtime_seconds = game.total_playtime_seconds.saturating_add(elapsed_seconds);
    game.last_played = Some(last_played.clone());
    let metadata = SessionMetadata {
        total_playtime_seconds: game.total_playtime_seconds,
        last_played,
    };
    save_library_file(&path, &library)?;
    Ok(metadata)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_directory(label: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("lumen-{label}-{suffix}"))
    }

    #[test]
    fn infers_human_title_from_script_name() {
        assert_eq!(
            infer_title(Path::new("persona_5-royal.sh")),
            "Persona 5 Royal"
        );
    }

    #[test]
    fn library_round_trips_and_keeps_order() {
        let directory = test_directory("library");
        let path = directory.join(LIBRARY_FILE);
        let library = Library {
            version: LIBRARY_VERSION,
            games: vec![Game {
                id: "stable-id".into(),
                title: "Test Game".into(),
                launch_script: "/tmp/test.sh".into(),
                cover_path: None,
                background_path: None,
                sort_order: 0,
                total_playtime_seconds: 0,
                last_played: None,
            }],
        };
        save_library_file(&path, &library).unwrap();
        let loaded = load_library_file(&path).unwrap();
        assert_eq!(loaded.library.games[0].id, "stable-id");
        assert_eq!(loaded.library.games[0].sort_order, 0);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn malformed_library_is_not_marked_writable() {
        let directory = test_directory("malformed");
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join(LIBRARY_FILE);
        fs::write(&path, b"{ definitely not json").unwrap();
        let loaded = load_library_file(&path).unwrap();
        assert!(!loaded.can_save);
        assert!(loaded.warning.is_some());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn stage_one_metadata_migrates_with_safe_defaults() {
        let directory = test_directory("legacy-metadata");
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join(LIBRARY_FILE);
        fs::write(
            &path,
            br#"{
              "version": 1,
              "games": [{
                "id": "legacy-game",
                "title": "Legacy Game",
                "launchScript": "/tmp/legacy.sh",
                "sortOrder": 0
              }]
            }"#,
        )
        .unwrap();
        let loaded = load_library_file(&path).unwrap();
        let game = &loaded.library.games[0];
        assert_eq!(loaded.library.version, LIBRARY_VERSION);
        assert_eq!(game.total_playtime_seconds, 0);
        assert_eq!(game.last_played, None);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn duplicate_detection_uses_script_path_not_title() {
        let games = vec![Game {
            id: "one".into(),
            title: "Original title".into(),
            launch_script: "/tmp/lumen-duplicate.sh".into(),
            cover_path: None,
            background_path: None,
            sort_order: 0,
            total_playtime_seconds: 0,
            last_played: None,
        }];
        assert!(find_duplicate(&games, "/tmp/lumen-duplicate.sh", None).is_some());
        assert!(find_duplicate(&games, "/tmp/lumen-duplicate.sh", Some("one")).is_none());
    }

    #[test]
    fn missing_script_returns_a_useful_error() {
        let error = validate_script("/tmp/lumen-this-script-does-not-exist.sh").unwrap_err();
        assert!(error.contains("no longer exists"));
        assert!(error.contains("lumen-this-script-does-not-exist.sh"));
    }
}
