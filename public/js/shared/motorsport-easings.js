/**
 * Motorsport-specific GSAP easing curves.
 *
 * Registers custom easings optimized for broadcast graphics:
 *   towerSnap    — Hard decel, items slam into place
 *   towerSettle  — Slight overshoot then settle
 *   dataPunch    — Instant accel, linear to end
 *   wipeDrive    — Sharp start for mask/clip-path reveals
 *   exitAccel    — Slow start, fast exit
 *   telemetryLin — Linear (alias for 'none')
 *   celebBounce  — Festive overshoot
 *   breatheSine  — Symmetric ease-in-out (alias for sine.inOut)
 *   springFirm   — 1 visible oscillation, fast settle
 *   springLoose  — 2-3 visible oscillations, playful
 *
 * Call registerMotorsportEasings() once after GSAP is loaded.
 * Both the builder and overlay import this module.
 */

// ─── Cubic Bezier Solver ─────────────────────────────────────────────────────

/**
 * Build an easing function from cubic-bezier control points (same as CSS).
 * Uses binary search to invert X(t) → t, then evaluates Y(t).
 *
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {function(number): number} progress (0-1) → value (0-1)
 */
function cubicBezier(x1, y1, x2, y2) {
  // Pre-sample for fast lookup
  const SAMPLE_COUNT = 256;
  const samples = new Float32Array(SAMPLE_COUNT + 1);

  for (let i = 0; i <= SAMPLE_COUNT; i++) {
    const t = i / SAMPLE_COUNT;
    samples[i] = _bezier(t, x1, x2);
  }

  return function (progress) {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;

    // Find approximate t via sample table
    let lo = 0;
    let hi = SAMPLE_COUNT;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (samples[mid] < progress) lo = mid + 1;
      else hi = mid;
    }

    // Refine with a few Newton-Raphson iterations
    let t = (lo > 0 ? lo - 1 : 0) / SAMPLE_COUNT;
    for (let i = 0; i < 8; i++) {
      const x = _bezier(t, x1, x2) - progress;
      const dx = _bezierDeriv(t, x1, x2);
      if (Math.abs(dx) < 1e-8) break;
      t -= x / dx;
      t = Math.max(0, Math.min(1, t));
    }

    return _bezier(t, y1, y2);
  };
}

/** Evaluate cubic bezier at parameter t for one axis. */
function _bezier(t, p1, p2) {
  const it = 1 - t;
  return 3 * it * it * t * p1 + 3 * it * t * t * p2 + t * t * t;
}

/** First derivative of cubic bezier at parameter t for one axis. */
function _bezierDeriv(t, p1, p2) {
  const it = 1 - t;
  return 3 * it * it * p1 + 6 * it * t * (p2 - p1) + 3 * t * t * (1 - p2);
}

// ─── Spring Physics ──────────────────────────────────────────────────────────

/**
 * Build a damped harmonic oscillator easing function.
 *
 * @param {number} stiffness  — Spring constant (higher = faster)
 * @param {number} damping    — Damping ratio (< 1 = underdamped = oscillation)
 * @param {number} mass       — Mass (usually 1)
 * @returns {function(number): number}
 */
function springEase(stiffness, damping, mass) {
  const omega = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));

  // Pre-compute the underdamped oscillation frequency
  const omegaD = omega * Math.sqrt(1 - zeta * zeta);

  return function (progress) {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;

    // Scale time so the spring settles around progress=1
    const t = progress * (Math.PI * 2 / omegaD) * (zeta < 0.5 ? 0.8 : 1.2);

    return 1 - Math.exp(-zeta * omega * t) *
      (Math.cos(omegaD * t) + (zeta * omega / omegaD) * Math.sin(omegaD * t));
  };
}

// ─── Easing Definitions ──────────────────────────────────────────────────────

const MOTORSPORT_EASINGS = {
  // Hard deceleration — items slam into place (tower position changes)
  towerSnap: cubicBezier(0.22, 1.0, 0.36, 1.0),

  // Slight overshoot then settle (tower ingress with bounce)
  towerSettle: cubicBezier(0.22, 1.2, 0.36, 1.0),

  // Instant acceleration, linear to end (data value punches in)
  dataPunch: cubicBezier(0.12, 0.0, 0.39, 0.0),

  // Sharp start for mask/clip-path reveals (wipe-on bars, straps)
  wipeDrive: cubicBezier(0.77, 0.0, 0.175, 1.0),

  // Slow start, fast exit (elements accelerating off screen)
  exitAccel: cubicBezier(0.55, 0.085, 0.68, 0.53),

  // Festive overshoot — celebrations, milestones
  celebBounce: cubicBezier(0.175, 0.885, 0.32, 1.55),

  // 1 visible oscillation, fast settle (firm spring for data emphasis)
  springFirm: springEase(300, 15, 1),

  // 2-3 visible oscillations, playful (loose spring for celebrations)
  springLoose: springEase(180, 8, 1),
};

// Aliases that map to built-in GSAP easings (no registration needed)
const BUILTIN_ALIASES = {
  telemetryLin: 'none',
  breatheSine: 'sine.inOut',
};

// ─── Registration ────────────────────────────────────────────────────────────

let _registered = false;

/**
 * Register all motorsport easings with GSAP.
 * Safe to call multiple times — only registers once.
 */
export function registerMotorsportEasings() {
  if (_registered) return;
  if (typeof gsap === 'undefined') {
    console.warn('[motorsport-easings] GSAP not loaded — skipping registration');
    return;
  }

  for (const [name, fn] of Object.entries(MOTORSPORT_EASINGS)) {
    gsap.registerEase(name, fn);
  }

  _registered = true;
  console.log('[motorsport-easings] Registered custom easings:', Object.keys(MOTORSPORT_EASINGS).join(', '));
}

/**
 * Resolve an easing name — handles both custom motorsport easings and
 * built-in GSAP aliases.
 *
 * @param {string} name
 * @returns {string} GSAP easing string
 */
export function resolveEasing(name) {
  if (!name) return 'power2.out';
  if (BUILTIN_ALIASES[name]) return BUILTIN_ALIASES[name];
  return name;
}

/**
 * List of all motorsport easing names for UI dropdowns.
 */
export const MOTORSPORT_EASING_NAMES = [
  ...Object.keys(MOTORSPORT_EASINGS),
  ...Object.keys(BUILTIN_ALIASES),
];
