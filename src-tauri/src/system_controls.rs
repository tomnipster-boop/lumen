use serde::Serialize;
use std::{path::Path, process::Command};

use crate::launcher::remove_appimage_environment;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemControls {
    pub brightness: Option<u8>,
    pub volume: u8,
    pub muted: bool,
    pub audio_available: bool,
    pub audio_error: Option<String>,
}

fn ddcutil_command() -> Command {
    let executable = if Path::new("/usr/bin/ddcutil").is_file() {
        "/usr/bin/ddcutil"
    } else {
        "ddcutil"
    };
    let mut command = Command::new(executable);
    remove_appimage_environment(&mut command);
    command
}

fn monitor_brightness() -> Result<u8, String> {
    let output = ddcutil_command()
        .args(["getvcp", "10", "--brief"])
        .output()
        .map_err(|error| format!("Unable to read monitor brightness: {error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "The monitor did not expose hardware brightness controls.".to_string()
        } else {
            detail
        });
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let values = text
        .split_whitespace()
        .filter_map(|token| token.parse::<u16>().ok())
        .collect::<Vec<_>>();
    let (current, maximum) = values
        .get(values.len().saturating_sub(2))
        .zip(values.last())
        .ok_or_else(|| "The monitor returned invalid brightness information.".to_string())?;
    if *maximum == 0 {
        return Err("The monitor reported an invalid maximum brightness.".to_string());
    }
    Ok((u32::from(*current) * 100 / u32::from(*maximum)).min(100) as u8)
}

fn write_monitor_brightness(value: u8) -> Result<(), String> {
    let value = value.min(100).to_string();
    let output = ddcutil_command()
        .args(["setvcp", "10", &value])
        .output()
        .map_err(|error| format!("Unable to set monitor brightness: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if detail.is_empty() {
            "The monitor rejected the brightness change.".to_string()
        } else {
            detail
        })
    }
}

#[tauri::command]
pub async fn get_system_controls(audio_output: Option<String>) -> Result<SystemControls, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let audio = crate::audio::get_output_level(audio_output.as_deref());
        Ok(SystemControls {
            brightness: monitor_brightness().ok(),
            volume: audio.as_ref().map(|level| level.volume).unwrap_or(0),
            muted: audio.as_ref().map(|level| level.muted).unwrap_or(false),
            audio_available: audio.is_ok(),
            audio_error: audio.err(),
        })
    })
    .await
    .map_err(|error| format!("Unable to read system controls: {error}"))?
}

#[tauri::command]
pub async fn set_system_brightness(value: u8) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || write_monitor_brightness(value))
        .await
        .map_err(|error| format!("Unable to update monitor brightness: {error}"))?
}

#[tauri::command]
pub async fn set_system_volume(audio_output: Option<String>, value: u8) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::audio::set_output_volume(audio_output.as_deref(), value)
    })
    .await
    .map_err(|error| format!("Unable to update output volume: {error}"))?
}
