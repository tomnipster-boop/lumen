import test from "node:test";
import assert from "node:assert/strict";
import {
  CARD_ANGLE_STEP,
  VISIBLE_CARD_DISTANCE,
  getCardGeometry,
  getRelativeOffset,
} from "../src/lib/carouselGeometry.ts";

test("selected card occupies the face-on ring slot", () => {
  const selected = getCardGeometry(0);
  assert.equal(selected.angle, 0);
  assert.equal(selected.opacity, 1);
  assert.equal(selected.culled, false);
});

test("left and right cards occupy equal opposing angles", () => {
  for (const distance of [1, 2, 3, 8]) {
    const left = getCardGeometry(-distance);
    const right = getCardGeometry(distance);
    assert.equal(left.angle, -right.angle);
    assert.equal(left.opacity, right.opacity);
  }
});

test("every slot advances by one constant ring angle", () => {
  for (const offset of [-4, -1, 0, 1, 4]) {
    assert.equal(getCardGeometry(offset).angle, offset * CARD_ANGLE_STEP);
  }
});

test("visible slots fade without changing their circular geometry", () => {
  const near = getCardGeometry(1);
  const far = getCardGeometry(VISIBLE_CARD_DISTANCE);
  assert.ok(near.opacity > far.opacity);
  assert.equal(near.culled, false);
  assert.equal(far.culled, false);
});

test("cards behind the visible side of the ring are culled", () => {
  const hidden = getCardGeometry(VISIBLE_CARD_DISTANCE + 1);
  assert.equal(hidden.opacity, 0);
  assert.equal(hidden.culled, true);
});

test("relative offsets wrap through the hidden back of the ring", () => {
  assert.equal(getRelativeOffset(0, 11, 12), 1);
  assert.equal(getRelativeOffset(11, 0, 12), -1);
  assert.equal(getRelativeOffset(6, 0, 12), 6);
  assert.equal(getRelativeOffset(0, 0, 0), 0);
});
