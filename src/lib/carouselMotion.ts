/** Motion tuning is separate from ring geometry and library selection. */
export const CAROUSEL_MOTION = {
  travelMs: 460,
  rotationTravelMs: 420,
  // One 2.2% overshoot. CSS retargets from the current transform on new input,
  // so repeated navigation cannot accumulate spring velocity or queued steps.
  travelEasing: "cubic-bezier(0.22, 1.26, 0.36, 1)",
  idleDuringTravel: 0.12,
  idleSuppressMs: 90,
  idleResumeMs: 300,
  idleDepthMs: 180,
  idlePeriodMs: 12000,
  idlePeriodVariationMs: 4300,
  idleX: 1.8,
  idleY: 2.4,
  idleRoll: 0.09,
  idleSettleEpsilon: 0.001,
  // Geometric samples around a loop, not frames: the browser interpolates
  // between them continuously at the display's refresh rate.
  idleLoopSegments: 96,
} as const;

export function dampMotion(current: number, target: number, elapsedMs: number, responseMs: number) {
  return target + (current - target) * Math.exp(-Math.max(0, elapsedMs) / responseMs);
}

/** Attenuation follows the existing angular slot distance, not a second layout. */
export function getIdleDepthFactor(distance: number) {
  return Math.exp(-0.3 * Math.abs(distance) - 0.075 * distance * distance);
}

export function getIdleProfile(id: string) {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  }
  const seed = (hash >>> 0) / 4294967296;
  return {
    phase: seed * Math.PI * 2,
    periodMs: CAROUSEL_MOTION.idlePeriodMs + ((hash >>> 8) % 1000) / 1000 * CAROUSEL_MOTION.idlePeriodVariationMs,
    amplitude: 0.82 + ((hash >>> 16) % 1000) / 1000 * 0.36,
    direction: (hash & 1) === 0 ? 1 : -1,
  };
}
