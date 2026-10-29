# Lumen

Lumen is a Linux-first, controller-friendly launcher for local games. It wraps
the user's existing `.sh` launchers in a compact console-style library with
custom artwork, themes, lifecycle tracking, and persistent playtime. The shell
scripts remain responsible for UMU, Proton, Wine prefixes, and the game itself.

## Development

Prerequisites are Node.js, npm, Rust, and the standard
[Tauri 2 Linux dependencies](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev
```

Checks and release build:

```bash
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build
```

The Linux release is produced under
`src-tauri/target/release/bundle/appimage/`.

On current Arch Linux releases, linuxdeploy's bundled `strip` may not understand
the system libraries' RELR sections. Install `patchelf` and build with
`NO_STRIP=1 npm run tauri build` in that case; the AppImage is larger, but its
runtime behavior is unchanged. If the GStreamer plugin cannot auto-detect the
Arch helper layout, point `GSTREAMER_HELPERS_DIR` at a directory containing
`gst-plugin-scanner` and `gst-ptp-helper` from `/usr/lib/gstreamer-1.0`.

## Library

Use Settings → Library to:

- add one `.sh` script;
- scan a folder and confirm which `.sh` scripts to import;
- edit game titles, scripts, square cover art, and wide background art;
- move games earlier or later in carousel order;
- remove launcher entries without deleting any underlying files.

The versioned library and runtime metadata are stored outside the application
bundle. On Linux the library is normally:

```text
~/.local/share/io.gwafbat.lumen/library.json
```

It includes playtime and last-played timestamps. Writes use a temporary file
followed by an atomic rename. Malformed top-level JSON is reported and left
untouched, while invalid individual entries are skipped so valid games remain
available. Appearance settings use the WebView's per-application storage under
the same stable application ID, `io.gwafbat.lumen`.

## Launch behavior

Play resolves the selected game by its stable library ID in Rust, validates the
saved script path, and starts it as:

```text
/bin/bash /absolute/path/to/launch script.sh
```

The working directory is the script's parent folder. Lumen stays visible in a
Starting state while UMU or Proton prepares the game. Once Hyprland reports a
mapped game window descended from that script, Lumen keeps the library on its
dedicated `lumen` workspace, moves the game to `lumen-game`, and switches there.
It switches back after the game exits, and only the mapped running interval
counts toward playtime. Lumen also uses one desktop-session instance: opening it
again focuses the existing window instead of creating another launcher or game launch.
It does not interpolate shell command strings, rewrite UMU settings, or change
permissions. Paths containing spaces are passed as one process argument.

For accurate lifecycle tracking, keep the game process in the script's
foreground. Prefer:

```bash
exec umu-run /absolute/path/to/game.exe
```

Plain `umu-run ...` also works when the script waits for it. Scripts that launch
the game in the background and immediately exit cannot be tracked accurately.

## Appearance and controls

Lumen derives its accent from the current background. Dynamic mode follows the
selected game's artwork; Static mode keeps the wallpaper chosen in Settings.
The mode and static wallpaper persist. Accents are cached and animate across
the cover glow, Play control, Settings and Quick Options.

Quick Options contains system volume, brightness and the system audio output.
It uses the existing PipeWire/PulseAudio and DDC integrations. If the monitor
cannot expose brightness, the clearly labelled Lumen brightness control dims
only the app. Full Settings retains separate preferred game-output routing.

Part 2 implementation and verification details are in
[docs/ui-theme-part2.md](docs/ui-theme-part2.md).

Keyboard and mouse:

- `Left` / `Right`: move through the library
- `Up` / `Down`: move focus through Settings, the carousel, Play, background mode and Quick Options
- `Enter`: activate the focused control or launch the selected game
- `Q`: open Quick Options
- `D`: open selected-game details
- `S` or `Ctrl+,`: open Settings
- `Escape`: close the active panel or leave preferred fullscreen mode

Standard-mapped controller:

- D-pad Left/Right: precise one-game carousel navigation; hold for controlled repeat
- D-pad Up/Down: move focus through launcher and panel controls
- Left stick Left/Right: conventional carousel navigation
- Rotate left stick clockwise: rapidly scroll right through the library
- Rotate left stick counterclockwise: rapidly scroll left through the library
- South button (A/Cross): confirm or launch
- East button (B/Circle): back
- Start/Options: game details
- North button (Y/Triangle): full Settings
- West button (X/Square): request quitting the active game
- Select/View: Quick Options

The rotational gesture activates near the stick's outer ring and advances about
eight games per full circle. It is limited to the home carousel; menus retain
ordinary directional navigation. Mouse users can select any visible cover.

## Linux integration

The Tauri AppImage contains Lumen's generated desktop entry and multi-resolution
application icon. The stable application name is `Lumen`, its ID is
`io.gwafbat.lumen`, and its desktop category is `Game`. Local covers,
backgrounds, wallpapers, scripts, and game installations remain external and
are never copied into the package.

Lumen is designed for Wayland and tested under Hyprland. Normal named workspaces
avoid scratchpad overlay tiling and let fullscreen-aware desktop shells remain
hidden during launcher and game presentation.
Controllers exposed with the standard Gamepad mapping are supported, along with
the conventional raw Linux/xpad mapping used by Xbox-compatible GameSir devices.
Other unusual non-standard mappings may need support outside Lumen.
