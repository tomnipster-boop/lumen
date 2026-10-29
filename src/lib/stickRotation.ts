export const ROTATION_ACTIVATION_RADIUS = 0.65;
export const ROTATION_RELEASE_RADIUS = 0.35;
export const ROTATION_STEP_RADIANS = degreesToRadians(45);

const GESTURE_ACTIVATION_RADIANS = degreesToRadians(15);
const MIN_MEANINGFUL_DELTA = degreesToRadians(0.35);
const REVERSAL_NOISE_TOLERANCE = degreesToRadians(3);
const MAX_FRAME_DELTA = degreesToRadians(135);
const STALE_FRAME_MS = 180;
const ROTATION_IDLE_MS = 280;

export interface StickRotationState {
  tracking: boolean;
  active: boolean;
  previousAngle?: number;
  accumulator: number;
  candidateTravel: number;
  direction: -1 | 0 | 1;
  lastTimestamp: number;
  lastMeaningfulAt: number;
}

export interface StickRotationUpdate {
  stepsLeft: number;
  stepsRight: number;
  active: boolean;
}

export function degreesToRadians(degrees: number): number {
  return degrees * Math.PI / 180;
}

export function createStickRotationState(): StickRotationState {
  return {
    tracking: false,
    active: false,
    accumulator: 0,
    candidateTravel: 0,
    direction: 0,
    lastTimestamp: 0,
    lastMeaningfulAt: 0,
  };
}

export function resetStickRotation(state: StickRotationState): void {
  state.tracking = false;
  state.active = false;
  state.previousAngle = undefined;
  state.accumulator = 0;
  state.candidateTravel = 0;
  state.direction = 0;
  state.lastTimestamp = 0;
  state.lastMeaningfulAt = 0;
}

export function normalizeAngleDelta(delta: number): number {
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function beginTracking(
  state: StickRotationState,
  angle: number,
  timestamp: number,
): StickRotationUpdate {
  state.tracking = true;
  state.active = false;
  state.previousAngle = angle;
  state.accumulator = 0;
  state.candidateTravel = 0;
  state.direction = 0;
  state.lastTimestamp = timestamp;
  state.lastMeaningfulAt = timestamp;
  return { stepsLeft: 0, stepsRight: 0, active: false };
}

export function updateStickRotation(
  state: StickRotationState,
  x: number,
  y: number,
  timestamp: number,
): StickRotationUpdate {
  const radius = Math.hypot(x, y);
  const angle = Math.atan2(-y, x);

  if (!state.tracking) {
    return radius >= ROTATION_ACTIVATION_RADIUS
      ? beginTracking(state, angle, timestamp)
      : { stepsLeft: 0, stepsRight: 0, active: false };
  }

  if (radius <= ROTATION_RELEASE_RADIUS) {
    resetStickRotation(state);
    return { stepsLeft: 0, stepsRight: 0, active: false };
  }

  if (timestamp - state.lastTimestamp > STALE_FRAME_MS || state.previousAngle === undefined) {
    resetStickRotation(state);
    return radius >= ROTATION_ACTIVATION_RADIUS
      ? beginTracking(state, angle, timestamp)
      : { stepsLeft: 0, stepsRight: 0, active: false };
  }

  const delta = normalizeAngleDelta(angle - state.previousAngle);
  state.previousAngle = angle;
  state.lastTimestamp = timestamp;

  if (Math.abs(delta) > MAX_FRAME_DELTA) {
    state.active = false;
    state.accumulator = 0;
    state.candidateTravel = 0;
    state.direction = 0;
    return { stepsLeft: 0, stepsRight: 0, active: false };
  }

  if (Math.abs(delta) < MIN_MEANINGFUL_DELTA) {
    if (state.active && timestamp - state.lastMeaningfulAt >= ROTATION_IDLE_MS) {
      state.active = false;
      state.accumulator = 0;
      state.candidateTravel = 0;
      state.direction = 0;
    }
    return { stepsLeft: 0, stepsRight: 0, active: state.active };
  }

  state.lastMeaningfulAt = timestamp;
  const direction: -1 | 1 = delta < 0 ? -1 : 1;

  if (!state.active) {
    if (state.direction !== 0 && direction !== state.direction) {
      state.candidateTravel = delta;
    } else {
      state.candidateTravel += delta;
    }
    state.direction = direction;
    if (Math.abs(state.candidateTravel) < GESTURE_ACTIVATION_RADIANS) {
      return { stepsLeft: 0, stepsRight: 0, active: false };
    }
    state.active = true;
    state.accumulator = state.candidateTravel;
    state.candidateTravel = 0;
  } else if (direction !== state.direction) {
    if (Math.abs(delta) < REVERSAL_NOISE_TOLERANCE) {
      return { stepsLeft: 0, stepsRight: 0, active: true };
    }
    // Discard the old-direction remainder so reversal never emits a stale step.
    state.accumulator = delta;
    state.direction = direction;
  } else {
    state.accumulator += delta;
  }

  let stepsLeft = 0;
  let stepsRight = 0;
  while (
    state.accumulator <= -ROTATION_STEP_RADIANS
    && stepsRight < 3
  ) {
    stepsRight += 1;
    state.accumulator += ROTATION_STEP_RADIANS;
  }
  while (
    state.accumulator >= ROTATION_STEP_RADIANS
    && stepsLeft < 3
  ) {
    stepsLeft += 1;
    state.accumulator -= ROTATION_STEP_RADIANS;
  }
  return { stepsLeft, stepsRight, active: true };
}
