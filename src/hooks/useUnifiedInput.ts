import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import {
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
} from "../lib/controllerInput";
import {
  createStickRotationState,
  resetStickRotation,
  updateStickRotation,
} from "../lib/stickRotation";
import type { ControllerScrollMode } from "../types/settings";

export type InputAction =
  | "NAV_LEFT"
  | "NAV_RIGHT"
  | "NAV_UP"
  | "NAV_DOWN"
  | "CONFIRM"
  | "BACK"
  | "REQUEST_QUIT"
  | "OPEN_QUICK_SETTINGS"
  | "OPEN_SETTINGS"
  | "OPEN_DETAILS";

export type InputMode = "mouse" | "keyboard" | "controller";
export type InputSource = "keyboard" | "controller";

interface UnifiedInputOptions {
  gamepadEnabled: boolean;
  overlayOpen: boolean;
  inputResetKey?: string;
  controllerScrollMode: ControllerScrollMode;
  rightStickScrollEnabled?: boolean;
  onRightStickScroll?: (pixels: number) => void;
  onAction: (action: InputAction, source: InputSource) => void;
}

interface PhysicalAction {
  token: string;
  action: InputAction;
  repeatable: boolean;
}

interface NativeDpadEvent {
  axis: "x" | "y";
  value: number;
}

interface NativeDpadTimers {
  delay?: number;
  repeat?: number;
}

const REPEAT_DELAY = 280;
const REPEAT_INTERVAL = 110;
const XBOX_COMPATIBLE_ID = /gamesir|xbox|x-box|xinput/i;

function isTextEntry(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(
    target.closest("input, textarea, select, [contenteditable='true']"),
  );
}

function pressed(gamepad: Gamepad, index: number): boolean {
  const button = gamepad.buttons[index];
  return Boolean(button && (button.pressed || button.value >= 0.5));
}

function isSupportedGamepad(gamepad: Gamepad | null): gamepad is Gamepad {
  if (!gamepad?.connected) return false;
  if (gamepad.mapping === "standard") return true;

  // WebKitGTK can expose Linux xpad devices without assigning the standard
  // mapping string even though they use the conventional Xbox control layout.
  return XBOX_COMPATIBLE_ID.test(gamepad.id)
    && gamepad.buttons.length >= 8
    && gamepad.axes.length >= 2;
}

function digitalActions(gamepad: Gamepad, includeDpadActions: boolean): {
  actions: PhysicalAction[];
  dpadDirectionPressed: boolean;
} {
  const actions: PhysicalAction[] = [];
  const add = (
    condition: boolean,
    token: string,
    action: InputAction,
    repeatable = false,
  ) => {
    if (condition) actions.push({ token, action, repeatable });
  };

  // Standard mapping uses buttons 12–15. Raw Linux xpad mappings expose the
  // D-pad as hat axes 6/7. WebKitGTK sometimes labels the pad as standard but
  // still leaves the GameSir hats on those raw axes, so accept both every time.
  const rawDpad = rawDpadAxes(gamepad.axes);
  const dpadX = dpadDirection(
    pressed(gamepad, XBOX_BUTTON.DPAD_LEFT),
    pressed(gamepad, XBOX_BUTTON.DPAD_RIGHT),
    rawDpad.x,
  );
  const dpadY = dpadDirection(
    pressed(gamepad, XBOX_BUTTON.DPAD_UP),
    pressed(gamepad, XBOX_BUTTON.DPAD_DOWN),
    rawDpad.y,
  );
  const dpadLeft = dpadX < 0;
  const dpadRight = dpadX > 0;
  const dpadUp = dpadY < 0;
  const dpadDown = dpadY > 0;
  const dpadDirectionPressed = dpadLeft || dpadRight || dpadUp || dpadDown;

  for (const index of [XBOX_BUTTON.A, XBOX_BUTTON.B, XBOX_BUTTON.X, XBOX_BUTTON.Y, XBOX_BUTTON.MENU, XBOX_BUTTON.VIEW]) {
    const shortcut = shortcutForXboxButton(index);
    if (shortcut) add(pressed(gamepad, index), `button-${index}`, shortcut);
  }
  if (includeDpadActions) {
    add(dpadLeft, "dpad-left", "NAV_LEFT", true);
    add(dpadRight, "dpad-right", "NAV_RIGHT", true);
    add(dpadUp, "dpad-up", "NAV_UP", true);
    add(dpadDown, "dpad-down", "NAV_DOWN", true);
  }

  return {
    actions,
    dpadDirectionPressed,
  };
}

function horizontalStickActions(gamepad: Gamepad): PhysicalAction[] {
  const direction = horizontalStickDirection(gamepad.axes[0] ?? 0);
  if (direction < 0) return [{ token: "stick-left", action: "NAV_LEFT", repeatable: true }];
  if (direction > 0) return [{ token: "stick-right", action: "NAV_RIGHT", repeatable: true }];
  return [];
}

function hasMeaningfulActivity(gamepad: Gamepad): boolean {
  return gamepad.buttons.some((button) => button.pressed || button.value >= 0.5)
    || rawDpadIsActive(gamepad.axes)
    || Math.hypot(gamepad.axes[0] ?? 0, gamepad.axes[1] ?? 0) >= 0.5
    || Math.abs(rightStickYAxis(gamepad.axes, gamepad.mapping === "standard")) >= 0.5;
}

export function useUnifiedInput({
  gamepadEnabled,
  overlayOpen,
  inputResetKey,
  controllerScrollMode,
  rightStickScrollEnabled = false,
  onRightStickScroll,
  onAction,
}: UnifiedInputOptions) {
  const [mode, setMode] = useState<InputMode>("mouse");
  const [controllerConnected, setControllerConnected] = useState(false);
  const [rotationActive, setRotationActive] = useState(false);
  const actionRef = useRef(onAction);
  const rightStickScrollRef = useRef(onRightStickScroll);
  actionRef.current = onAction;
  rightStickScrollRef.current = onRightStickScroll;

  useEffect(() => {
    const onPointerMove = () => setMode((current) => current === "mouse" ? current : "mouse");
    const onKeyDown = (event: KeyboardEvent) => {
      const textEntry = isTextEntry(event.target);
      let action: InputAction | undefined;

      if (event.key === "Escape") action = "BACK";
      else if (!textEntry && event.key.toLowerCase() === "q") action = "OPEN_QUICK_SETTINGS";
      else if (!textEntry && event.key === "ArrowLeft") action = "NAV_LEFT";
      else if (!textEntry && event.key === "ArrowRight") action = "NAV_RIGHT";
      else if (!textEntry && event.key === "ArrowUp") action = "NAV_UP";
      else if (!textEntry && event.key === "ArrowDown") action = "NAV_DOWN";
      else if (!textEntry && (event.key === "Enter" || event.key === " ")) action = "CONFIRM";
      else if (!textEntry && event.key.toLowerCase() === "d") action = "OPEN_DETAILS";
      else if (!textEntry && (
        (event.key === "," && (event.ctrlKey || event.metaKey))
        || (event.key.toLowerCase() === "s" && !event.ctrlKey && !event.metaKey)
      )) action = "OPEN_SETTINGS";

      if (!action) return;
      event.preventDefault();
      setMode("keyboard");
      actionRef.current(action, "keyboard");
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  useEffect(() => {
    if (!gamepadEnabled || !isTauri()) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;
    const timers = new Map<NativeDpadEvent["axis"], NativeDpadTimers>();

    const clearAxis = (axis: NativeDpadEvent["axis"]) => {
      const active = timers.get(axis);
      if (active?.delay !== undefined) window.clearTimeout(active.delay);
      if (active?.repeat !== undefined) window.clearInterval(active.repeat);
      timers.delete(axis);
    };
    const actionFor = ({ axis, value }: NativeDpadEvent): InputAction | undefined => {
      if (axis === "x" && value < 0) return "NAV_LEFT";
      if (axis === "x" && value > 0) return "NAV_RIGHT";
      if (axis === "y" && value < 0) return "NAV_UP";
      if (axis === "y" && value > 0) return "NAV_DOWN";
      return undefined;
    };
    const beginAxis = (axis: NativeDpadEvent["axis"], action: InputAction) => {
      setMode((current) => current === "controller" ? current : "controller");
      actionRef.current(action, "controller");
      const active: NativeDpadTimers = {};
      active.delay = window.setTimeout(() => {
        actionRef.current(action, "controller");
        active.repeat = window.setInterval(
          () => actionRef.current(action, "controller"),
          REPEAT_INTERVAL,
        );
      }, REPEAT_DELAY);
      timers.set(axis, active);
    };

    void listen<NativeDpadEvent>("controller://dpad", ({ payload }) => {
      if (disposed) return;
      clearAxis(payload.axis);
      const action = actionFor(payload);
      if (action) beginAxis(payload.axis, action);
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch((error) => console.warn("Native D-pad input is unavailable.", error));

    return () => {
      disposed = true;
      unlisten?.();
      clearAxis("x");
      clearAxis("y");
    };
  }, [gamepadEnabled, inputResetKey]);

  useEffect(() => {
    if (!gamepadEnabled) {
      setControllerConnected(false);
      setRotationActive(false);
      return;
    }

    let frame = 0;
    let activePadIndex: number | undefined;
    let previousTokens = new Set<string>();
    const repeatAt = new Map<string, number>();
    const rotationState = createStickRotationState();
    const releaseGate = createReleaseGateState();
    let reportedConnected = false;
    let reportedRotation = false;
    const includeBrowserDpadActions = !isTauri();
    let wasHidden = document.hidden;
    let previousFrameAt: number | undefined;

    const reportRotation = (active: boolean) => {
      if (active === reportedRotation) return;
      reportedRotation = active;
      setRotationActive(active);
    };

    const clearPhysicalState = () => {
      previousTokens.clear();
      repeatAt.clear();
      resetStickRotation(rotationState);
      resetReleaseGate(releaseGate);
      reportRotation(false);
    };

    const poll = (now: number) => {
      const elapsedMs = previousFrameAt === undefined ? 16 : Math.min(40, now - previousFrameAt);
      previousFrameAt = now;
      if (document.hidden) {
        if (!wasHidden) clearPhysicalState();
        wasHidden = true;
        frame = window.requestAnimationFrame(poll);
        return;
      }
      if (wasHidden) clearPhysicalState();
      wasHidden = false;

      const pads = Array.from(navigator.getGamepads?.() ?? []).filter(
        isSupportedGamepad,
      );
      const connected = pads.length > 0;
      if (reportedConnected !== connected) {
        reportedConnected = connected;
        setControllerConnected(connected);
      }

      const previousPadIndex = activePadIndex;
      const recentlyActive = pads.find(hasMeaningfulActivity);
      if (recentlyActive) activePadIndex = recentlyActive.index;
      const gamepad = pads.find((pad) => pad.index === activePadIndex) ?? pads[0];
      if (!gamepad) {
        if (activePadIndex !== undefined) clearPhysicalState();
        activePadIndex = undefined;
        frame = window.requestAnimationFrame(poll);
        return;
      }

      if (gamepad.index !== previousPadIndex) {
        clearPhysicalState();
        activePadIndex = gamepad.index;
      }

      const digital = digitalActions(gamepad, includeBrowserDpadActions);
      if (!updateReleaseGate(
        releaseGate,
        menuControlsAreNeutral(
          gamepad.buttons,
          gamepad.axes,
          gamepad.mapping === "standard",
        ),
        now,
      )) {
        frame = window.requestAnimationFrame(poll);
        return;
      }
      let physicalActions = digital.actions;
      let rotation = { stepsLeft: 0, stepsRight: 0, active: false };
      const stickInterpretation = leftStickInterpretation(
        controllerScrollMode,
        overlayOpen,
        digital.dpadDirectionPressed,
      );

      if (stickInterpretation === "ignored") {
        resetStickRotation(rotationState);
        reportRotation(false);
      } else if (stickInterpretation === "rotation") {
        rotation = updateStickRotation(
          rotationState,
          gamepad.axes[0] ?? 0,
          gamepad.axes[1] ?? 0,
          now,
        );
        reportRotation(rotation.active);
      } else {
        resetStickRotation(rotationState);
        reportRotation(false);
        physicalActions = [...physicalActions, ...horizontalStickActions(gamepad)];
      }

      const stickActivity = stickInterpretation === "rotation"
        ? Math.hypot(gamepad.axes[0] ?? 0, gamepad.axes[1] ?? 0) >= 0.5
        : stickInterpretation === "horizontal"
          ? horizontalStickDirection(gamepad.axes[0] ?? 0) !== 0
          : false;
      const rightScrollVelocity = rightStickScrollEnabled
        ? rightStickScrollVelocity(rightStickYAxis(gamepad.axes, gamepad.mapping === "standard"))
        : 0;
      if (rightScrollVelocity !== 0) {
        rightStickScrollRef.current?.(rightScrollVelocity * elapsedMs / 1000);
      }
      if (digital.actions.length > 0 || stickActivity || rightScrollVelocity !== 0 || rotation.stepsLeft > 0 || rotation.stepsRight > 0) {
        setMode((current) => current === "controller" ? current : "controller");
      }

      for (let step = 0; step < rotation.stepsLeft; step += 1) {
        actionRef.current("NAV_LEFT", "controller");
      }
      for (let step = 0; step < rotation.stepsRight; step += 1) {
        actionRef.current("NAV_RIGHT", "controller");
      }

      const currentTokens = new Set(physicalActions.map(({ token }) => token));
      physicalActions.forEach(({ token, action, repeatable }) => {
        if (!previousTokens.has(token)) {
          actionRef.current(action, "controller");
          repeatAt.set(token, now + REPEAT_DELAY);
        } else if (repeatable && now >= (repeatAt.get(token) ?? Infinity)) {
          actionRef.current(action, "controller");
          repeatAt.set(token, now + REPEAT_INTERVAL);
        }
      });
      previousTokens.forEach((token) => {
        if (!currentTokens.has(token)) repeatAt.delete(token);
      });
      previousTokens = currentTokens;
      frame = window.requestAnimationFrame(poll);
    };

    const restartPolling = () => {
      window.cancelAnimationFrame(frame);
      activePadIndex = undefined;
      previousFrameAt = undefined;
      wasHidden = document.hidden;
      clearPhysicalState();
      reportedConnected = false;
      setControllerConnected(false);
      frame = window.requestAnimationFrame(poll);
    };
    const onVisibilityChange = () => {
      if (!document.hidden) restartPolling();
    };

    window.addEventListener("focus", restartPolling);
    window.addEventListener("gamepadconnected", restartPolling);
    window.addEventListener("gamepaddisconnected", restartPolling);
    document.addEventListener("visibilitychange", onVisibilityChange);
    frame = window.requestAnimationFrame(poll);
    return () => {
      window.removeEventListener("focus", restartPolling);
      window.removeEventListener("gamepadconnected", restartPolling);
      window.removeEventListener("gamepaddisconnected", restartPolling);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.cancelAnimationFrame(frame);
      clearPhysicalState();
      setControllerConnected(false);
    };
  }, [controllerScrollMode, gamepadEnabled, inputResetKey, overlayOpen, rightStickScrollEnabled]);

  return { mode, controllerConnected, rotationActive };
}
