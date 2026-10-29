import type { ControllerScrollMode } from "../types/settings";

export type ControllerShortcut =
  | "CONFIRM"
  | "BACK"
  | "REQUEST_QUIT"
  | "OPEN_QUICK_SETTINGS"
  | "OPEN_SETTINGS"
  | "OPEN_DETAILS";

export type LeftStickInterpretation = "ignored" | "rotation" | "horizontal";

export const XBOX_BUTTON = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LEFT_BUMPER: 4,
  RIGHT_BUMPER: 5,
  VIEW: 8,
  MENU: 9,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
} as const;

export const HORIZONTAL_STICK_THRESHOLD = 0.55;
export const RIGHT_STICK_SCROLL_DEADZONE = 0.24;
export const RAW_DPAD_X_AXIS = 6;
export const RAW_DPAD_Y_AXIS = 7;
export const RELEASE_GATE_SETTLE_MS = 100;

export interface ControllerButtonState {
  pressed: boolean;
  value: number;
}

export interface ReleaseGateState {
  armed: boolean;
  neutralSince?: number;
}

export function shortcutForXboxButton(index: number): ControllerShortcut | undefined {
  if (index === XBOX_BUTTON.A) return "CONFIRM";
  if (index === XBOX_BUTTON.B) return "BACK";
  if (index === XBOX_BUTTON.X) return "REQUEST_QUIT";
  if (index === XBOX_BUTTON.VIEW) return "OPEN_QUICK_SETTINGS";
  if (index === XBOX_BUTTON.Y) return "OPEN_SETTINGS";
  if (index === XBOX_BUTTON.MENU) return "OPEN_DETAILS";
  return undefined;
}

export function rightStickScrollVelocity(y: number): number {
  const magnitude = Math.abs(y);
  if (magnitude <= RIGHT_STICK_SCROLL_DEADZONE) return 0;
  const normalized = Math.min(
    1,
    (magnitude - RIGHT_STICK_SCROLL_DEADZONE) / (1 - RIGHT_STICK_SCROLL_DEADZONE),
  );
  const eased = normalized * normalized * (3 - 2 * normalized);
  return Math.sign(y) * (110 * normalized + 1050 * eased);
}

export function rightStickYAxis(axes: readonly number[], standardMapping: boolean): number {
  return standardMapping
    ? axes[3] ?? 0
    : axes[4] ?? axes[3] ?? 0;
}

export function horizontalStickDirection(x: number): -1 | 0 | 1 {
  if (x <= -HORIZONTAL_STICK_THRESHOLD) return -1;
  if (x >= HORIZONTAL_STICK_THRESHOLD) return 1;
  return 0;
}

export function dpadDirection(
  negativePressed: boolean,
  positivePressed: boolean,
  rawAxis = 0,
): -1 | 0 | 1 {
  if (negativePressed !== positivePressed) return negativePressed ? -1 : 1;
  if (rawAxis <= -0.5) return -1;
  if (rawAxis >= 0.5) return 1;
  return 0;
}

export function rawDpadAxes(axes: readonly number[]): { x: number; y: number } {
  return {
    x: axes[RAW_DPAD_X_AXIS] ?? 0,
    y: axes[RAW_DPAD_Y_AXIS] ?? 0,
  };
}

export function rawDpadIsActive(axes: readonly number[]): boolean {
  const { x, y } = rawDpadAxes(axes);
  return Math.abs(x) >= 0.5 || Math.abs(y) >= 0.5;
}

export function menuControlsAreNeutral(
  buttons: readonly ControllerButtonState[],
  axes: readonly number[],
  standardMapping: boolean,
): boolean {
  return !buttons.some((button) => button.pressed || button.value >= 0.5)
    && !rawDpadIsActive(axes)
    && Math.hypot(axes[0] ?? 0, axes[1] ?? 0) < 0.5
    && Math.abs(rightStickYAxis(axes, standardMapping)) <= RIGHT_STICK_SCROLL_DEADZONE;
}

export function createReleaseGateState(): ReleaseGateState {
  return { armed: false };
}

export function resetReleaseGate(state: ReleaseGateState): void {
  state.armed = false;
  state.neutralSince = undefined;
}

export function updateReleaseGate(
  state: ReleaseGateState,
  neutral: boolean,
  now: number,
): boolean {
  if (state.armed) return true;
  if (!neutral) {
    state.neutralSince = undefined;
    return false;
  }
  if (state.neutralSince === undefined) {
    state.neutralSince = now;
    return false;
  }
  if (now - state.neutralSince < RELEASE_GATE_SETTLE_MS) return false;
  state.armed = true;
  return true;
}

export function leftStickInterpretation(
  scrollMode: ControllerScrollMode,
  overlayOpen: boolean,
  dpadPressed: boolean,
): LeftStickInterpretation {
  if (overlayOpen || dpadPressed) return "ignored";
  return scrollMode;
}
