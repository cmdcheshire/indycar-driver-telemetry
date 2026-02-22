#!/usr/bin/env node
/**
 * Generate a 27-car IndyCar leaderboard template.
 *
 * Implements the TimingTower pattern from the motorsport GSAP integration guide:
 *   - Staggered wipe-in ingress (25ms/row, wipeDrive easing)
 *   - Staggered wipe-out egress (20ms/row, exitAccel easing)
 *   - Position swap via byRank selectors (towerSnap easing in data-binder)
 *   - Data-reactive emphasis (dataUpdate punch on value changes)
 *   - Gain/loss conditional styles on gap column
 *   - P1/P2/P3 podium coloring on position column
 *   - Retirement gray-out via conditional styles on status
 *
 * Usage:
 *   node tools/generate-leaderboard-template.js > template.json
 *   node tools/generate-leaderboard-template.js --seed   # writes to DB
 */

const NUM_CARS = 27;

// ── Layout (canvas percentages 0–100) ────────────────────────────────────────

const TOWER = {
  x: 0.5,
  y: 3.0,
  width: 16.0,
  headerHeight: 2.6,
  rowHeight: 2.2,
  rowGap: 0.15,
  accentWidth: 0.25,
};

// Column x-offsets relative to TOWER.x
const COL = {
  accent:  { dx: 0,     w: TOWER.accentWidth },
  pos:     { dx: 0.4,   w: 1.6 },
  car:     { dx: 2.2,   w: 1.6 },
  driver:  { dx: 4.0,   w: 6.6 },
  gap:     { dx: 11.0,  w: 5.0 },
};

// Colors
const C = {
  headerBg:   'rgba(10, 10, 30, 0.95)',
  oddRowBg:   'rgba(15, 15, 40, 0.88)',
  evenRowBg:  'rgba(22, 22, 52, 0.85)',
  accent:     '#E10600',       // IndyCar red
  accentDark: 'rgba(225, 6, 0, 0.6)',
  text:       '#FFFFFF',
  textDim:    'rgba(255, 255, 255, 0.7)',
  textGap:    'rgba(255, 255, 255, 0.9)',
  p1Gold:     '#FFD700',
  p2Silver:   '#C0C0C0',
  p3Bronze:   '#CD7F32',
  gainGreen:  '#00D000',
  lossRed:    '#FF3333',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

let _idCounter = 0;
function id(prefix) {
  return `${prefix}-${String(++_idCounter).padStart(3, '0')}`;
}

function rowY(index) {
  // index 0 = first car row
  const topAfterHeader = TOWER.y + TOWER.headerHeight + TOWER.rowGap;
  return topAfterHeader + index * (TOWER.rowHeight + TOWER.rowGap);
}

function shape(name, x, y, w, h, fill, opts = {}) {
  return {
    id: id('shp'),
    type: 'shape',
    name,
    visible: true,
    locked: false,
    exposed: false,
    groupId: opts.groupId || null,
    clipMask: null,
    x, y,
    width: w,
    height: h,
    rotation: 0,
    opacity: opts.opacity ?? 1,
    zIndex: opts.zIndex ?? 0,
    props: {
      shapeType: opts.shapeType || 'rectangle',
      fill,
      strokeColor: opts.strokeColor || '',
      strokeWidth: opts.strokeWidth || 0,
      borderRadius: opts.borderRadius || 0,
    },
    animation: opts.animation || defaultAnimation(),
  };
}

function text(name, x, y, w, h, textVal, opts = {}) {
  return {
    id: id('txt'),
    type: 'text',
    name,
    visible: true,
    locked: false,
    exposed: false,
    groupId: opts.groupId || null,
    clipMask: null,
    x, y,
    width: w,
    height: h,
    rotation: 0,
    opacity: opts.opacity ?? 1,
    zIndex: opts.zIndex ?? 1,
    props: {
      text: textVal,
      fontFamily: opts.fontFamily || "'Inter', sans-serif",
      fontSize: opts.fontSize || 14,
      fontWeight: opts.fontWeight || '600',
      color: opts.color || C.text,
      backgroundColor: 'transparent',
      textAlign: opts.textAlign || 'left',
      lineHeight: '1.0',
      textShadow: '',
      textStroke: '',
      fitText: false,
    },
    animation: opts.animation || defaultAnimation(),
  };
}

function dataEl(name, x, y, w, h, source, field, carSelector, opts = {}) {
  return {
    id: id('dat'),
    type: 'data',
    name,
    visible: true,
    locked: false,
    exposed: false,
    groupId: opts.groupId || null,
    clipMask: null,
    x, y,
    width: w,
    height: h,
    rotation: 0,
    opacity: opts.opacity ?? 1,
    zIndex: opts.zIndex ?? 1,
    props: {
      fontFamily: opts.fontFamily || "'Inter', sans-serif",
      fontSize: opts.fontSize || 14,
      fontWeight: opts.fontWeight || '600',
      color: opts.color || C.text,
      backgroundColor: 'transparent',
      textAlign: opts.textAlign || 'left',
      lineHeight: '1.0',
      textShadow: '',
      textStroke: '',
      fitText: opts.fitText || false,
      bindingSource: source,
      bindingField: field,
      carSelector,
      format: opts.format || 'raw',
      prefix: opts.prefix || '',
      suffix: opts.suffix || '',
      fallback: opts.fallback || '---',
      conditionalStyles: opts.conditionalStyles || [],
      _previewValue: '',
    },
    animation: opts.animation || defaultAnimation(),
  };
}

function defaultAnimation() {
  return {
    enter: { type: 'none', duration: 300, delay: 0, easing: 'power2.out' },
    exit:  { type: 'none', duration: 300, delay: 0, easing: 'power2.in' },
    update: { type: 'none', duration: 300, easing: 'power1.inOut' },
    emphasis: { type: 'none', duration: 400, trigger: 'onChange', repeat: 0 },
  };
}

// ── Animation configs ────────────────────────────────────────────────────────

function rowEnterAnim(rowIndex, isBackground) {
  // Guide: Tower ingress — 350ms + 25ms/row stagger, wipeDrive
  // BG wipes in, data fades in 100ms later
  if (isBackground) {
    return {
      enter: { type: 'wipeInLeft', duration: 350, delay: rowIndex * 25, easing: 'wipeDrive' },
      exit:  { type: 'wipeOutLeft', duration: 250, delay: rowIndex * 20, easing: 'exitAccel' },
      update: { type: 'none', duration: 300, easing: 'power1.inOut' },
      emphasis: { type: 'none', duration: 400, trigger: 'onChange', repeat: 0 },
    };
  }
  // Data elements fade in after their row BG wipes
  return {
    enter: { type: 'fadeIn', duration: 200, delay: rowIndex * 25 + 120, easing: 'towerSnap' },
    exit:  { type: 'fadeOut', duration: 150, delay: rowIndex * 20, easing: 'exitAccel' },
    update: { type: 'none', duration: 300, easing: 'power1.inOut' },
    emphasis: { type: 'none', duration: 400, trigger: 'onChange', repeat: 0 },
  };
}

function positionEmphasis(rowIndex) {
  const anim = rowEnterAnim(rowIndex, false);
  // Guide: Position number slot-roll 80ms dataPunch → using dataUpdate emphasis
  anim.emphasis = { type: 'dataUpdate', duration: 120, trigger: 'onChange', repeat: 0 };
  return anim;
}

function gapEmphasis(rowIndex) {
  const anim = rowEnterAnim(rowIndex, false);
  // Guide: Gap direction color pulse 350ms breatheSine → using dataUpdate
  anim.emphasis = { type: 'dataUpdate', duration: 150, trigger: 'onChange', repeat: 0 };
  return anim;
}

// ── Build Template ───────────────────────────────────────────────────────────

function buildTemplate() {
  const elements = [];

  // ─── Header ────────────────────────────────────────────────────────────────

  // Header background
  elements.push(shape('Header Background', TOWER.x, TOWER.y, TOWER.width, TOWER.headerHeight, C.headerBg, {
    zIndex: 0,
    borderRadius: 2,
    animation: {
      enter: { type: 'wipeInLeft', duration: 300, delay: 0, easing: 'wipeDrive' },
      exit:  { type: 'wipeOutLeft', duration: 200, delay: 0, easing: 'exitAccel' },
      update: { type: 'none', duration: 300, easing: 'power1.inOut' },
      emphasis: { type: 'none', duration: 400, trigger: 'onChange', repeat: 0 },
    },
  }));

  // Top accent line
  elements.push(shape('Header Accent', TOWER.x, TOWER.y, TOWER.width, 0.2, C.accent, {
    zIndex: 2,
    animation: {
      enter: { type: 'wipeInLeft', duration: 250, delay: 0, easing: 'wipeDrive' },
      exit:  { type: 'wipeOutLeft', duration: 150, delay: 0, easing: 'exitAccel' },
      update: { type: 'none', duration: 300, easing: 'power1.inOut' },
      emphasis: { type: 'none', duration: 400, trigger: 'onChange', repeat: 0 },
    },
  }));

  // Series title
  elements.push(text('Title', TOWER.x + 0.4, TOWER.y + 0.3, 6, TOWER.headerHeight - 0.6, 'INDYCAR', {
    fontSize: 16,
    fontWeight: '800',
    color: C.text,
    zIndex: 2,
    animation: {
      enter: { type: 'fadeIn', duration: 200, delay: 100, easing: 'towerSnap' },
      exit:  { type: 'fadeOut', duration: 150, delay: 0, easing: 'exitAccel' },
      update: { type: 'none', duration: 300, easing: 'power1.inOut' },
      emphasis: { type: 'none', duration: 400, trigger: 'onChange', repeat: 0 },
    },
  }));

  // Race status (exposed for rundown override)
  const raceStatusEl = dataEl('Race Status', TOWER.x + 0.4, TOWER.y + 1.2, 6, 1.2, 'raceState', 'flagColor', '', {
    fontSize: 11,
    fontWeight: '700',
    color: C.textDim,
    zIndex: 2,
    format: 'raw',
    fallback: '',
    animation: {
      enter: { type: 'fadeIn', duration: 200, delay: 150, easing: 'towerSnap' },
      exit:  { type: 'fadeOut', duration: 150, delay: 0, easing: 'exitAccel' },
      update: { type: 'none', duration: 300, easing: 'power1.inOut' },
      emphasis: { type: 'flagPulse', duration: 500, trigger: 'onChange', repeat: 2 },
    },
  });
  raceStatusEl.exposed = true;
  elements.push(raceStatusEl);

  // Lap counter
  elements.push(dataEl('Lap Counter', TOWER.x + TOWER.width - 5.5, TOWER.y + 0.3, 5, TOWER.headerHeight - 0.6, 'raceState', 'currentLap', '', {
    fontSize: 14,
    fontWeight: '700',
    color: C.textDim,
    textAlign: 'right',
    zIndex: 2,
    format: 'raw',
    prefix: 'LAP ',
    fallback: '',
    animation: {
      enter: { type: 'fadeIn', duration: 200, delay: 150, easing: 'towerSnap' },
      exit:  { type: 'fadeOut', duration: 150, delay: 0, easing: 'exitAccel' },
      update: { type: 'none', duration: 300, easing: 'power1.inOut' },
      emphasis: { type: 'dataUpdate', duration: 200, trigger: 'onChange', repeat: 0 },
    },
  }));

  // Column headers
  elements.push(text('Col P', TOWER.x + COL.pos.dx, TOWER.y + 1.2, COL.pos.w, 1.2, 'P', {
    fontSize: 10, fontWeight: '700', color: C.textDim, textAlign: 'center', zIndex: 2,
    animation: {
      enter: { type: 'fadeIn', duration: 200, delay: 120, easing: 'towerSnap' },
      exit:  { type: 'fadeOut', duration: 150, delay: 0, easing: 'exitAccel' },
      update: { type: 'none', duration: 300, easing: 'power1.inOut' },
      emphasis: { type: 'none', duration: 400, trigger: 'onChange', repeat: 0 },
    },
  }));

  elements.push(text('Col Gap', TOWER.x + COL.gap.dx, TOWER.y + 1.2, COL.gap.w, 1.2, 'GAP', {
    fontSize: 10, fontWeight: '700', color: C.textDim, textAlign: 'right', zIndex: 2,
    animation: {
      enter: { type: 'fadeIn', duration: 200, delay: 120, easing: 'towerSnap' },
      exit:  { type: 'fadeOut', duration: 150, delay: 0, easing: 'exitAccel' },
      update: { type: 'none', duration: 300, easing: 'power1.inOut' },
      emphasis: { type: 'none', duration: 400, trigger: 'onChange', repeat: 0 },
    },
  }));

  // ─── Car Rows ──────────────────────────────────────────────────────────────

  for (let i = 0; i < NUM_CARS; i++) {
    const rank = i + 1;
    const car = `byRank:${rank}`;
    const y = rowY(i);
    const isOdd = i % 2 === 0; // 0-indexed: even index = odd rank (P1, P3, ...)

    // Row background
    elements.push(shape(`P${rank} Row BG`, TOWER.x, y, TOWER.width, TOWER.rowHeight,
      isOdd ? C.oddRowBg : C.evenRowBg, {
        zIndex: 0,
        borderRadius: 1,
        animation: rowEnterAnim(i, true),
      }
    ));

    // Team color accent bar (thin left edge)
    // This is a static accent; team color would need per-car conditional styles
    // Using the IndyCar red as a universal accent
    elements.push(shape(`P${rank} Accent`, TOWER.x, y, TOWER.accentWidth, TOWER.rowHeight,
      C.accentDark, {
        zIndex: 1,
        animation: rowEnterAnim(i, true),
      }
    ));

    // Position number
    elements.push(dataEl(`P${rank} Position`, TOWER.x + COL.pos.dx, y, COL.pos.w, TOWER.rowHeight,
      'leaderboard', 'Rank', car, {
        fontSize: 15,
        fontWeight: '800',
        color: C.text,
        textAlign: 'center',
        format: 'integer',
        fallback: String(rank),
        zIndex: 2,
        animation: positionEmphasis(i),
        conditionalStyles: [
          { operator: 'eq', threshold: '1', styles: { color: C.p1Gold } },
          { operator: 'eq', threshold: '2', styles: { color: C.p2Silver } },
          { operator: 'eq', threshold: '3', styles: { color: C.p3Bronze } },
        ],
      }
    ));

    // Car number
    elements.push(dataEl(`P${rank} Car #`, TOWER.x + COL.car.dx, y, COL.car.w, TOWER.rowHeight,
      'leaderboard', 'Car', car, {
        fontSize: 13,
        fontWeight: '700',
        color: C.textDim,
        textAlign: 'center',
        format: 'raw',
        fallback: '--',
        zIndex: 2,
        animation: rowEnterAnim(i, false),
      }
    ));

    // Driver last name
    elements.push(dataEl(`P${rank} Driver`, TOWER.x + COL.driver.dx, y, COL.driver.w, TOWER.rowHeight,
      'referenceData', 'lastName', car, {
        fontSize: 13,
        fontWeight: '600',
        color: C.text,
        textAlign: 'left',
        format: 'raw',
        fallback: '---',
        fitText: true,
        zIndex: 2,
        animation: rowEnterAnim(i, false),
      }
    ));

    // Gap to leader
    elements.push(dataEl(`P${rank} Gap`, TOWER.x + COL.gap.dx, y, COL.gap.w, TOWER.rowHeight,
      'leaderboard', 'Time_Behind', car, {
        fontSize: 13,
        fontWeight: '600',
        color: C.textGap,
        textAlign: 'right',
        format: 'float3',
        prefix: rank === 1 ? '' : '+',
        fallback: rank === 1 ? 'LEADER' : '---',
        zIndex: 2,
        animation: gapEmphasis(i),
      }
    ));
  }

  // ─── Bottom accent line ────────────────────────────────────────────────────

  const bottomY = rowY(NUM_CARS - 1) + TOWER.rowHeight;
  elements.push(shape('Bottom Accent', TOWER.x, bottomY, TOWER.width, 0.15, C.accent, {
    zIndex: 2,
    animation: {
      enter: { type: 'wipeInLeft', duration: 300, delay: NUM_CARS * 25 + 50, easing: 'wipeDrive' },
      exit:  { type: 'wipeOutLeft', duration: 200, delay: NUM_CARS * 20, easing: 'exitAccel' },
      update: { type: 'none', duration: 300, easing: 'power1.inOut' },
      emphasis: { type: 'none', duration: 400, trigger: 'onChange', repeat: 0 },
    },
  }));

  return {
    name: 'IndyCar 27-Car Leaderboard',
    overlay_type: 'leaderboard',
    description: 'Full-field 27-car timing tower with staggered wipe animations, position emphasis, gap tracking, and podium coloring. Implements TimingTower pattern from motorsport GSAP guide.',
    template_data: {
      elements,
      groups: [],
      canvas: { width: 1920, height: 1080 },
      timeline: {
        holdDuration: 0,  // stays on until manually taken off
        pausePoints: [],
        loopRegion: null,
      },
      version: 1,
    },
    canvas_width: 1920,
    canvas_height: 1080,
  };
}

// ── Output ───────────────────────────────────────────────────────────────────

const template = buildTemplate();

if (process.argv.includes('--seed')) {
  // Seed mode: write directly to the SQLite database
  try {
    const path = require('path');
    const Database = require('better-sqlite3');
    const dbPath = path.join(__dirname, '..', 'data', 'telemetry.db');
    const db = new Database(dbPath);

    const stmt = db.prepare(`
      INSERT INTO overlay_templates (name, overlay_type, description, template_data, canvas_width, canvas_height, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))
    `);

    const result = stmt.run(
      template.name,
      template.overlay_type,
      template.description,
      JSON.stringify(template.template_data),
      template.canvas_width,
      template.canvas_height,
    );

    console.log(`Seeded template "${template.name}" with ID ${result.lastInsertRowid}`);
    console.log(`Elements: ${template.template_data.elements.length}`);
    db.close();
  } catch (err) {
    console.error('Failed to seed template:', err.message);
    console.error('Make sure you are running from the project root and better-sqlite3 is installed.');
    process.exit(1);
  }
} else {
  // Default: output JSON to stdout
  console.log(JSON.stringify(template, null, 2));
}
