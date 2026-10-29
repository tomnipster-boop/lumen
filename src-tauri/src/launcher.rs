use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
#[cfg(target_family = "unix")]
use std::os::unix::process::CommandExt;
use std::{
    ffi::{OsStr, OsString},
    fs,
    path::{Path, PathBuf},
    process::{Child, Command},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use crate::library::{record_game_session, resolve_game_for_launch};

static PRESENTATION_GENERATION: AtomicU64 = AtomicU64::new(0);
const LUMEN_WORKSPACE: &str = "name:lumen";
const GAME_WORKSPACE: &str = "name:lumen-game";
const LEGACY_LUMEN_SPECIAL_WORKSPACE: &str = "lumen-home";

#[derive(Clone, Debug)]
struct ActiveLaunch {
    game_id: String,
    title: String,
    started_at: String,
    game_started: bool,
    game_window_address: Option<String>,
    was_fullscreen: bool,
    root_pid: u32,
    paused: bool,
    paused_processes: Vec<u32>,
    paused_since: Option<Instant>,
    paused_total: Duration,
    audio_output_id: Option<String>,
}

#[derive(Default)]
pub struct LaunchTracker {
    active: Mutex<Option<ActiveLaunch>>,
}

impl LaunchTracker {
    pub fn is_game_running(&self, id: &str) -> bool {
        self.active
            .lock()
            .map(|active| active.as_ref().is_some_and(|launch| launch.game_id == id))
            .unwrap_or(true)
    }
}

pub fn launcher_owns_controller(app: &AppHandle) -> bool {
    let tracker = app.state::<LaunchTracker>();
    tracker
        .active
        .lock()
        .map(|active| match active.as_ref() {
            None => true,
            Some(launch) => launch.paused,
        })
        .unwrap_or(false)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LaunchPhase {
    Launching,
    Running,
    Paused,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchState {
    pub game_id: String,
    pub title: String,
    pub started_at: String,
    pub phase: LaunchPhase,
}

impl From<&ActiveLaunch> for LaunchState {
    fn from(active: &ActiveLaunch) -> Self {
        Self {
            game_id: active.game_id.clone(),
            title: active.title.clone(),
            started_at: active.started_at.clone(),
            phase: if active.paused {
                LaunchPhase::Paused
            } else if active.game_started {
                LaunchPhase::Running
            } else {
                LaunchPhase::Launching
            },
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchExited {
    pub game_id: String,
    pub title: String,
    pub started: bool,
    pub exit_code: Option<i32>,
    pub elapsed_seconds: u64,
    pub total_playtime_seconds: Option<u64>,
    pub last_played: String,
    pub wait_error: Option<String>,
    pub persistence_error: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
struct HyprlandClient {
    #[serde(default)]
    address: String,
    pid: i64,
    mapped: bool,
    #[serde(default)]
    class: String,
}

const APPIMAGE_ONLY_ENVIRONMENT: &[&str] = &[
    "APPDIR",
    "APPIMAGE",
    "APPIMAGE_SILENT_INSTALL",
    "ARGV0",
    "OWD",
    "GDK_BACKEND",
    "GDK_PIXBUF_MODULE_FILE",
    "GIO_EXTRA_MODULES",
    "GSETTINGS_SCHEMA_DIR",
    "GST_PLUGIN_PATH_1_0",
    "GST_PLUGIN_SCANNER_1_0",
    "GST_PLUGIN_SYSTEM_PATH",
    "GST_PLUGIN_SYSTEM_PATH_1_0",
    "GST_PTP_HELPER_1_0",
    "GST_REGISTRY_REUSE_PLUGIN_SCANNER",
    "GTK_DATA_PREFIX",
    "GTK_EXE_PREFIX",
    "GTK_IM_MODULE_FILE",
    "GTK_PATH",
    "GTK_THEME",
    "PYTHONDONTWRITEBYTECODE",
    "PYTHONHOME",
    "PYTHONPATH",
];

const APPIMAGE_PATH_ENVIRONMENT: &[&str] = &["PATH", "LD_LIBRARY_PATH", "XDG_DATA_DIRS"];

fn without_appdir_paths(value: &OsStr, appdir: &Path) -> Option<OsString> {
    let paths = std::env::split_paths(value)
        .filter(|path| !path.as_os_str().is_empty() && !path.starts_with(appdir))
        .collect::<Vec<_>>();

    if paths.is_empty() {
        None
    } else {
        std::env::join_paths(paths).ok()
    }
}

pub(crate) fn remove_appimage_environment(command: &mut Command) {
    let Some(appdir) = std::env::var_os("APPDIR").map(std::path::PathBuf::from) else {
        return;
    };

    for key in APPIMAGE_ONLY_ENVIRONMENT {
        command.env_remove(key);
    }

    for key in APPIMAGE_PATH_ENVIRONMENT {
        match std::env::var_os(key).and_then(|value| without_appdir_paths(&value, &appdir)) {
            Some(value) => {
                command.env(key, value);
            }
            None => {
                command.env_remove(key);
            }
        }
    }
}

fn spawn_script(
    script_path: &Path,
    #[cfg(target_os = "linux")] audio_output: Option<&crate::audio::AudioOutput>,
) -> Result<Child, String> {
    let parent = script_path
        .parent()
        .ok_or_else(|| "The launch script has no parent folder.".to_string())?;
    let mut command = Command::new("/bin/bash");
    command.arg(script_path).current_dir(parent);
    #[cfg(target_family = "unix")]
    command.process_group(0);
    remove_appimage_environment(&mut command);
    #[cfg(target_os = "linux")]
    crate::audio::apply_to_game_command(&mut command, audio_output);
    command.spawn().map_err(|error| {
        format!(
            "Unable to start Bash for {}: {error}",
            script_path.display()
        )
    })
}

fn parent_process_id(pid: u32) -> Option<u32> {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let after_name = stat.get(stat.rfind(") ")? + 2..)?;
    after_name.split_whitespace().nth(1)?.parse().ok()
}

pub(crate) fn is_descendant_process(mut pid: u32, ancestor: u32) -> bool {
    for _ in 0..64 {
        if pid == ancestor {
            return true;
        }
        if pid <= 1 {
            return false;
        }
        let Some(parent) = parent_process_id(pid) else {
            return false;
        };
        if parent == pid {
            return false;
        }
        pid = parent;
    }
    false
}

#[cfg(test)]
fn mapped_non_lumen_hyprland_clients(json: &[u8]) -> Vec<HyprlandClient> {
    serde_json::from_slice::<Vec<HyprlandClient>>(json)
        .unwrap_or_default()
        .into_iter()
        .filter(|client| {
            client.mapped
                && client.pid > 0
                && !client.address.is_empty()
                && !client.class.to_ascii_lowercase().contains("lumen")
        })
        .collect()
}

#[cfg(target_os = "linux")]
fn query_hyprland_clients() -> Vec<HyprlandClient> {
    let mut command = Command::new(hyprctl_executable());
    command.args(["-j", "clients"]);
    remove_appimage_environment(&mut command);
    let Ok(output) = command.output() else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    serde_json::from_slice(&output.stdout).unwrap_or_default()
}

#[cfg(target_os = "linux")]
fn mapped_game_window_address(root_pid: u32) -> Option<String> {
    query_hyprland_clients()
        .into_iter()
        .filter(|client| {
            client.mapped
                && client.pid > 0
                && !client.address.is_empty()
                && !client.class.to_ascii_lowercase().contains("lumen")
        })
        .find(|client| {
            u32::try_from(client.pid)
                .ok()
                .is_some_and(|pid| is_descendant_process(pid, root_pid))
        })
        .map(|client| client.address)
}

#[cfg(not(target_os = "linux"))]
fn mapped_game_window_address(_root_pid: u32) -> Option<String> {
    None
}

fn mark_game_started(
    app: &AppHandle,
    game_id: &str,
    game_window_address: String,
) -> Option<LaunchState> {
    let tracker = app.state::<LaunchTracker>();
    let mut active = tracker.active.lock().ok()?;
    let launch = active.as_mut()?;
    if launch.game_id != game_id || launch.game_started {
        return None;
    }
    launch.game_started = true;
    launch.game_window_address = Some(game_window_address);
    Some(LaunchState::from(&*launch))
}

pub fn focus_launcher(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.show();
    let _ = window.unminimize();
    reinforce_lumen_workspace();
}

pub fn prepare_launcher_workspace() {
    #[cfg(target_os = "linux")]
    {
        close_legacy_lumen_special_workspace();
        reinforce_lumen_workspace();
    }
}

#[cfg(target_os = "linux")]
fn hyprctl_executable() -> PathBuf {
    if Path::new("/usr/bin/hyprctl").is_file() {
        PathBuf::from("/usr/bin/hyprctl")
    } else {
        PathBuf::from("hyprctl")
    }
}

#[cfg(target_os = "linux")]
fn hyprland_dispatch(dispatcher: &str) -> bool {
    let mut command = Command::new(hyprctl_executable());
    command.args(["dispatch", dispatcher]);
    remove_appimage_environment(&mut command);
    command.output().is_ok_and(|output| {
        output.status.success() && String::from_utf8_lossy(&output.stdout).trim() == "ok"
    })
}

#[cfg(target_os = "linux")]
fn lumen_window_address() -> Option<String> {
    query_hyprland_clients()
        .into_iter()
        .find(|client| {
            client.mapped
                && !client.address.is_empty()
                && client.class.eq_ignore_ascii_case("Lumen-game-launcher")
        })
        .map(|client| client.address)
}

#[cfg(target_os = "linux")]
fn focus_window(address: &str) -> bool {
    let selector = format!("address:{address}");
    hyprland_dispatch(&format!(r#"hl.dsp.focus({{ window = "{selector}" }})"#))
}

#[cfg(target_os = "linux")]
fn move_window_to_workspace(address: &str, workspace: &str) -> bool {
    let selector = format!("address:{address}");
    hyprland_dispatch(&format!(
        r#"hl.dsp.window.move({{ workspace = "{workspace}", window = "{selector}", silent = true }})"#
    ))
}

#[cfg(target_os = "linux")]
fn focus_workspace(workspace: &str) -> bool {
    hyprland_dispatch(&format!(r#"hl.dsp.focus({{ workspace = "{workspace}" }})"#))
}

#[cfg(target_os = "linux")]
fn present_window_on_workspace(address: &str, workspace: &str) {
    if move_window_to_workspace(address, workspace) {
        let _ = focus_workspace(workspace);
    }
    // If the move failed, focusing the exact address still follows the window
    // to its real workspace rather than opening an empty destination.
    let _ = focus_window(address);
}

#[cfg(target_os = "linux")]
fn present_lumen_on_workspace() {
    if let Some(address) = lumen_window_address() {
        present_window_on_workspace(&address, LUMEN_WORKSPACE);
    }
}

#[cfg(target_os = "linux")]
fn present_game_on_workspace(address: Option<&str>) {
    if let Some(address) = address {
        present_window_on_workspace(address, GAME_WORKSPACE);
    } else {
        let _ = focus_workspace(GAME_WORKSPACE);
    }
}

#[cfg(target_os = "linux")]
fn legacy_lumen_special_workspace_is_open() -> bool {
    let mut command = Command::new(hyprctl_executable());
    command.args(["monitors", "-j"]);
    remove_appimage_environment(&mut command);
    let Ok(output) = command.output() else {
        return false;
    };
    serde_json::from_slice::<serde_json::Value>(&output.stdout)
        .ok()
        .and_then(|value| value.as_array().cloned())
        .is_some_and(|monitors| {
            monitors.iter().any(|monitor| {
                monitor["specialWorkspace"]["name"]
                    .as_str()
                    .is_some_and(|name| name == format!("special:{LEGACY_LUMEN_SPECIAL_WORKSPACE}"))
            })
        })
}

#[cfg(target_os = "linux")]
fn close_legacy_lumen_special_workspace() {
    if legacy_lumen_special_workspace_is_open() {
        let _ = hyprland_dispatch(&format!(
            r#"hl.dsp.workspace.toggle_special("{LEGACY_LUMEN_SPECIAL_WORKSPACE}")"#
        ));
    }
}

#[cfg(target_os = "linux")]
fn reinforce_lumen_workspace() {
    let generation = PRESENTATION_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::spawn(move || {
        // Mapping the XWayland webview is asynchronous. Repeat the handoff
        // briefly, but cancel immediately when another destination takes over.
        // AppImage startup includes a three-second branded loading sequence,
        // and its XWayland surface can become addressable late in that window.
        for delay_ms in [0, 75, 175, 350, 700, 1_100, 1_500] {
            if delay_ms > 0 {
                std::thread::sleep(Duration::from_millis(delay_ms));
            }
            if PRESENTATION_GENERATION.load(Ordering::SeqCst) != generation {
                return;
            }
            present_lumen_on_workspace();
        }
    });
}

#[cfg(not(target_os = "linux"))]
fn reinforce_lumen_workspace() {}

#[cfg(target_os = "linux")]
fn reinforce_game_workspace(address: Option<String>) {
    let generation = PRESENTATION_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    // Switch while the game is still paused. The follow-up passes cover
    // fullscreen surfaces that take a moment to accept focus after moving.
    present_game_on_workspace(address.as_deref());
    std::thread::spawn(move || {
        for delay_ms in [45, 100] {
            std::thread::sleep(Duration::from_millis(delay_ms));
            if PRESENTATION_GENERATION.load(Ordering::SeqCst) != generation {
                return;
            }
            present_game_on_workspace(address.as_deref());
        }
    });
}

#[cfg(not(target_os = "linux"))]
fn reinforce_game_workspace(_address: Option<String>) {}

#[cfg(target_family = "unix")]
fn signal_process_group(root_pid: u32, signal: i32) -> Result<(), String> {
    let process_group = i32::try_from(root_pid)
        .map_err(|_| "The game's process identifier is invalid.".to_string())?;
    let result = unsafe { libc::kill(-process_group, signal) };
    if result == 0 {
        Ok(())
    } else {
        Err(format!(
            "Unable to signal the running game: {}",
            std::io::Error::last_os_error()
        ))
    }
}

#[cfg(target_family = "unix")]
fn descendant_process_ids(root_pid: u32) -> Vec<u32> {
    let mut processes = fs::read_dir("/proc")
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().to_string_lossy().parse::<u32>().ok())
        .filter(|pid| is_descendant_process(*pid, root_pid))
        .collect::<Vec<_>>();
    processes.sort_unstable();
    processes
}

#[cfg(target_family = "unix")]
fn signal_process_tree(
    root_pid: u32,
    known_processes: &[u32],
    signal: i32,
) -> Result<Vec<u32>, String> {
    let processes = if known_processes.is_empty() {
        descendant_process_ids(root_pid)
    } else {
        known_processes.to_vec()
    };
    let mut signalled = signal_process_group(root_pid, signal).is_ok();
    for pid in &processes {
        let Ok(pid) = i32::try_from(*pid) else {
            continue;
        };
        if unsafe { libc::kill(pid, signal) } == 0 {
            signalled = true;
        }
    }
    if signalled {
        Ok(processes)
    } else {
        Err(format!(
            "Unable to signal the running game: {}",
            std::io::Error::last_os_error()
        ))
    }
}

#[cfg(not(target_family = "unix"))]
fn signal_process_tree(
    _root_pid: u32,
    _known_processes: &[u32],
    _signal: i32,
) -> Result<Vec<u32>, String> {
    Err("Controlling games is only supported on Linux.".to_string())
}

#[cfg(not(target_family = "unix"))]
fn signal_process_group(_root_pid: u32, _signal: i32) -> Result<(), String> {
    Err("Pausing games is only supported on Linux.".to_string())
}

fn paused_duration(app: &AppHandle, game_id: &str) -> Duration {
    let tracker = app.state::<LaunchTracker>();
    let Ok(active) = tracker.active.lock() else {
        return Duration::ZERO;
    };
    let Some(launch) = active.as_ref().filter(|launch| launch.game_id == game_id) else {
        return Duration::ZERO;
    };
    launch.paused_total
        + launch
            .paused_since
            .map(|paused_at| paused_at.elapsed())
            .unwrap_or_default()
}

#[cfg(target_os = "linux")]
fn active_audio_output_id(app: &AppHandle, game_id: &str) -> Option<String> {
    let tracker = app.state::<LaunchTracker>();
    let active = tracker.active.lock().ok()?;
    active
        .as_ref()
        .filter(|launch| launch.game_id == game_id)
        .and_then(|launch| launch.audio_output_id.clone())
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn set_game_audio_output(
    tracker: State<'_, LaunchTracker>,
    audio_output: Option<String>,
) -> Result<(), String> {
    let root_pid = {
        let active = tracker
            .active
            .lock()
            .map_err(|_| "The launch state is temporarily unavailable.".to_string())?;
        let Some(launch) = active.as_ref() else {
            return Ok(());
        };
        launch.root_pid
    };

    let requested = audio_output
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    let explicit_output = requested
        .map(|id| {
            crate::audio::resolve_audio_output(Some(id))
                .ok_or_else(|| "That audio output is no longer available.".to_string())
        })
        .transpose()?;
    let route_target = explicit_output
        .clone()
        .or_else(crate::audio::default_audio_output);

    {
        let mut active = tracker
            .active
            .lock()
            .map_err(|_| "The launch state is temporarily unavailable.".to_string())?;
        let Some(launch) = active.as_mut() else {
            return Ok(());
        };
        if launch.root_pid != root_pid {
            return Ok(());
        }
        launch.audio_output_id = explicit_output.as_ref().map(|output| output.id.clone());
    }

    if let Some(output) = route_target {
        crate::audio::route_process_tree(root_pid, &output.id)?;
    }
    Ok(())
}

pub fn handle_guide_button(app: &AppHandle) {
    let tracker = app.state::<LaunchTracker>();
    let mut emitted_state = None;
    let mut fullscreen = None;

    if let Ok(mut active) = tracker.active.lock() {
        if let Some(launch) = active.as_mut() {
            fullscreen = Some(launch.was_fullscreen);
            if launch.game_started && !launch.paused {
                match signal_process_tree(launch.root_pid, &[], libc::SIGSTOP) {
                    Ok(paused_processes) => {
                        launch.paused = true;
                        launch.paused_processes = paused_processes;
                        launch.paused_since = Some(Instant::now());
                        emitted_state = Some(LaunchState::from(&*launch));
                    }
                    Err(error) => eprintln!("Unable to pause game from the Xbox button: {error}"),
                }
            }
        }
    }

    match fullscreen {
        Some(was_fullscreen) => restore_launcher(app, "main", was_fullscreen),
        None => focus_launcher(app),
    }
    if let Some(state) = emitted_state {
        if let Err(error) = app.emit("game://paused", state) {
            eprintln!("Unable to emit the game pause event: {error}");
        }
    }
}

fn restore_launcher(app: &AppHandle, window_label: &str, was_fullscreen: bool) {
    let Some(window) = app.get_webview_window(window_label) else {
        return;
    };
    if let Err(error) = window.show() {
        eprintln!("Unable to show Lumen after the game closed: {error}");
    }
    let _ = window.unminimize();
    if let Err(error) = window.set_fullscreen(was_fullscreen) {
        eprintln!("Unable to restore Lumen's fullscreen state: {error}");
    }
    reinforce_lumen_workspace();
}

#[tauri::command]
pub fn get_launch_state(tracker: State<'_, LaunchTracker>) -> Result<Option<LaunchState>, String> {
    let active = tracker
        .active
        .lock()
        .map_err(|_| "The launch state is temporarily unavailable.".to_string())?;
    Ok(active.as_ref().map(LaunchState::from))
}

#[tauri::command]
pub fn resume_game(
    app: AppHandle,
    tracker: State<'_, LaunchTracker>,
) -> Result<LaunchState, String> {
    let mut active = tracker
        .active
        .lock()
        .map_err(|_| "The launch state is temporarily unavailable.".to_string())?;
    let launch = active
        .as_mut()
        .ok_or_else(|| "There is no game to resume.".to_string())?;
    if !launch.game_started {
        return Err(format!("{} is still starting.", launch.title));
    }

    let game_window_address = launch.game_window_address.clone();
    reinforce_game_workspace(game_window_address);

    if launch.paused {
        signal_process_tree(launch.root_pid, &launch.paused_processes, libc::SIGCONT)?;
        launch.paused_processes.clear();
        if let Some(paused_at) = launch.paused_since.take() {
            launch.paused_total += paused_at.elapsed();
        }
        launch.paused = false;
    }
    let state = LaunchState::from(&*launch);
    drop(active);
    if let Err(error) = app.emit("game://resumed", state.clone()) {
        eprintln!("Unable to emit the game resume event: {error}");
    }
    Ok(state)
}

#[tauri::command]
pub fn quit_game(app: AppHandle, tracker: State<'_, LaunchTracker>) -> Result<(), String> {
    let mut active = tracker
        .active
        .lock()
        .map_err(|_| "The launch state is temporarily unavailable.".to_string())?;
    let launch = active
        .as_mut()
        .ok_or_else(|| "There is no running game to close.".to_string())?;
    let root_pid = launch.root_pid;

    if launch.paused {
        signal_process_tree(root_pid, &launch.paused_processes, libc::SIGCONT)?;
        launch.paused_processes.clear();
        if let Some(paused_at) = launch.paused_since.take() {
            launch.paused_total += paused_at.elapsed();
        }
        launch.paused = false;
    }
    signal_process_tree(root_pid, &[], libc::SIGTERM)?;
    drop(active);

    let app_for_fallback = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(3));
        let tracker = app_for_fallback.state::<LaunchTracker>();
        let still_running = tracker
            .active
            .lock()
            .map(|active| {
                active
                    .as_ref()
                    .is_some_and(|launch| launch.root_pid == root_pid)
            })
            .unwrap_or(false);
        if still_running {
            let _ = signal_process_tree(root_pid, &[], libc::SIGKILL);
        }
    });
    Ok(())
}

#[tauri::command]
pub fn launch_game(
    app: AppHandle,
    window: WebviewWindow,
    tracker: State<'_, LaunchTracker>,
    id: String,
    audio_output: Option<String>,
) -> Result<LaunchState, String> {
    let mut active = tracker
        .active
        .lock()
        .map_err(|_| "The launch state is temporarily unavailable.".to_string())?;
    if let Some(current) = active.as_ref() {
        return Err(format!(
            "{} is already running. Close it before launching another game.",
            current.title
        ));
    }

    let (game, script) = resolve_game_for_launch(&app, &id)?;
    #[cfg(target_os = "linux")]
    let resolved_audio_output = crate::audio::resolve_audio_output(audio_output.as_deref());
    let child = spawn_script(
        &script,
        #[cfg(target_os = "linux")]
        resolved_audio_output.as_ref(),
    )?;
    let root_pid = child.id();
    let launch = ActiveLaunch {
        game_id: game.id,
        title: game.title,
        started_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
        game_started: false,
        game_window_address: None,
        was_fullscreen: window.is_fullscreen().unwrap_or(false),
        root_pid,
        paused: false,
        paused_processes: Vec::new(),
        paused_since: None,
        paused_total: Duration::ZERO,
        audio_output_id: {
            #[cfg(target_os = "linux")]
            {
                resolved_audio_output.map(|output| output.id)
            }
            #[cfg(not(target_os = "linux"))]
            {
                None
            }
        },
    };
    let response = LaunchState::from(&launch);
    let window_label = window.label().to_string();
    *active = Some(launch.clone());
    drop(active);

    let app_for_wait = app.clone();
    std::thread::spawn(move || {
        let mut child = child;
        let mut game_started = false;
        let mut running_since: Option<Instant> = None;
        #[cfg(target_os = "linux")]
        let mut last_audio_route = Instant::now() - Duration::from_secs(10);
        let (exit_code, wait_error) = loop {
            match child.try_wait() {
                Ok(Some(status)) => break (status.code(), None),
                Ok(None) => {}
                Err(error) => {
                    break (
                        None,
                        Some(format!("Unable to read the game's exit status: {error}")),
                    );
                }
            }

            if !game_started {
                if let Some(game_window_address) = mapped_game_window_address(root_pid) {
                    game_started = true;
                    running_since = Some(Instant::now());
                    reinforce_game_workspace(Some(game_window_address.clone()));
                    if let Some(state) =
                        mark_game_started(&app_for_wait, &launch.game_id, game_window_address)
                    {
                        if let Err(error) = app_for_wait.emit("game://started", state) {
                            eprintln!("Unable to emit the game start event: {error}");
                        }
                    }
                }
            }

            #[cfg(target_os = "linux")]
            if let Some(output_id) = active_audio_output_id(&app_for_wait, &launch.game_id) {
                let interval = if running_since
                    .map_or(true, |started| started.elapsed() < Duration::from_secs(60))
                {
                    Duration::from_millis(750)
                } else {
                    Duration::from_secs(10)
                };
                if last_audio_route.elapsed() >= interval {
                    if let Err(error) = crate::audio::route_process_tree(root_pid, &output_id) {
                        eprintln!("Unable to route game audio: {error}");
                    }
                    last_audio_route = Instant::now();
                }
            }

            std::thread::sleep(Duration::from_millis(250));
        };
        let elapsed_seconds = running_since
            .map(|started| {
                started
                    .elapsed()
                    .saturating_sub(paused_duration(&app_for_wait, &launch.game_id))
                    .as_secs()
            })
            .unwrap_or(0);
        let last_played = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
        let (total_playtime_seconds, persistence_error) = if game_started {
            match record_game_session(
                &app_for_wait,
                &launch.game_id,
                elapsed_seconds,
                last_played.clone(),
            ) {
                Ok(metadata) => (Some(metadata.total_playtime_seconds), None),
                Err(error) => (None, Some(error)),
            }
        } else {
            (None, None)
        };

        if let Ok(mut active) = app_for_wait.state::<LaunchTracker>().active.lock() {
            if active
                .as_ref()
                .is_some_and(|current| current.game_id == launch.game_id)
            {
                *active = None;
            }
        }

        if game_started {
            restore_launcher(&app_for_wait, &window_label, launch.was_fullscreen);
        }
        let payload = LaunchExited {
            game_id: launch.game_id,
            title: launch.title,
            started: game_started,
            exit_code,
            elapsed_seconds,
            total_playtime_seconds,
            last_played,
            wait_error,
            persistence_error,
        };
        if let Err(error) = app_for_wait.emit("game://exited", payload) {
            eprintln!("Unable to emit the game exit event: {error}");
        }
    });

    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{ffi::OsStr, fs, path::Path, time::SystemTime};

    #[test]
    fn strips_only_mounted_appimage_entries_from_path_lists() {
        let appdir = Path::new("/tmp/.mount_Lumen.test");
        let value = OsStr::new(
            "/tmp/.mount_Lumen.test/usr/bin:/usr/local/bin:/usr/bin:/tmp/.mount_Lumen.test/bin:",
        );

        let cleaned = without_appdir_paths(value, appdir).unwrap();

        assert_eq!(cleaned, OsStr::new("/usr/local/bin:/usr/bin"));
    }

    #[test]
    fn empty_appimage_only_path_list_is_removed() {
        let appdir = Path::new("/tmp/.mount_Lumen.test");
        let value = OsStr::new("/tmp/.mount_Lumen.test/usr/lib:/tmp/.mount_Lumen.test/usr/lib64:");

        assert_eq!(without_appdir_paths(value, appdir), None);
    }

    #[test]
    fn hyprland_clients_include_only_mapped_addressable_non_lumen_windows() {
        let clients = br#"[
          {"address": "0x101", "pid": 101, "mapped": true, "class": "steam_app_default"},
          {"address": "0x102", "pid": 102, "mapped": false, "class": "loading"},
          {"address": "0x103", "pid": 103, "mapped": true, "class": "Lumen-game-launcher"},
          {"address": "", "pid": 104, "mapped": true, "class": "unaddressable"}
        ]"#;

        let mapped = mapped_non_lumen_hyprland_clients(clients);
        assert_eq!(mapped.len(), 1);
        assert_eq!(mapped[0].pid, 101);
        assert_eq!(mapped[0].address, "0x101");
    }

    #[test]
    fn current_process_is_its_own_descendant_root() {
        let current = std::process::id();
        assert!(is_descendant_process(current, current));
    }

    #[test]
    fn bash_launch_supports_spaces_and_uses_script_parent_as_cwd() {
        let suffix = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("lumen-path with spaces-{suffix}"));
        fs::create_dir_all(&directory).unwrap();
        let script = directory.join("harmless test.sh");
        fs::write(
            &script,
            b"#!/usr/bin/env bash\npwd > working-directory.txt\n",
        )
        .unwrap();
        let mut child = spawn_script(
            &script,
            #[cfg(target_os = "linux")]
            None,
        )
        .unwrap();
        assert!(child.wait().unwrap().success());
        let recorded = fs::read_to_string(directory.join("working-directory.txt")).unwrap();
        assert_eq!(recorded.trim(), directory.to_string_lossy());
        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(target_family = "unix")]
    #[test]
    fn launched_process_tree_can_pause_resume_and_terminate_across_process_groups() {
        let suffix = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("lumen-signal-test-{suffix}"));
        fs::create_dir_all(&directory).unwrap();
        let script = directory.join("signal test.sh");
        fs::write(
            &script,
            b"#!/usr/bin/env bash\nsetsid sleep 30 &\necho $! > detached-child.pid\nwait\n",
        )
        .unwrap();
        let mut child = spawn_script(
            &script,
            #[cfg(target_os = "linux")]
            None,
        )
        .unwrap();
        let root_pid = child.id();

        let child_pid_path = directory.join("detached-child.pid");
        for _ in 0..50 {
            if child_pid_path.is_file() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        let detached_pid = fs::read_to_string(&child_pid_path)
            .unwrap()
            .trim()
            .parse::<u32>()
            .unwrap();

        let paused = signal_process_tree(root_pid, &[], libc::SIGSTOP).unwrap();
        std::thread::sleep(Duration::from_millis(40));
        let stopped = [root_pid, detached_pid].into_iter().all(|pid| {
            fs::read_to_string(format!("/proc/{pid}/status"))
                .unwrap()
                .lines()
                .any(|line| line.starts_with("State:") && line.contains('T'))
        });

        assert!(paused.contains(&root_pid));
        assert!(paused.contains(&detached_pid));
        let _ = signal_process_tree(root_pid, &paused, libc::SIGCONT);
        let _ = signal_process_tree(root_pid, &paused, libc::SIGTERM);
        let _ = child.wait();
        fs::remove_dir_all(directory).unwrap();
        assert!(
            stopped,
            "every process in the launched tree should enter the stopped state"
        );
    }
}
