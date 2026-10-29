import test from "node:test";
import assert from "node:assert/strict";
import {
  createStickRotationState,
  normalizeAngleDelta,
  ROTATION_ACTIVATION_RADIUS,
  ROTATION_STEP_RADIANS,
  updateStickRotation,
} from "../src/lib/stickRotation.ts";

function run(points, frameDuration = 16) {
  const state = createStickRotationState();
  let timestamp = 0;
  let stepsLeft = 0;
  let stepsRight = 0;
  for (const [x, y] of points) {
    const update = updateStickRotation(state, x, y, timestamp += frameDuration);
    stepsLeft += update.stepsLeft;
    stepsRight += update.stepsRight;
  }
  return { state, stepsLeft, stepsRight };
}

function circle(turns, clockwise, degreesPerSample = 5) {
  const points = [];
  const direction = clockwise ? -1 : 1;
  for (let degrees = 0; degrees <= turns * 360; degrees += degreesPerSample) {
    const radians = direction * degrees * Math.PI / 180;
    points.push([Math.cos(radians), -Math.sin(radians)]);
  }
  return points;
}

test("normalizes angular travel across the plus/minus pi boundary", () => {
  assert.ok(Math.abs(normalizeAngleDelta(-Math.PI * 1.9) - Math.PI * 0.1) < 1e-9);
  assert.ok(Math.abs(normalizeAngleDelta(Math.PI * 1.9) + Math.PI * 0.1) < 1e-9);
});

test("one clockwise circle always advances exactly eight games", () => {
  const result = run(circle(1, true));
  assert.equal(result.stepsLeft, 0);
  assert.equal(result.stepsRight, 8);
});

test("one counterclockwise circle always advances exactly eight games", () => {
  const result = run(circle(1, false));
  assert.equal(result.stepsRight, 0);
  assert.equal(result.stepsLeft, 8);
});

test("center noise never activates rotational browsing", () => {
  const result = run([[0.04, 0.02], [-0.03, 0.01], [0.02, -0.04], [0, 0]]);
  assert.equal(result.stepsLeft + result.stepsRight, 0);
  assert.equal(result.state.active, false);
  assert.equal(result.state.tracking, false);
});

test("returning to center clears active rotation state", () => {
  const radius = ROTATION_ACTIVATION_RADIUS + 0.1;
  const result = run([[radius, 0], [radius * 0.9, radius * 0.4], [0, 0]]);
  assert.equal(result.state.active, false);
  assert.equal(result.state.tracking, false);
});

test("direction reversal cancels the old remainder without recentering", () => {
  const points = [];
  for (const degrees of [0, -10, -20, 0, 20, 40, 60]) {
    const radians = degrees * Math.PI / 180;
    points.push([Math.cos(radians), -Math.sin(radians)]);
  }
  const result = run(points);
  assert.equal(result.stepsRight, 0);
  assert.ok(result.stepsLeft >= 1);
});

test("multiple continuous circles preserve the fixed angular mapping", () => {
  const clockwise = run(circle(3, true));
  const counterclockwise = run(circle(3, false));
  assert.equal(clockwise.stepsLeft, 0);
  assert.equal(clockwise.stepsRight, 24);
  assert.equal(counterclockwise.stepsRight, 0);
  assert.equal(counterclockwise.stepsLeft, 24);
});

test("rotation speed never changes games-per-circle", () => {
  const slow = run(circle(3, true), 60);
  const fast = run(circle(3, true), 8);
  assert.equal(slow.stepsRight, 24);
  assert.equal(fast.stepsRight, 24);
  assert.equal(slow.stepsLeft + fast.stepsLeft, 0);
});

test("the flat mapping uses one game per forty-five degrees", () => {
  assert.equal(ROTATION_STEP_RADIANS, Math.PI / 4);
});

test("a large valid angular sample preserves its exact travel", () => {
  const state = createStickRotationState();
  updateStickRotation(state, 1, 0, 0);
  const radians = -120 * Math.PI / 180;
  const update = updateStickRotation(
    state,
    Math.cos(radians),
    -Math.sin(radians),
    16,
  );
  assert.equal(update.stepsLeft + update.stepsRight, 2);
});

test("an implausible single-frame jump is discarded", () => {
  const result = run([[1, 0], [-1, 0]]);
  assert.equal(result.stepsLeft + result.stepsRight, 0);
  assert.equal(result.state.active, false);
});
