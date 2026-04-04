// Shared constants for piece rendering, drag interaction, and board layout.
// Tweak values here to adjust visual appearance and feel.

export const GLOBAL_PIECE_SCALE = {
  pawn: 0.009,
  knight: 0.009,
  bishop: 0.009,
  rook: 0.009,
  queen: 0.009,
  king: 0.009,
};

// Aspect ratio adjustment for pieces: [x-scale, y-scale, z-scale]
// y is height, x and z are width/depth
// Values < 1.0 make shorter, > 1.0 make taller
export const PIECE_ASPECT_RATIO = [1.2, 0.825, 1.2]; // [width, height, depth]

export const GHOST_SCALE_FACTOR = 1.0;

// Per-level multiplier applied to the dragged ghost.
// Index mapping: DRAG_LEVEL_SCALE[0] -> top board (z0), ... DRAG_LEVEL_SCALE[3] -> bottom board (z3).
//export const DRAG_LEVEL_SCALE = [1.0, 0.8, 0.7, 0.6];
export const DRAG_LEVEL_SCALE = [0.6, 0.7, 0.8, 1.0];

// Tuning constants for move hit detection
// - MOVE_PIXEL_THRESH: pixel distance from pointer to indicator to accept click
// - MOVE_WORLD_THRESH: fallback world-space distance (units) when screen-space unavailable
// - MOVE_HIT_RADIUS: invisible hit-sphere radius (world units) around indicator
export const MOVE_PIXEL_THRESH = 90; // pixels
export const MOVE_WORLD_THRESH = 1.6; // world units
export const MOVE_HIT_RADIUS = 0.27; // world units — narrower for precise drop targeting
export const PIECE_HIT_RADIUS = 0.45; // world units — radius of flat pickup disc (tweak me)
export const PIECE_HIT_DISC_Y = 0.08; // world units — height of disc above board surface (tweak me)
export const DRAG_PIXEL_THRESHOLD = 11; // minimum pixels to move before drag starts

// Y positions for each logical level `z` (index 0 = TOP board, index 3 = BOTTOM board)
export const LEVEL_Y        = [6.32, 3.95, 1.57, -0.80];  // desktop — even 2.37 gap
export const LEVEL_Y_MOBILE = [10.8,  8.8,  6.8,  4.8];  // mobile (S8+) — even 2.3 gap between all boards

// Returns the correct level-Y array based on current viewport width.
export function getLevelY() {
  return window.innerWidth <= 480 ? LEVEL_Y_MOBILE : LEVEL_Y;
}
