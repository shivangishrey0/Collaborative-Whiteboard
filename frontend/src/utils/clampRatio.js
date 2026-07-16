// Clamps a 0-1 ratio coordinate, used to keep sticky notes and cursors within canvas bounds.
export const clampRatio = (value) => Math.max(0, Math.min(1, value));
