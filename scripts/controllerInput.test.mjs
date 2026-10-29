import test from "node:test";
import assert from "node:assert/strict";
import {
  HORIZONTAL_STICK_THRESHOLD,
  RELEASE_GATE_SETTLE_MS,
  RIGHT_STICK_SCROLL_DEADZONE,
  XBOX_BUTTON,
  createReleaseGateState,
  dpadDirection,
  horizontalStickDirection,
  leftStickInterpretation,
  menuControlsAreNeutral,
  rawDpadAxes,
  rawDpadIsActive,
  resetReleaseGate,
  rightStickScrollVelocity,
  rightStickYAxis,
  shortcutForXboxButton,
  updateReleaseGate,
} from "../src/lib/controllerInput.ts";

test("Xbox shortcuts use direct A, B, X, Y, and Menu mappings", () => {
  assert.equal(shortcutForXboxButton(XBOX_BUTTON.A), "CONFIRM");
  assert.equal(shortcutForXboxButton(XBOX_BUTTON.B), "BACK");
  assert.equal(shortcutForXboxButton(XBOX_BUTTON.X), "REQUEST_QUIT");
  assert.equal(shortcutForXboxButton(XBOX_BUTTON.Y), "OPEN_SETTINGS");
  assert.equal(shortcutForXboxButton(XBOX_BUTTON.MENU), "OPEN_DETAILS");
  assert.equal(shortcutForXboxButton(XBOX_BUTTON.VIEW), "OPEN_QUICK_SETTINGS");
});

test("right stick page scrolling has a deadzone and a smooth signed response", () => {
  assert.equal(rightStickScrollVelocity(0), 0);
  assert.equal(rightStickScrollVelocity(RIGHT_STICK_SCROLL_DEADZONE), 0);
  assert.ok(rightStickScrollVelocity(0.5) > 0);
  assert.ok(rightStickScrollVelocity(-0.5) < 0);
  assert.ok(rightStickScrollVelocity(1) > rightStickScrollVelocity(0.5));
  assert.equal(rightStickScrollVelocity(-1), -rightStickScrollVelocity(1));
});

test("right stick Y uses standard and raw Linux xpad axis layouts", () => {
  const axes = [0, 0, 0.25, 0.5, 0.75, 0, 0, 0];
  assert.equal(rightStickYAxis(axes, true), 0.5);
  assert.equal(rightStickYAxis(axes, false), 0.75);
});

test("D-pad accepts both standard buttons and raw Linux hat axes", () => {
  assert.equal(dpadDirection(true, false, 0), -1);
  assert.equal(dpadDirection(false, true, 0), 1);
  assert.equal(dpadDirection(false, false, -1), -1);
  assert.equal(dpadDirection(false, false, 1), 1);
  assert.equal(dpadDirection(false, false, 0), 0);
});

test("raw D-pad hats remain visible when WebKit labels the controller standard", () => {
  const axes = [0, 0, 0, 0, 0, 0, -1, 1];
  assert.deepEqual(rawDpadAxes(axes), { x: -1, y: 1 });
  assert.equal(rawDpadIsActive(axes), true);
});

test("menu neutral detection includes buttons, both sticks, and raw D-pad hats", () => {
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  const axes = [0, 0, 0, 0, 0, 0, 0, 0];
  assert.equal(menuControlsAreNeutral(buttons, axes, true), true);

  buttons[XBOX_BUTTON.A] = { pressed: true, value: 1 };
  assert.equal(menuControlsAreNeutral(buttons, axes, true), false);
  buttons[XBOX_BUTTON.A] = { pressed: false, value: 0 };
  axes[6] = 1;
  assert.equal(menuControlsAreNeutral(buttons, axes, true), false);
  axes[6] = 0;
  axes[0] = 0.7;
  assert.equal(menuControlsAreNeutral(buttons, axes, true), false);
});

test("release gate swallows stale input until controls settle at neutral", () => {
  const gate = createReleaseGateState();
  assert.equal(updateReleaseGate(gate, false, 0), false);
  assert.equal(updateReleaseGate(gate, true, 20), false);
  assert.equal(updateReleaseGate(gate, true, 20 + RELEASE_GATE_SETTLE_MS - 1), false);
  assert.equal(updateReleaseGate(gate, true, 20 + RELEASE_GATE_SETTLE_MS), true);
  assert.equal(updateReleaseGate(gate, false, 200), true);

  resetReleaseGate(gate);
  assert.equal(updateReleaseGate(gate, false, 300), false);
});

test("horizontal mode uses only the X axis threshold", () => {
  assert.equal(horizontalStickDirection(-1), -1);
  assert.equal(horizontalStickDirection(-HORIZONTAL_STICK_THRESHOLD), -1);
  assert.equal(horizontalStickDirection(0), 0);
  assert.equal(horizontalStickDirection(HORIZONTAL_STICK_THRESHOLD), 1);
  assert.equal(horizontalStickDirection(1), 1);
});

test("horizontal mode deadzone prevents noisy browsing", () => {
  assert.equal(horizontalStickDirection(-0.54), 0);
  assert.equal(horizontalStickDirection(0.54), 0);
});

test("left stick is ignored in overlays and while the D-pad has priority", () => {
  assert.equal(leftStickInterpretation("rotation", true, false), "ignored");
  assert.equal(leftStickInterpretation("horizontal", true, false), "ignored");
  assert.equal(leftStickInterpretation("rotation", false, true), "ignored");
  assert.equal(leftStickInterpretation("horizontal", false, true), "ignored");
});

test("home screen activates exactly the selected left-stick interpretation", () => {
  assert.equal(leftStickInterpretation("rotation", false, false), "rotation");
  assert.equal(leftStickInterpretation("horizontal", false, false), "horizontal");
});
