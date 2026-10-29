import test from "node:test";
import assert from "node:assert/strict";
import { CAROUSEL_MOTION, dampMotion, getIdleDepthFactor, getIdleProfile } from "../src/lib/carouselMotion.ts";

test("idle blending covers the same distance at 60–360 Hz", () => {
  for (const target of [CAROUSEL_MOTION.idleDuringTravel, 1]) {
    const results = [60, 120, 144, 165, 240, 360].map((hz) => {
      let value = target === 1 ? 0.12 : 1;
      for (let frame = 0; frame < hz; frame += 1) {
        value = dampMotion(value, target, 1000 / hz, CAROUSEL_MOTION.idleResumeMs);
      }
      return value;
    });
    assert.ok(Math.max(...results) - Math.min(...results) < 1e-12);
  }
});

test("depth follows the existing ring slots symmetrically and progressively fades", () => {
  let previous = Infinity;
  for (let distance = 0; distance <= 6; distance += 1) {
    const amplitude = getIdleDepthFactor(distance);
    assert.equal(amplitude, getIdleDepthFactor(-distance));
    assert.ok(amplitude > 0 && amplitude < previous);
    previous = amplitude;
  }
  assert.equal(getIdleDepthFactor(0), 1);
  assert.ok(getIdleDepthFactor(3) < 0.25);
});

test("a cover keeps its idle phase when reordered and neighboring IDs do not synchronize", () => {
  const ids = ["game-1", "game-2", "game-3", "game-4"];
  const profiles = new Map(ids.map((id) => [id, getIdleProfile(id)]));
  for (const id of ids.reverse()) assert.deepEqual(getIdleProfile(id), profiles.get(id));
  assert.equal(new Set([...profiles.values()].map((profile) => profile.phase)).size, ids.length);
  assert.equal(new Set([...profiles.values()].map((profile) => profile.periodMs)).size, ids.length);
});

test("navigation easing has one restrained directional overshoot and an exact resting position", () => {
  const [, y1, , y2] = CAROUSEL_MOTION.travelEasing.match(/[\d.]+/g).map(Number);
  const values = Array.from({ length: 1001 }, (_, index) => {
    const t = index / 1000;
    return 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t ** 2 * y2 + t ** 3;
  });
  const peak = Math.max(...values);
  assert.ok(peak > 1.01 && peak < 1.035);
  assert.equal(values.at(-1), 1);
  const peakIndex = values.indexOf(peak);
  for (let index = 1; index < values.length; index += 1) {
    assert.ok(index <= peakIndex ? values[index] >= values[index - 1] : values[index] <= values[index - 1]);
  }
  for (const direction of [-1, 1]) {
    const target = direction * 25;
    assert.ok((target * peak - target) * direction > 0);
  }
});
