use serde::Serialize;
use std::{
    fs::{self, File},
    io::{self, Read},
    path::PathBuf,
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter};

use crate::launcher;

const EV_KEY: u16 = 0x01;
const EV_ABS: u16 = 0x03;
const BTN_MODE: u16 = 0x13c;
const ABS_HAT0X: u16 = 0x10;
const ABS_HAT0Y: u16 = 0x11;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
struct DpadEvent {
    axis: &'static str,
    value: i32,
}

fn dpad_event(event_type: u16, code: u16, value: i32) -> Option<DpadEvent> {
    if event_type != EV_ABS {
        return None;
    }
    let axis = match code {
        ABS_HAT0X => "x",
        ABS_HAT0Y => "y",
        _ => return None,
    };
    Some(DpadEvent {
        axis,
        value: value.signum(),
    })
}

fn joystick_event_paths() -> Vec<PathBuf> {
    let mut paths = fs::read_dir("/dev/input/by-id")
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .ends_with("-event-joystick")
        })
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    paths.sort();
    paths
}

fn read_input_event(file: &mut File) -> io::Result<(u16, u16, i32)> {
    let time_bytes = std::mem::size_of::<libc::timeval>();
    let mut bytes = vec![0_u8; time_bytes + 8];
    file.read_exact(&mut bytes)?;
    let event_type = u16::from_ne_bytes([bytes[time_bytes], bytes[time_bytes + 1]]);
    let code = u16::from_ne_bytes([bytes[time_bytes + 2], bytes[time_bytes + 3]]);
    let value = i32::from_ne_bytes([
        bytes[time_bytes + 4],
        bytes[time_bytes + 5],
        bytes[time_bytes + 6],
        bytes[time_bytes + 7],
    ]);
    Ok((event_type, code, value))
}

fn watch_device(app: &AppHandle, path: &PathBuf) -> io::Result<()> {
    let mut device = File::open(path)?;
    loop {
        let (event_type, code, value) = read_input_event(&mut device)?;
        if event_type == EV_KEY && code == BTN_MODE && value == 1 {
            launcher::handle_guide_button(app);
        } else if let Some(payload) = dpad_event(event_type, code, value) {
            if launcher::launcher_owns_controller(app) {
                if let Err(error) = app.emit("controller://dpad", payload) {
                    eprintln!("Unable to emit native D-pad input: {error}");
                }
            }
        }
    }
}

pub fn setup(app: AppHandle) {
    thread::spawn(move || loop {
        let mut watched = false;
        for path in joystick_event_paths() {
            watched = true;
            if let Err(error) = watch_device(&app, &path) {
                eprintln!("Lumen lost access to {}: {error}", path.display());
            }
        }
        thread::sleep(if watched {
            Duration::from_millis(350)
        } else {
            Duration::from_secs(1)
        });
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linux_input_event_payload_decodes_button_fields() {
        let time_bytes = std::mem::size_of::<libc::timeval>();
        let mut bytes = vec![0_u8; time_bytes + 8];
        bytes[time_bytes..time_bytes + 2].copy_from_slice(&EV_KEY.to_ne_bytes());
        bytes[time_bytes + 2..time_bytes + 4].copy_from_slice(&BTN_MODE.to_ne_bytes());
        bytes[time_bytes + 4..time_bytes + 8].copy_from_slice(&1_i32.to_ne_bytes());
        let path = std::env::temp_dir().join(format!("lumen-input-event-{}", std::process::id()));
        fs::write(&path, bytes).unwrap();
        let mut file = File::open(&path).unwrap();
        assert_eq!(read_input_event(&mut file).unwrap(), (EV_KEY, BTN_MODE, 1));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn linux_hat_axes_map_to_native_dpad_events() {
        assert_eq!(
            dpad_event(EV_ABS, ABS_HAT0X, -1),
            Some(DpadEvent {
                axis: "x",
                value: -1
            })
        );
        assert_eq!(
            dpad_event(EV_ABS, ABS_HAT0Y, 1),
            Some(DpadEvent {
                axis: "y",
                value: 1
            })
        );
        assert_eq!(
            dpad_event(EV_ABS, ABS_HAT0X, 0),
            Some(DpadEvent {
                axis: "x",
                value: 0
            })
        );
        assert_eq!(dpad_event(EV_KEY, ABS_HAT0X, -1), None);
    }
}
