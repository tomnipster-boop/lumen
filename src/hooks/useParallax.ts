import { useEffect, useRef, type RefObject } from "react";

const ZERO = { x: 0, y: 0 };
const SETTLE_EPSILON = 0.0005;

function resetCardParallax(scene: HTMLElement) {
  scene.querySelectorAll<HTMLElement>(".game-card").forEach((card) => {
    card.style.setProperty("--card-pointer-x", "0px");
    card.style.setProperty("--card-pointer-y", "0px");
    card.style.setProperty("--card-pointer-yaw", "0deg");
    card.style.setProperty("--card-pointer-pitch", "0deg");
  });
}

export function useParallax(
  sceneRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  pointerActive: boolean,
  selectionKey?: string,
) {
  const pointerActiveRef = useRef(pointerActive);
  pointerActiveRef.current = pointerActive;
  const syncPointerRef = useRef<(() => void) | null>(null);
  const refreshCardsRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Text stays on whole pixels; fractional shifts affect glyph antialiasing.
    scene.style.setProperty("--foreground-x", "0px");
    scene.style.setProperty("--foreground-y", "0px");
    if (!enabled) {
      scene.style.setProperty("--background-x", "0px");
      scene.style.setProperty("--background-y", "0px");
      resetCardParallax(scene);
      return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = { ...ZERO };
    const target = { ...ZERO };
    const current = { ...ZERO };
    let frame: number | null = null;
    let previousTime = 0;
    let focused = document.hasFocus();
    let cards: Array<{ element: HTMLElement; shift: number; yaw: number; pitch: number }> = [];

    const canAnimate = () => !reducedMotion.matches && !document.hidden && focused;
    const writeParallax = () => {
      scene.style.setProperty("--background-x", `${current.x * 11}px`);
      scene.style.setProperty("--background-y", `${current.y * 9}px`);
      cards.forEach(({ element, shift, yaw, pitch }) => {
        element.style.setProperty("--card-pointer-x", `${current.x * shift}px`);
        element.style.setProperty("--card-pointer-y", `${current.y * shift * 0.68}px`);
        element.style.setProperty("--card-pointer-yaw", `${current.x * yaw}deg`);
        element.style.setProperty("--card-pointer-pitch", `${current.y * -pitch}deg`);
      });
    };

    const refreshCards = () => {
      cards = Array.from(scene.querySelectorAll<HTMLElement>(".game-card"), (element) => {
        const selected = element.classList.contains("game-card--selected");
        const distance = Math.min(3, Number(element.dataset.distance ?? 1));
        return {
          element,
          shift: selected ? 0 : 2.2 + distance * 0.75,
          yaw: selected ? 0 : 1.6 + distance * 0.42,
          pitch: selected ? 0 : 1.15 + distance * 0.28,
        };
      });
      // Selection can change while the pointer is stationary and the loop sleeps.
      writeParallax();
    };

    const stop = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
    };
    const reset = () => {
      stop();
      pointer.x = target.x = current.x = 0;
      pointer.y = target.y = current.y = 0;
      writeParallax();
    };
    const render = (time: number) => {
      frame = null;
      if (!canAnimate()) return;
      if (!pointerActiveRef.current) {
        target.x = 0;
        target.y = 0;
      }
      const deltaSeconds = Math.min(0.05, Math.max(0, time - previousTime) / 1000);
      previousTime = time;
      const damping = 1 - Math.exp(-15 * deltaSeconds);
      current.x += (target.x - current.x) * damping;
      current.y += (target.y - current.y) * damping;
      if (Math.abs(target.x - current.x) < SETTLE_EPSILON) current.x = target.x;
      if (Math.abs(target.y - current.y) < SETTLE_EPSILON) current.y = target.y;
      writeParallax();
      if (current.x !== target.x || current.y !== target.y) {
        frame = window.requestAnimationFrame(render);
      }
    };
    const wake = () => {
      if (frame !== null || !canAnimate()) return;
      if (current.x === target.x && current.y === target.y) return;
      // A sleeping/hidden window must not contribute a large first-frame delta.
      previousTime = performance.now();
      frame = window.requestAnimationFrame(render);
    };
    const syncPointer = () => {
      target.x = pointerActiveRef.current ? pointer.x : 0;
      target.y = pointerActiveRef.current ? pointer.y : 0;
      wake();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!canAnimate()) return;
      pointer.x = (event.clientX / window.innerWidth - 0.5) * 2;
      pointer.y = (event.clientY / window.innerHeight - 0.5) * 2;
      syncPointer();
    };
    const onPointerLeave = () => {
      pointer.x = 0;
      pointer.y = 0;
      syncPointer();
    };
    const onBlur = () => {
      focused = false;
      reset();
    };
    const onFocus = () => {
      focused = true;
      syncPointer();
    };
    const onVisibilityChange = () => {
      focused = document.hasFocus();
      if (document.hidden) reset();
      else syncPointer();
    };
    const onReducedMotionChange = () => {
      if (reducedMotion.matches) reset();
      else syncPointer();
    };

    refreshCards();
    syncPointerRef.current = syncPointer;
    refreshCardsRef.current = refreshCards;
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onPointerLeave);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    reducedMotion.addEventListener("change", onReducedMotionChange);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      reducedMotion.removeEventListener("change", onReducedMotionChange);
      syncPointerRef.current = null;
      refreshCardsRef.current = null;
      reset();
    };
  }, [enabled, sceneRef]);

  useEffect(() => {
    syncPointerRef.current?.();
  }, [pointerActive]);

  useEffect(() => {
    refreshCardsRef.current?.();
  }, [selectionKey]);
}
