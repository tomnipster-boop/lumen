# Lumen motion polish — Part 1

Implemented September 6, 2026. The existing ring geometry, artwork, layout,
blur, typography and controller mappings are preserved. R2 perspective mode
remains outside this pass.

## Behaviour

- All cards use the same directional overshoot: about 2.2% of angular travel,
  followed by one settle. Existing 460 ms navigation and 420 ms rotational-stick
  timings remain. Browser transitions retarget from the current position.
- Covers follow tiny elliptical loops with stable per-game phases, periods,
  amplitudes and directions. Idle amplitude follows existing ring-slot distance.
- Idle strength and depth blend during navigation. Once settled, browser
  animations run the loops without per-frame JavaScript style updates.
- Idle pauses under overlays, while a game owns the launcher, when hidden or
  unfocused, and with reduced motion. Returning preserves the shared phase.
- Settings establishes the correct page, scroll and focus before painting.
  Option sheets restore focus without competing delayed focus callbacks.
- Settings focus and right-stick scrolling share one replaceable destination.
  Rapid input, direction changes and native wheel/touch input cancel old intent.
- Pointer parallax now sleeps at rest and caches cover geometry between selection
  changes; its existing amplitudes and response are retained.

## Files

| File | Change |
| --- | --- |
| `src/lib/carouselMotion.ts` | Central navigation/idle tuning, depth attenuation and deterministic cover profiles. |
| `src/hooks/useCarouselIdle.ts` | Lifecycle-aware idle clock, navigation blending and browser animation handoff. |
| `src/components/Carousel.tsx` | Supplies motion tuning and visibility/input state without changing ring geometry. |
| `src/components/GameCard.tsx` | Separates the idle transform from ring travel and pointer parallax. |
| `src/App.css` | Shared overshoot easing; removes the separate selected-cover bounce; scopes promotion hints. |
| `src/hooks/useParallax.ts` | Event-driven settling, cached cards, visibility and reduced-motion cleanup. |
| `src/lib/settingsMotion.ts` | Cancellable time-based scrolling with bounded right-stick travel. |
| `src/components/SettingsPanel.tsx` | Pre-paint page/focus setup, scroll lifecycle and option-sheet focus restoration. |
| `src/components/SettingsMotion.css` | Shared Settings timing and predictable programmatic scrolling. |
| `src/App.tsx` | Connects Settings scrolling and carousel/parallax activity to existing application state. |
| `scripts/carouselMotion.test.mjs` | Checks refresh-rate independence, depth, stable phases and one directional overshoot. |
| `scripts/settingsMotion.test.mjs` | Checks scroll retargeting, reversal, cancellation, limits and refresh rates. |
| `package.json` | Adds `npm test` to run all existing and new test files. |
| `docs/motion-polish.md` | This change and verification record. |

## Verification

- `npm run build`: TypeScript and production Vite build pass.
- `npm test`: all five files pass, comprising 39 individual checks.
- Time-based blending/scrolling checked at 60, 120, 144, 165, 240 and 360 Hz.
- Browser checks with a mock Tauri library/controller pass for keyboard,
  native D-pad events, D-pad hold/release, rapid direction reversal, horizontal
  and rotational left-stick input, Settings navigation and right-stick scrolling.
- Measured one 0.554-degree overshoot in each direction, followed by exactly
  zero degrees at rest; neighboring cards follow the same angular movement.
- Seven visible covers show distinct phases and decreasing amplitude with depth.
  Settings, hidden-window and blur pause/resume checks pass without a visible jump.
- Small-library checks (2, 4 and 6 games) confirm every visible cover floats,
  including the opposite card, with one browser loop and zero steady idle style
  writes. Single-card and initial/live reduced-motion checks also pass.
- Settings tests cover intermediate scroll positions, wheel cancellation,
  right-stick reversal, reopening at the home page/top, and reduced motion.
- Original and updated cover bounding boxes and ring matrices match exactly
  with decorative motion disabled. Browser console reports no warnings/errors.

A four-second headless Chromium idle sample measured script work decreasing
from 19.6 ms to 8.1 ms. Total browser task work increased from 34.7 ms to 74.0 ms
with the new animated covers; both samples had zero layout passes. This is a
small added rendering cost, not evidence of identical GPU usage.

The browser checks use Chromium and simulated controller input. Actual Tauri
WebKitGTK rendering, physical controller feel, CPU/GPU use on the target display,
and visual tuning on a physical 240/360 Hz monitor still require a hardware pass.
The existing Rust backend and installed AppImage are not changed by this source
polish pass.
