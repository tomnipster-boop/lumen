export const SETTINGS_MOTION = {
  panelDurationMs: 220,
  panelFadeDurationMs: 170,
  backdropDurationMs: 180,
  entranceEasing: "cubic-bezier(0.22, 0.74, 0.18, 1)",
  focusResponseMs: 52,
  stickResponseMs: 34,
  maxStickLeadPx: 64,
  settleDistancePx: 0.5,
} as const;

interface ScrollHost {
  read: () => number;
  write: (position: number) => void;
  maximum: () => number;
  canAnimate: () => boolean;
}

interface ScrollClock {
  now: () => number;
  request: (callback: (time: number) => void) => number;
  cancel: (frame: number) => void;
}

// One replaceable destination, shared by focus navigation and the right stick.
// The clock and host are injectable so refresh-rate and interruption behaviour
// can be checked without relying on a browser's native smooth-scroll queue.
export function createSettingsScrollMotion(host: ScrollHost, clock: ScrollClock) {
  let frame: number | undefined;
  let target = host.read();
  let position = target;
  let lastTime = 0;
  let source: "focus" | "stick" = "focus";
  let stickDirection = 0;
  const clamp = (value: number) => Math.max(0, Math.min(host.maximum(), value));

  const cancel = () => {
    if (frame !== undefined) clock.cancel(frame);
    frame = undefined;
    position = target = host.read();
    stickDirection = 0;
  };

  const tick = (time: number) => {
    frame = undefined;
    if (!host.canAnimate()) {
      cancel();
      return;
    }
    target = clamp(target);
    const elapsed = Math.max(0, time - lastTime);
    lastTime = time;
    const response = source === "focus" ? SETTINGS_MOTION.focusResponseMs : SETTINGS_MOTION.stickResponseMs;
    position = clamp(target + (position - target) * Math.exp(-elapsed / response));
    if (Math.abs(target - position) <= SETTINGS_MOTION.settleDistancePx) {
      position = target;
      host.write(position);
      return;
    }
    host.write(position);
    frame = clock.request(tick);
  };

  const schedule = (immediate = false) => {
    target = clamp(target);
    if (immediate || !host.canAnimate()) {
      const destination = target;
      cancel();
      host.write(destination);
      position = target = destination;
      return;
    }
    if (frame !== undefined) return;
    position = host.read();
    if (Math.abs(target - position) <= SETTINGS_MOTION.settleDistancePx) return;
    lastTime = clock.now();
    frame = clock.request(tick);
  };

  return {
    cancel,
    to(destination: number, immediate = false) {
      source = "focus";
      stickDirection = 0;
      target = destination;
      schedule(immediate);
    },
    by(pixels: number) {
      if (!Number.isFinite(pixels) || pixels === 0) return;
      const current = host.read();
      const direction = Math.sign(pixels);
      // A new input source or reversal discards old intent, including any
      // unfinished centring animation. Stick input never builds a long tail.
      if (source !== "stick" || direction !== stickDirection || frame === undefined) target = current;
      source = "stick";
      stickDirection = direction;
      const lead = SETTINGS_MOTION.maxStickLeadPx;
      target = Math.max(current - lead, Math.min(current + lead, target + pixels));
      schedule();
    },
  };
}

const scrollMotions = new WeakMap<HTMLElement, ReturnType<typeof createSettingsScrollMotion>>();

export function bindSettingsScroll(element: HTMLElement) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const motion = createSettingsScrollMotion({
    read: () => element.scrollTop,
    write: (position) => { element.scrollTop = position; },
    maximum: () => Math.max(0, element.scrollHeight - element.clientHeight),
    canAnimate: () => !document.hidden && !reducedMotion.matches,
  }, {
    now: () => performance.now(),
    request: (callback) => window.requestAnimationFrame(callback),
    cancel: (frame) => window.cancelAnimationFrame(frame),
  });
  scrollMotions.set(element, motion);
  const cancelNativeNavigation = (event: KeyboardEvent) => {
    if (["Tab", "PageUp", "PageDown", "Home", "End"].includes(event.key)) motion.cancel();
  };
  element.addEventListener("wheel", motion.cancel, { passive: true });
  element.addEventListener("touchstart", motion.cancel, { passive: true });
  element.addEventListener("pointerdown", motion.cancel, { passive: true });
  element.addEventListener("keydown", cancelNativeNavigation, true);
  document.addEventListener("visibilitychange", motion.cancel);
  reducedMotion.addEventListener("change", motion.cancel);
  return () => {
    motion.cancel();
    scrollMotions.delete(element);
    element.removeEventListener("wheel", motion.cancel);
    element.removeEventListener("touchstart", motion.cancel);
    element.removeEventListener("pointerdown", motion.cancel);
    element.removeEventListener("keydown", cancelNativeNavigation, true);
    document.removeEventListener("visibilitychange", motion.cancel);
    reducedMotion.removeEventListener("change", motion.cancel);
  };
}

export function resetSettingsScroll(element: HTMLElement) {
  scrollMotions.get(element)?.cancel();
  element.scrollTop = 0;
}

export function scrollSettingsBy(element: HTMLElement, pixels: number) {
  if (!document.hidden && !element.closest("[inert]")) scrollMotions.get(element)?.by(pixels);
}

export function revealSettingsFocus(target: HTMLElement, immediate = false) {
  const element = target.closest<HTMLElement>("[data-controller-scroll]");
  if (!element || document.hidden || element.closest("[inert]")) return;
  const viewport = element.getBoundingClientRect();
  const focus = target.getBoundingClientRect();
  // Panel entrance uses scale; convert visual pixels back to scroll pixels so
  // navigation during the opening transition still finds the correct row.
  const scale = element.offsetHeight > 0 ? viewport.height / element.offsetHeight : 1;
  if (scale <= 0) return;
  const destination = element.scrollTop
    + (focus.top + focus.height / 2 - viewport.top) / scale
    - element.clientTop - element.clientHeight / 2;
  scrollMotions.get(element)?.to(destination, immediate);
}
