import test from "node:test";
import assert from "node:assert/strict";
import { createSettingsScrollMotion, SETTINGS_MOTION } from "../src/lib/settingsMotion.ts";

function createHarness({ maximum = 2000, rounded = false } = {}) {
  let position = 0;
  let time = 0;
  let canAnimate = true;
  let nextId = 1;
  const frames = new Map();
  const motion = createSettingsScrollMotion({
    read: () => position,
    write: (value) => { position = rounded ? Math.round(value) : value; },
    maximum: () => maximum,
    canAnimate: () => canAnimate,
  }, {
    now: () => time,
    request: (callback) => { const id = nextId++; frames.set(id, callback); return id; },
    cancel: (id) => { frames.delete(id); },
  });
  return {
    motion,
    get position() { return position; },
    get pending() { return frames.size; },
    setPosition(value) { position = value; },
    setAnimate(value) { canAnimate = value; },
    frame(elapsed) {
      time += elapsed;
      const current = [...frames.values()];
      frames.clear();
      for (const callback of current) callback(time);
    },
  };
}

test("focus scrolling follows elapsed time at 60 through 360 Hz", () => {
  const positions = [];
  for (const hz of [60, 120, 144, 165, 240, 360]) {
    const harness = createHarness();
    harness.motion.to(1000);
    const frames = Math.floor(hz * 0.2);
    for (let index = 0; index < frames; index++) harness.frame(1000 / hz);
    harness.frame(200 - frames * 1000 / hz);
    positions.push(harness.position);
  }
  assert.ok(Math.max(...positions) - Math.min(...positions) < 0.001);
});

test("rapid focus changes replace one destination and reverse without snapping", () => {
  const harness = createHarness();
  harness.motion.to(1500);
  harness.frame(80);
  const interrupted = harness.position;
  harness.motion.to(300);
  harness.motion.to(600);
  harness.motion.to(100);
  assert.equal(harness.position, interrupted);
  assert.equal(harness.pending, 1);
  harness.frame(16);
  assert.ok(harness.position < interrupted);
  assert.ok(harness.position > 100);
  harness.frame(1000);
  assert.equal(harness.position, 100);
  assert.equal(harness.pending, 0);
});

test("stick input replaces focus motion and bounds its remaining travel", () => {
  const harness = createHarness();
  harness.motion.to(1800);
  harness.frame(32);
  const before = harness.position;
  for (let index = 0; index < 1000; index++) harness.motion.by(20);
  harness.frame(1000);
  assert.equal(harness.position, before + SETTINGS_MOTION.maxStickLeadPx);
  assert.equal(harness.pending, 0);
  harness.motion.by(60);
  harness.frame(16);
  const turning = harness.position;
  harness.motion.by(-20);
  harness.frame(16);
  assert.ok(harness.position < turning);
});

test("native scrolling cancellation never pulls the user's viewport back", () => {
  const harness = createHarness();
  harness.motion.to(1000);
  harness.frame(30);
  harness.motion.cancel();
  harness.setPosition(750);
  harness.frame(1000);
  assert.equal(harness.position, 750);
  assert.equal(harness.pending, 0);
});

test("reduced motion applies destinations immediately and creates no frame", () => {
  const harness = createHarness();
  harness.setAnimate(false);
  harness.motion.to(700);
  assert.equal(harness.position, 700);
  harness.motion.by(20);
  assert.equal(harness.position, 720);
  assert.equal(harness.pending, 0);
});

test("hidden motion stops without replaying elapsed time when resumed", () => {
  const harness = createHarness();
  harness.motion.to(1000);
  harness.frame(20);
  const before = harness.position;
  harness.setAnimate(false);
  harness.frame(10000);
  assert.equal(harness.position, before);
  assert.equal(harness.pending, 0);
  harness.setAnimate(true);
  harness.frame(10000);
  assert.equal(harness.position, before);
});

test("scroll limits clamp destinations and rounded browser positions still settle", () => {
  const harness = createHarness({ maximum: 500, rounded: true });
  harness.motion.to(1000);
  for (let index = 0; index < 500; index++) harness.frame(1000 / 360);
  assert.equal(harness.position, 500);
  assert.equal(harness.pending, 0);
  harness.motion.to(-300);
  harness.frame(1000);
  assert.equal(harness.position, 0);
  assert.equal(harness.pending, 0);
});
