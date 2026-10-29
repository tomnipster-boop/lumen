use std::{
    env, fs,
    io::Write,
    os::unix::net::{UnixListener, UnixStream},
    path::PathBuf,
};
use tauri::AppHandle;

use crate::launcher;

fn socket_path() -> PathBuf {
    env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(env::temp_dir)
        .join("lumen-game-launcher.sock")
}

fn activate_existing(path: &PathBuf) -> bool {
    UnixStream::connect(path)
        .and_then(|mut stream| stream.write_all(b"activate\n"))
        .is_ok()
}

pub fn setup(app: AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let path = socket_path();
    if activate_existing(&path) {
        std::process::exit(0);
    }

    if path.exists() {
        fs::remove_file(&path)?;
    }

    let listener = match UnixListener::bind(&path) {
        Ok(listener) => listener,
        Err(_error) if activate_existing(&path) => std::process::exit(0),
        Err(error) => return Err(error.into()),
    };

    std::thread::spawn(move || {
        for connection in listener.incoming() {
            if connection.is_ok() {
                launcher::handle_guide_button(&app);
            }
        }
    });

    Ok(())
}
