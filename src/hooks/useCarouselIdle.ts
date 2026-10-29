import { useLayoutEffect, useRef, type RefObject } from "react";
import { CAROUSEL_MOTION, dampMotion, getIdleDepthFactor, getIdleProfile } from "../lib/carouselMotion";

/** Blend during navigation, then hand steady idle loops to the compositor. */
export function useCarouselIdle(
  carouselRef: RefObject<HTMLElement | null>,
  selectedIndex: number,
  libraryKey: string,
  active: boolean,
  rotationActive: boolean,
) {
  const state = useRef({
    selectedIndex,
    libraryKey,
    active,
    navigatingUntil: 0,
    elapsedMs: 0,
    strength: 0,
    refresh: () => {},
  });

  useLayoutEffect(() => {
    const motion = state.current;
    if (motion.libraryKey === libraryKey && motion.selectedIndex !== selectedIndex) {
      motion.navigatingUntil = performance.now() + (rotationActive
        ? CAROUSEL_MOTION.rotationTravelMs
        : CAROUSEL_MOTION.travelMs);
    }
    motion.selectedIndex = selectedIndex;
    motion.libraryKey = libraryKey;
    motion.active = active;
    motion.refresh();
  }, [active, libraryKey, rotationActive, selectedIndex]);

  useLayoutEffect(() => {
    const carousel = carouselRef.current;
    if (!carousel) return;
    const motion = state.current;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let focused = document.hasFocus();
    let frame = 0;
    let previousTime = 0;
    let loopStartedAt: number | undefined;
    let loops: Animation[] = [];
    let cards: {
      node: HTMLElement;
      profile: ReturnType<typeof getIdleProfile>;
      depth: number;
      targetDepth: number;
    }[] = [];

    const permitted = () => motion.active && focused && !document.hidden && !reducedMotion.matches;
    const idleTransform = (card: typeof cards[number], elapsedMs: number) => {
      const phase = card.profile.phase + elapsedMs / card.profile.periodMs * Math.PI * 2 * card.profile.direction;
      const amplitude = motion.strength * card.depth * card.profile.amplitude;
      const x = Math.cos(phase) * CAROUSEL_MOTION.idleX * amplitude;
      const y = Math.sin(phase) * CAROUSEL_MOTION.idleY * amplitude;
      const roll = Math.sin(phase + 0.7) * CAROUSEL_MOTION.idleRoll * amplitude;
      return `translate3d(${x.toFixed(4)}px, ${y.toFixed(4)}px, 0) rotateZ(${roll.toFixed(4)}deg)`;
    };
    const stopLoops = () => {
      if (loopStartedAt === undefined) return;
      motion.elapsedMs += Math.max(0, performance.now() - loopStartedAt);
      loopStartedAt = undefined;
      // Preserve the exact shared phase without a layout/computed-style read.
      for (const card of cards) card.node.style.transform = idleTransform(card, motion.elapsedMs);
      loops.forEach((animation) => animation.cancel());
      loops = [];
    };
    const startLoops = () => {
      motion.strength = 1;
      loopStartedAt = performance.now();
      loops = cards.map((card) => {
        card.depth = card.targetDepth;
        const keyframes = Array.from({ length: CAROUSEL_MOTION.idleLoopSegments + 1 }, (_, index) => ({
          transform: idleTransform(card, motion.elapsedMs + card.profile.periodMs * index / CAROUSEL_MOTION.idleLoopSegments),
          offset: index / CAROUSEL_MOTION.idleLoopSegments,
        }));
        card.node.style.transform = keyframes[0].transform;
        return card.node.animate(keyframes, {
          duration: card.profile.periodMs,
          iterations: Infinity,
          easing: "linear",
        });
      });
    };
    const render = (time: number) => {
      frame = 0;
      if (!permitted()) { refresh(); return; }
      const elapsedMs = Math.max(0, time - previousTime);
      previousTime = time;
      motion.elapsedMs += elapsedMs;
      const travelling = time < motion.navigatingUntil;
      motion.strength = dampMotion(
        motion.strength,
        travelling ? CAROUSEL_MOTION.idleDuringTravel : 1,
        elapsedMs,
        travelling ? CAROUSEL_MOTION.idleSuppressMs : CAROUSEL_MOTION.idleResumeMs,
      );
      for (const card of cards) {
        card.depth = dampMotion(card.depth, card.targetDepth, elapsedMs, CAROUSEL_MOTION.idleDepthMs);
        card.node.style.transform = idleTransform(card, motion.elapsedMs);
      }
      if (!travelling && 1 - motion.strength < CAROUSEL_MOTION.idleSettleEpsilon
        && cards.every((card) => Math.abs(card.targetDepth - card.depth) < CAROUSEL_MOTION.idleSettleEpsilon)) {
        // No JS frame loop or style writes remain while the library is idle.
        startLoops();
        return;
      }
      frame = window.requestAnimationFrame(render);
    };

    const refresh = () => {
      stopLoops();
      // Snapshot once on selection/library/lifecycle changes, never inside a frame.
      const previous = new Map(cards.map((card) => [card.node, card]));
      cards = Array.from(carousel.querySelectorAll<HTMLElement>(".game-card:not(.game-card--culled)"))
        .flatMap((card) => {
          const node = card.querySelector<HTMLElement>(".game-card__idle");
          if (!node) return [];
          const targetDepth = getIdleDepthFactor(Number(card.dataset.distance ?? 0));
          return [{
            node,
            profile: previous.get(node)?.profile ?? getIdleProfile(card.dataset.gameId ?? ""),
            depth: previous.get(node)?.depth ?? targetDepth,
            targetDepth,
          }];
        });
      if (reducedMotion.matches) {
        carousel.querySelectorAll<HTMLElement>(".game-card__idle").forEach((node) => node.style.removeProperty("transform"));
        motion.strength = 0;
      }
      const running = permitted() && cards.length > 0;
      carousel.dataset.idleActive = String(running);
      if (!running) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      } else if (!frame) {
        // Freeze phase while hidden/covered; resuming cannot jump around the loop.
        previousTime = performance.now();
        if (motion.strength === 1 && previousTime >= motion.navigatingUntil
          && cards.every((card) => card.depth === card.targetDepth)) startLoops();
        else frame = window.requestAnimationFrame(render);
      }
    };
    const onFocus = () => { focused = true; refresh(); };
    const onBlur = () => { focused = false; refresh(); };
    motion.refresh = refresh;
    refresh();
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    reducedMotion.addEventListener("change", refresh);
    return () => {
      window.cancelAnimationFrame(frame);
      stopLoops();
      motion.refresh = () => {};
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      reducedMotion.removeEventListener("change", refresh);
      delete carousel.dataset.idleActive;
    };
  }, [carouselRef]);
}
