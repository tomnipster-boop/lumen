use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::Path, process::Command};

use crate::launcher::{is_descendant_process, remove_appimage_environment};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioOutput {
    pub id: String,
    pub label: String,
    pub is_default: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioLevel {
    pub volume: u8,
    pub muted: bool,
}

#[derive(Clone, Debug, Deserialize)]
struct PulseSink {
    index: u32,
    name: String,
    description: String,
}

#[derive(Debug, Deserialize)]
struct PulseSinkInput {
    index: u32,
    sink: u32,
    #[serde(default)]
    properties: HashMap<String, String>,
}

fn pactl_command() -> Command {
    let executable = if Path::new("/usr/bin/pactl").is_file() {
        "/usr/bin/pactl"
    } else {
        "pactl"
    };
    let mut command = Command::new(executable);
    remove_appimage_environment(&mut command);
    command
}

fn pactl_output(arguments: &[&str]) -> Result<Vec<u8>, String> {
    let output = pactl_command()
        .args(arguments)
        .output()
        .map_err(|error| format!("Unable to talk to PipeWire: {error}"))?;
    if output.status.success() {
        Ok(output.stdout)
    } else {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if detail.is_empty() {
            "PipeWire did not return the requested audio information.".to_string()
        } else {
            detail
        })
    }
}

fn pulse_sinks() -> Result<Vec<PulseSink>, String> {
    let json = pactl_output(&["-f", "json", "list", "sinks"])?;
    serde_json::from_slice(&json)
        .map_err(|error| format!("PipeWire returned invalid output information: {error}"))
}

fn default_sink_name() -> Option<String> {
    pactl_output(&["get-default-sink"])
        .ok()
        .and_then(|output| String::from_utf8(output).ok())
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
}

fn sink_target(id: Option<&str>) -> &str {
    id.filter(|value| !value.trim().is_empty())
        .unwrap_or("@DEFAULT_SINK@")
}

pub fn get_output_level(id: Option<&str>) -> Result<AudioLevel, String> {
    let target = sink_target(id);
    let volume = String::from_utf8(pactl_output(&["get-sink-volume", target])?)
        .map_err(|error| format!("PipeWire returned invalid volume information: {error}"))?
        .split_whitespace()
        .find_map(|token| token.strip_suffix('%')?.parse::<u8>().ok())
        .ok_or_else(|| "PipeWire did not report an output volume.".to_string())?;
    let muted = String::from_utf8(pactl_output(&["get-sink-mute", target])?)
        .map_err(|error| format!("PipeWire returned invalid mute information: {error}"))?
        .split_whitespace()
        .last()
        .is_some_and(|value| value.eq_ignore_ascii_case("yes"));

    Ok(AudioLevel { volume, muted })
}

pub fn set_output_volume(id: Option<&str>, volume: u8) -> Result<(), String> {
    let target = sink_target(id);
    let value = format!("{}%", volume.min(100));
    pactl_output(&["set-sink-volume", target, &value])?;
    if volume > 0 {
        pactl_output(&["set-sink-mute", target, "0"])?;
    }
    Ok(())
}

fn outputs_from_sinks(sinks: Vec<PulseSink>, default: Option<&str>) -> Vec<AudioOutput> {
    let mut outputs = sinks
        .into_iter()
        .map(|sink| AudioOutput {
            is_default: default.is_some_and(|name| name == sink.name),
            id: sink.name,
            label: sink.description,
        })
        .collect::<Vec<_>>();
    outputs.sort_by(|left, right| {
        right
            .is_default
            .cmp(&left.is_default)
            .then_with(|| left.label.to_lowercase().cmp(&right.label.to_lowercase()))
    });
    outputs
}

#[tauri::command]
pub fn get_audio_outputs() -> Result<Vec<AudioOutput>, String> {
    let default = default_sink_name();
    Ok(outputs_from_sinks(pulse_sinks()?, default.as_deref()))
}

/// Change the real system default, independently of per-game routing preferences.
#[tauri::command]
pub async fn set_default_audio_output(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !pulse_sinks()?.iter().any(|sink| sink.name == id) {
            return Err("That audio output is no longer available.".to_string());
        }
        pactl_output(&["set-default-sink", &id])?;
        Ok(())
    })
    .await
    .map_err(|error| format!("Unable to change the default audio output: {error}"))?
}

pub fn resolve_audio_output(id: Option<&str>) -> Option<AudioOutput> {
    let id = id.filter(|value| !value.trim().is_empty())?;
    get_audio_outputs()
        .ok()?
        .into_iter()
        .find(|output| output.id == id)
}

pub fn default_audio_output() -> Option<AudioOutput> {
    get_audio_outputs()
        .ok()?
        .into_iter()
        .find(|output| output.is_default)
}

pub fn apply_to_game_command(command: &mut Command, output: Option<&AudioOutput>) {
    if let Some(output) = output {
        // PipeWire's PulseAudio compatibility layer inherits this through the
        // launch script, UMU/Proton, Wine, and finally the game process.
        command.env("PULSE_SINK", &output.id);
    }
}

pub fn route_process_tree(root_pid: u32, output_id: &str) -> Result<usize, String> {
    let Some(target) = pulse_sinks()?
        .into_iter()
        .find(|sink| sink.name == output_id)
    else {
        return Ok(0);
    };
    let json = pactl_output(&["-f", "json", "list", "sink-inputs"])?;
    let inputs: Vec<PulseSinkInput> = serde_json::from_slice(&json)
        .map_err(|error| format!("PipeWire returned invalid stream information: {error}"))?;
    let mut moved = 0;

    for input in inputs {
        let Some(pid) = input
            .properties
            .get("application.process.id")
            .and_then(|value| value.parse::<u32>().ok())
        else {
            continue;
        };
        if input.sink == target.index || !is_descendant_process(pid, root_pid) {
            continue;
        }
        let status = pactl_command()
            .args(["move-sink-input", &input.index.to_string(), output_id])
            .status();
        if status.is_ok_and(|status| status.success()) {
            moved += 1;
        }
    }
    Ok(moved)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audio_outputs_keep_stable_names_and_put_the_default_first() {
        let outputs = outputs_from_sinks(
            vec![
                PulseSink {
                    index: 1,
                    name: "speaker-id".to_string(),
                    description: "Speakers".to_string(),
                },
                PulseSink {
                    index: 2,
                    name: "headset-id".to_string(),
                    description: "Gaming Headset".to_string(),
                },
            ],
            Some("headset-id"),
        );

        assert_eq!(outputs[0].id, "headset-id");
        assert_eq!(outputs[0].label, "Gaming Headset");
        assert!(outputs[0].is_default);
        assert_eq!(outputs[1].id, "speaker-id");
    }
}
