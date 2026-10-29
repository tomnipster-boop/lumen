#[cfg(target_os = "linux")]
mod audio;
#[cfg(target_os = "linux")]
mod controller;
mod launcher;
mod library;
#[cfg(target_family = "unix")]
mod single_instance;
#[cfg(target_os = "linux")]
mod system_controls;
#[cfg(target_os = "linux")]
mod ui_audio;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(launcher::LaunchTracker::default())
        .manage(ui_audio::UiAudio::new())
        .setup(|app| {
            #[cfg(target_family = "unix")]
            single_instance::setup(app.handle().clone())?;
            #[cfg(target_os = "linux")]
            controller::setup(app.handle().clone());
            #[cfg(target_os = "linux")]
            launcher::prepare_launcher_workspace();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            library::get_library,
            library::add_game,
            library::update_game,
            library::remove_game,
            library::reorder_games,
            library::scan_script_folder,
            library::register_asset_path,
            #[cfg(target_os = "linux")]
            audio::get_audio_outputs,
            #[cfg(target_os = "linux")]
            audio::set_default_audio_output,
            #[cfg(target_os = "linux")]
            launcher::set_game_audio_output,
            #[cfg(target_os = "linux")]
            system_controls::get_system_controls,
            #[cfg(target_os = "linux")]
            system_controls::set_system_brightness,
            #[cfg(target_os = "linux")]
            system_controls::set_system_volume,
            #[cfg(target_os = "linux")]
            ui_audio::play_ui_sound,
            launcher::launch_game,
            launcher::get_launch_state,
            launcher::resume_game,
            launcher::quit_game,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lumen");
}
