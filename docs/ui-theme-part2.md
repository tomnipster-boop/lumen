# Lumen UI and artwork themes — Part 2

The existing carousel now sits alongside frosted title and status panels, a
wider framed Play button, and separate Dynamic/Static and Quick Options controls.
The resting carousel geometry and Part 1 motion remain intact. Reduced-motion
navigation explicitly disables card transitions so the selected card settles
immediately.

## Theme behavior

Dynamic mode derives the accent from the selected game's background, falling
back to its cover or the bundled wallpaper. Static mode uses the existing
configured wallpaper. The existing wallpaper settings persist across launches.
Local static images are registered with Tauri before loading.

A 48 × 48 sample is scored by hue clusters, rejecting near-black, near-white,
neutral and tiny outlier regions. HSL normalization preserves the artwork's hue
while keeping saturation and lightness suitable for controls. A deterministic
blue fallback handles unavailable or unusable images. The bounded in-memory
cache holds 128 palettes and invalidates after artwork edits. Stale asynchronous
results cannot replace the newest selection. One inherited color interpolates
for 380 ms and supplies the cover glow, Play, Settings and Quick Options.

## Quick Options

Open with Q, controller View/Select, or the bottom-right button. Up/Down moves
between controls; A enters or leaves slider adjustment, Left/Right adjusts,
and B leaves adjustment or closes the panel. Closing returns focus to Quick
Options. Existing game-launch, Y/Settings, X/quit and Menu/Details mappings remain.

The panel contains only volume, brightness, and audio output. Volume and output
selection use the existing PulseAudio/PipeWire integration and real sink names.
Choosing a system output also lets the current game follow it unless a preferred
game output is configured in full Settings. Slider writes are serialized and
coalesced; closing a panel flushes its latest pending value.

Brightness uses the existing DDC backend. If unavailable, the clearly labelled
Lumen brightness control dims only this app and persists its value. Audio errors
are reported separately from missing monitor controls. When hardware brightness
becomes available, the fallback dimming layer is removed.

## Changed files

- `src/Glass.css`: shared accent variables, glass surfaces, Play and compact overlay styling.
- `src/lib/artworkTheme.ts`, `src/hooks/useArtworkTheme.ts`: palette extraction, cache, and asynchronous selection.
- `src/App.tsx`: active background/theme, mode button, Quick Options, focus and overlay integration.
- `src/components/Background.tsx`: preload replacement artwork and retain valid artwork on load failure.
- `src/components/GameInfo.tsx`: simplified Details affordance.
- `src/components/QuickSettings.tsx`: compact controls, actual output selection and focus restoration.
- `src/components/SettingsPanel.tsx`: shared system controls, automatic artwork color information and brightness fallback.
- `src/lib/coalescedWrite.ts`: bounded pending system-control writes.
- `src/types/settings.ts`, `src/hooks/useSettings.ts`: persisted app brightness using existing settings storage.
- `src/lib/controllerInput.ts`, `src/hooks/useUnifiedInput.ts`: View and Q shortcuts.
- `src-tauri/src/audio.rs`, `src-tauri/src/lib.rs`: validated default-output command and registration.
- `src-tauri/src/system_controls.rs`: independently report audio availability and monitor brightness.
- `scripts/artworkTheme.test.mjs`, `scripts/coalescedWrite.test.mjs`, `scripts/controllerInput.test.mjs`: palette quality/contrast, write serialization and shortcut coverage.
- `README.md`: current appearance and controls.

## Verification

The production frontend build and all 46 JavaScript unit tests pass. All 16 Rust
tests pass, including launch process-tree and audio-device handling coverage.
Browser acceptance and motion regressions pass with no browser errors. Results
are in `verification-part2/part2-report.json` and `verification-part2/motion-report.json`. Browser audio and controller checks use deterministic fixtures;
they do not change the user's system audio or start real games.

Physical controller feel and sustained performance at every display refresh rate
still require hands-on testing. Motion uses elapsed time or compositor timing,
and color extraction is performed once per uncached image rather than per frame.
The updated release AppImage is installed at `~/.local/opt/lumen/Lumen.AppImage`.
Its checksum and previous-version backup are recorded in `verification-part2/appimage.json`.
