/**
 * The palette shown in the interface.
 *
 * `covered: true`  -> the colour has a standard code in standards/usage-of-colours.json
 * `covered: false` -> the colour deliberately has no standard code, so the system has to
 *                     report "no applicable standard" instead of guessing.
 *
 * The uncovered colours were not picked at random: each one sits perceptually close to a
 * covered colour (except grey). This makes the difference between "similar to a colour we
 * know" (a measurement) and "covered by a rule" (a standard) visible in the interface.
 *
 * Values are the CSS named-colour values (CSS Color Module Level 4).
 */
export const PALETTE = Object.freeze([
  { name: 'green', hex: '#008000', covered: true },
  { name: 'blue', hex: '#0000FF', covered: true },
  { name: 'orange', hex: '#FFA500', covered: true },
  { name: 'magenta', hex: '#FF00FF', covered: true },
  { name: 'indigo', hex: '#4B0082', covered: true },
  { name: 'purple', hex: '#800080', covered: true },
  { name: 'violet', hex: '#EE82EE', covered: true },
  { name: 'red', hex: '#FF0000', covered: true },
  { name: 'yellow', hex: '#FFFF00', covered: true },
  { name: 'lime', hex: '#00FF00', covered: false },
  { name: 'crimson', hex: '#DC143C', covered: false },
  { name: 'gold', hex: '#FFD700', covered: false },
  { name: 'navy', hex: '#000080', covered: false },
  { name: 'orchid', hex: '#DA70D6', covered: false },
  { name: 'grey', hex: '#808080', covered: false }
]);

/** @returns {ReadonlyArray<object>} palette entries covered by a standard code */
export function coveredColours() {
  return PALETTE.filter((colour) => colour.covered);
}

/** @returns {ReadonlyArray<object>} palette entries without a standard code */
export function uncoveredColours() {
  return PALETTE.filter((colour) => !colour.covered);
}
