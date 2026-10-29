export interface CardGeometry {
  distance: number;
  angle: number;
  opacity: number;
  culled: boolean;
}

export const CARD_ANGLE_STEP = 25;
export const VISIBLE_CARD_DISTANCE = 3;

const CARD_OPACITY = [1, 0.92, 0.72, 0.46] as const;

export function getRelativeOffset(index: number, selectedIndex: number, length: number) {
  if (length <= 0) return 0;
  let offset = index - selectedIndex;
  const halfway = length / 2;
  if (offset > halfway) offset -= length;
  if (offset < -halfway) offset += length;
  // An even library has one card exactly opposite the selection. Keep that
  // ambiguous card on one canonical side so its hidden wrap position is stable.
  if (length % 2 === 0 && offset === -halfway) offset = halfway;
  return offset;
}

/**
 * Gives each full-size card an angular slot on one constant-radius ring.
 * Translation, scale, and foreshortening are deliberately absent here: the
 * browser derives all of them from rotateY(angle) translateZ(ringRadius).
 */
export function getCardGeometry(offset: number): CardGeometry {
  const distance = Math.abs(offset);
  const culled = distance > VISIBLE_CARD_DISTANCE;

  return {
    distance,
    angle: offset * CARD_ANGLE_STEP,
    opacity: culled ? 0 : CARD_OPACITY[distance],
    culled,
  };
}
