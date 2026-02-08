/**
 * Shared animation presets registry.
 * Used by both the builder (design-time) and overlay (runtime).
 *
 * Each preset defines GSAP `vars` objects for gsap.from() (enter) or gsap.to() (exit).
 */

// ─── Enter Presets ───────────────────────────────────────────────────────────

const ENTER_PRESETS = {
  // Fade
  fadeIn:        { vars: { opacity: 0 } },
  fadeInUp:      { vars: { opacity: 0, y: 40 } },
  fadeInDown:    { vars: { opacity: 0, y: -40 } },
  fadeInLeft:    { vars: { opacity: 0, x: -60 } },
  fadeInRight:   { vars: { opacity: 0, x: 60 } },

  // Slide
  slideInLeft:   { vars: { x: '-105%', opacity: 0 } },
  slideInRight:  { vars: { x: '105%', opacity: 0 } },
  slideInUp:     { vars: { y: '105%', opacity: 0 } },
  slideInDown:   { vars: { y: '-105%', opacity: 0 } },

  // Scale
  scaleIn:       { vars: { scale: 0, opacity: 0 } },
  scaleInX:      { vars: { scaleX: 0, opacity: 0, transformOrigin: 'left center' } },
  scaleInY:      { vars: { scaleY: 0, opacity: 0, transformOrigin: 'center top' } },

  // Reveal (clip-path)
  clipRevealLeft:  { vars: { clipPath: 'inset(0 100% 0 0)' }, clearProps: 'clipPath' },
  clipRevealRight: { vars: { clipPath: 'inset(0 0 0 100%)' }, clearProps: 'clipPath' },
  clipRevealUp:    { vars: { clipPath: 'inset(100% 0 0 0)' }, clearProps: 'clipPath' },
  clipRevealDown:  { vars: { clipPath: 'inset(0 0 100% 0)' }, clearProps: 'clipPath' },

  // Special
  flipInX:       { vars: { rotateX: -90, opacity: 0, transformPerspective: 600 } },
  flipInY:       { vars: { rotateY: -90, opacity: 0, transformPerspective: 600 } },
};

// ─── Exit Presets ────────────────────────────────────────────────────────────

const EXIT_PRESETS = {
  // Fade
  fadeOut:        { vars: { opacity: 0 } },
  fadeOutUp:      { vars: { opacity: 0, y: -40 } },
  fadeOutDown:    { vars: { opacity: 0, y: 40 } },
  fadeOutLeft:    { vars: { opacity: 0, x: -60 } },
  fadeOutRight:   { vars: { opacity: 0, x: 60 } },

  // Slide
  slideOutLeft:   { vars: { x: '-105%', opacity: 0 } },
  slideOutRight:  { vars: { x: '105%', opacity: 0 } },
  slideOutUp:     { vars: { y: '-105%', opacity: 0 } },
  slideOutDown:   { vars: { y: '105%', opacity: 0 } },

  // Scale
  scaleOut:       { vars: { scale: 0, opacity: 0 } },
  scaleOutX:      { vars: { scaleX: 0, opacity: 0, transformOrigin: 'right center' } },
  scaleOutY:      { vars: { scaleY: 0, opacity: 0, transformOrigin: 'center bottom' } },

  // Reveal (clip-path)
  clipHideLeft:   { vars: { clipPath: 'inset(0 100% 0 0)' } },
  clipHideRight:  { vars: { clipPath: 'inset(0 0 0 100%)' } },
  clipHideUp:     { vars: { clipPath: 'inset(100% 0 0 0)' } },
  clipHideDown:   { vars: { clipPath: 'inset(0 0 100% 0)' } },

  // Special
  flipOutX:      { vars: { rotateX: 90, opacity: 0, transformPerspective: 600 } },
  flipOutY:      { vars: { rotateY: 90, opacity: 0, transformPerspective: 600 } },
};

// ─── Emphasis Presets ────────────────────────────────────────────────────────

const EMPHASIS_PRESETS = {
  pulse: {
    keyframes: [
      { scale: 1.15, duration: 0.15 },
      { scale: 1, duration: 0.15 },
    ],
  },
  shake: {
    keyframes: [
      { x: -6, duration: 0.08 },
      { x: 6, duration: 0.08 },
      { x: -4, duration: 0.08 },
      { x: 4, duration: 0.08 },
      { x: 0, duration: 0.08 },
    ],
  },
  flash: {
    keyframes: [
      { opacity: 0, duration: 0.1 },
      { opacity: 1, duration: 0.1 },
      { opacity: 0, duration: 0.1 },
      { opacity: 1, duration: 0.1 },
    ],
  },
  bounce: {
    keyframes: [
      { y: -12, duration: 0.15, ease: 'power2.out' },
      { y: 0, duration: 0.15, ease: 'bounce.out' },
      { y: -4, duration: 0.1, ease: 'power2.out' },
      { y: 0, duration: 0.1, ease: 'bounce.out' },
    ],
  },
  glow: {
    keyframes: [
      { textShadow: '0 0 10px currentColor, 0 0 20px currentColor', duration: 0.2 },
      { textShadow: 'none', duration: 0.3 },
    ],
  },
  colorShift: {
    keyframes: [
      { color: '#FFD700', duration: 0.15 },
      { color: 'inherit', duration: 0.3 },
    ],
  },
  rubberBand: {
    keyframes: [
      { scaleX: 1.25, scaleY: 0.75, duration: 0.1 },
      { scaleX: 0.75, scaleY: 1.25, duration: 0.1 },
      { scaleX: 1.1, scaleY: 0.9, duration: 0.1 },
      { scaleX: 1, scaleY: 1, duration: 0.1 },
    ],
  },
};

// ─── Categorized Lists (for UI dropdowns) ────────────────────────────────────

export const ENTER_ANIMATION_CATEGORIES = [
  {
    name: 'Fade',
    presets: [
      { value: 'fadeIn', label: 'Fade In' },
      { value: 'fadeInUp', label: 'Fade In Up' },
      { value: 'fadeInDown', label: 'Fade In Down' },
      { value: 'fadeInLeft', label: 'Fade In Left' },
      { value: 'fadeInRight', label: 'Fade In Right' },
    ],
  },
  {
    name: 'Slide',
    presets: [
      { value: 'slideInLeft', label: 'Slide In Left' },
      { value: 'slideInRight', label: 'Slide In Right' },
      { value: 'slideInUp', label: 'Slide In Up' },
      { value: 'slideInDown', label: 'Slide In Down' },
    ],
  },
  {
    name: 'Scale',
    presets: [
      { value: 'scaleIn', label: 'Scale In' },
      { value: 'scaleInX', label: 'Scale In X' },
      { value: 'scaleInY', label: 'Scale In Y' },
    ],
  },
  {
    name: 'Reveal',
    presets: [
      { value: 'clipRevealLeft', label: 'Reveal Left' },
      { value: 'clipRevealRight', label: 'Reveal Right' },
      { value: 'clipRevealUp', label: 'Reveal Up' },
      { value: 'clipRevealDown', label: 'Reveal Down' },
    ],
  },
  {
    name: 'Special',
    presets: [
      { value: 'flipInX', label: 'Flip In X' },
      { value: 'flipInY', label: 'Flip In Y' },
    ],
  },
];

export const EXIT_ANIMATION_CATEGORIES = [
  {
    name: 'Fade',
    presets: [
      { value: 'fadeOut', label: 'Fade Out' },
      { value: 'fadeOutUp', label: 'Fade Out Up' },
      { value: 'fadeOutDown', label: 'Fade Out Down' },
      { value: 'fadeOutLeft', label: 'Fade Out Left' },
      { value: 'fadeOutRight', label: 'Fade Out Right' },
    ],
  },
  {
    name: 'Slide',
    presets: [
      { value: 'slideOutLeft', label: 'Slide Out Left' },
      { value: 'slideOutRight', label: 'Slide Out Right' },
      { value: 'slideOutUp', label: 'Slide Out Up' },
      { value: 'slideOutDown', label: 'Slide Out Down' },
    ],
  },
  {
    name: 'Scale',
    presets: [
      { value: 'scaleOut', label: 'Scale Out' },
      { value: 'scaleOutX', label: 'Scale Out X' },
      { value: 'scaleOutY', label: 'Scale Out Y' },
    ],
  },
  {
    name: 'Reveal',
    presets: [
      { value: 'clipHideLeft', label: 'Hide Left' },
      { value: 'clipHideRight', label: 'Hide Right' },
      { value: 'clipHideUp', label: 'Hide Up' },
      { value: 'clipHideDown', label: 'Hide Down' },
    ],
  },
  {
    name: 'Special',
    presets: [
      { value: 'flipOutX', label: 'Flip Out X' },
      { value: 'flipOutY', label: 'Flip Out Y' },
    ],
  },
];

export const EMPHASIS_ANIMATIONS = [
  { value: 'none', label: 'None' },
  { value: 'pulse', label: 'Pulse' },
  { value: 'shake', label: 'Shake' },
  { value: 'flash', label: 'Flash' },
  { value: 'bounce', label: 'Bounce' },
  { value: 'glow', label: 'Glow' },
  { value: 'colorShift', label: 'Color Shift' },
  { value: 'rubberBand', label: 'Rubber Band' },
];

// ─── GSAP Easings ────────────────────────────────────────────────────────────

export const GSAP_EASINGS = [
  { value: 'none', label: 'Linear', group: 'Basic' },
  { value: 'power1.in', label: 'Power1 In', group: 'Power' },
  { value: 'power1.out', label: 'Power1 Out', group: 'Power' },
  { value: 'power1.inOut', label: 'Power1 InOut', group: 'Power' },
  { value: 'power2.in', label: 'Power2 In', group: 'Power' },
  { value: 'power2.out', label: 'Power2 Out', group: 'Power' },
  { value: 'power2.inOut', label: 'Power2 InOut', group: 'Power' },
  { value: 'power3.in', label: 'Power3 In', group: 'Power' },
  { value: 'power3.out', label: 'Power3 Out', group: 'Power' },
  { value: 'power3.inOut', label: 'Power3 InOut', group: 'Power' },
  { value: 'power4.in', label: 'Power4 In', group: 'Power' },
  { value: 'power4.out', label: 'Power4 Out', group: 'Power' },
  { value: 'power4.inOut', label: 'Power4 InOut', group: 'Power' },
  { value: 'back.in(1.7)', label: 'Back In', group: 'Special' },
  { value: 'back.out(1.7)', label: 'Back Out', group: 'Special' },
  { value: 'back.inOut(1.7)', label: 'Back InOut', group: 'Special' },
  { value: 'elastic.out(1,0.3)', label: 'Elastic Out', group: 'Special' },
  { value: 'bounce.out', label: 'Bounce Out', group: 'Special' },
  { value: 'circ.in', label: 'Circ In', group: 'Circ / Expo' },
  { value: 'circ.out', label: 'Circ Out', group: 'Circ / Expo' },
  { value: 'expo.in', label: 'Expo In', group: 'Circ / Expo' },
  { value: 'expo.out', label: 'Expo Out', group: 'Circ / Expo' },
  { value: 'expo.inOut', label: 'Expo InOut', group: 'Circ / Expo' },
];

// ─── CSS → GSAP Easing Migration Map ─────────────────────────────────────────

export const CSS_EASING_MAP = {
  'ease':        'power1.inOut',
  'ease-in':     'power2.in',
  'ease-out':    'power2.out',
  'ease-in-out': 'power2.inOut',
  'linear':      'none',
};

/**
 * Migrate a CSS easing value to its GSAP equivalent.
 * Returns GSAP easing strings unchanged.
 */
export function migrateEasing(easing) {
  if (!easing) return 'power2.out';
  return CSS_EASING_MAP[easing] || easing;
}

// ─── Runtime Lookup API ──────────────────────────────────────────────────────

/**
 * Get the GSAP vars for an enter animation preset.
 * @param {string} name - Preset name (e.g. 'fadeIn', 'slideInLeft')
 * @returns {{ vars: object, clearProps?: string }|null}
 */
export function getEnterPreset(name) {
  return ENTER_PRESETS[name] || null;
}

/**
 * Get the GSAP vars for an exit animation preset.
 * @param {string} name - Preset name (e.g. 'fadeOut', 'slideOutLeft')
 * @returns {{ vars: object }|null}
 */
export function getExitPreset(name) {
  return EXIT_PRESETS[name] || null;
}

/**
 * Get the GSAP keyframes for an emphasis animation preset.
 * @param {string} name - Preset name (e.g. 'pulse', 'shake')
 * @returns {{ keyframes: object[] }|null}
 */
export function getEmphasisPreset(name) {
  return EMPHASIS_PRESETS[name] || null;
}
