const authService = require('../services/auth.service');
const overlayService = require('../services/overlay.service');
const referenceService = require('../services/reference-data.service');
const constants = require('../config/constants');

/**
 * First-run initialization: creates default admin user and example templates if none exist.
 */
async function initializeFirstRun() {
  const userCount = authService.getUserCount();

  if (userCount === 0) {
    console.log('First run detected — creating default admin user...');
    await authService.createUser(constants.DEFAULT_USERNAME, constants.DEFAULT_PASSWORD, 'admin');
    console.log(`Default user created: ${constants.DEFAULT_USERNAME} / ${constants.DEFAULT_PASSWORD}`);
    console.log('IMPORTANT: Change the default password after first login!');
  }

  // Seed example templates if none exist
  const templates = overlayService.getAllTemplates();
  if (templates.length === 0) {
    console.log('Seeding example overlay templates...');
    _seedExampleTemplates();
    console.log('3 example templates created.');
  }

  // Seed 2025 IndyCar driver data if no drivers exist
  const drivers = referenceService.getAllDrivers();
  if (drivers.length === 0) {
    console.log('Seeding 2025 IndyCar driver roster...');
    const count = referenceService.bulkImportDrivers(_2025Drivers());
    console.log(`${count} drivers seeded.`);
  }
}

/**
 * Create example overlay templates for new installations.
 * Uses the full animation system: motorsport wipes, snaps, clip reveals,
 * staggered entrances, emphasis on data change, crossfade updates, and timelines.
 */
function _seedExampleTemplates() {

  // ── Template 1: Driver Card — "Pit Lane Pop" ──
  // Punchy layered reveal: background wipes in, position badge snaps,
  // name does a dramatic center-wipe, data fades in staggered with crossfade updates.
  overlayService.createTemplate({
    name: 'Driver Card',
    overlay_type: 'driver_card',
    description: 'Sleek driver info card with layered wipe entrance and live data emphasis.',
    canvas_width: 1920,
    canvas_height: 1080,
    template_data: {
      elements: [
        // Main panel — wipes in from left
        {
          id: 'dc-bg', type: 'shape', name: 'Background',
          x: 2, y: 74, width: 30, height: 20,
          opacity: 1, rotation: 0, groupId: null,
          animation: {
            enter: { type: 'wipeInLeft', duration: 500, delay: 0, easing: 'wipeDrive' },
            exit: { type: 'wipeOutLeft', duration: 400, delay: 0, easing: 'exitAccel' },
          },
          props: {
            shapeType: 'rectangle', fill: 'rgba(8,12,28,0.92)',
            strokeColor: '', strokeWidth: 0, borderRadius: 6,
          },
        },
        // Hot accent line across top edge
        {
          id: 'dc-accent-top', type: 'shape', name: 'Top Accent',
          x: 2, y: 74, width: 30, height: 0.4,
          opacity: 1, rotation: 0, groupId: null,
          animation: {
            enter: { type: 'scaleInX', duration: 350, delay: 150, easing: 'springFirm' },
            exit: { type: 'scaleOutX', duration: 200, delay: 0, easing: 'exitAccel' },
          },
          props: {
            shapeType: 'rectangle', fill: '#3b82f6',
            strokeColor: '', strokeWidth: 0, borderRadius: 0,
          },
        },
        // Position badge background
        {
          id: 'dc-pos-bg', type: 'shape', name: 'Position Badge',
          x: 2, y: 74.5, width: 6, height: 11,
          opacity: 1, rotation: 0, groupId: null,
          animation: {
            enter: { type: 'wipeInLeft', duration: 400, delay: 200, easing: 'wipeDrive' },
            exit: { type: 'wipeOutLeft', duration: 300, delay: 0, easing: 'exitAccel' },
          },
          props: {
            shapeType: 'rectangle', fill: '#3b82f6',
            strokeColor: '', strokeWidth: 0, borderRadius: 0,
          },
        },
        // Position number — big, bold, snaps in from below
        {
          id: 'dc-pos', type: 'data', name: 'Position',
          x: 2.2, y: 75, width: 5.5, height: 10,
          opacity: 1, rotation: 0, groupId: null,
          animation: {
            enter: { type: 'snapInUp', duration: 250, delay: 350, easing: 'towerSnap' },
            exit: { type: 'snapOutDown', duration: 200, delay: 0, easing: 'exitAccel' },
            update: { type: 'crossfade', duration: 300 },
            emphasis: { type: 'celebPop', duration: 400, trigger: 'onChange', repeat: 0 },
          },
          props: {
            bindingSource: 'telemetry', bindingField: 'rank',
            carSelector: 'target1', format: 'ordinal',
            fontFamily: 'Oswald, sans-serif', fontSize: 56, fontWeight: '700',
            color: '#FFFFFF', textAlign: 'center', verticalAlign: 'middle',
            fallback: '--', prefix: '', suffix: '',
          },
        },
        // Car number — snaps in from left
        {
          id: 'dc-car', type: 'data', name: 'Car Number',
          x: 9, y: 75.5, width: 8, height: 4,
          opacity: 1, rotation: 0, groupId: null,
          animation: {
            enter: { type: 'snapInLeft', duration: 200, delay: 400, easing: 'towerSnap' },
            exit: { type: 'snapOutLeft', duration: 200, delay: 0, easing: 'exitAccel' },
          },
          props: {
            bindingSource: 'telemetry', bindingField: 'carNumber',
            carSelector: 'target1', format: 'raw',
            fontFamily: 'Oswald, sans-serif', fontSize: 32, fontWeight: '700',
            color: '#64748b', textAlign: 'left', fallback: '#--',
            prefix: '#', suffix: '',
          },
        },
        // Driver last name — dramatic center wipe (hero text)
        {
          id: 'dc-name', type: 'data', name: 'Driver Name',
          x: 9, y: 79, width: 21, height: 6,
          opacity: 1, rotation: 0, groupId: null,
          animation: {
            enter: { type: 'wipeInCenter', duration: 400, delay: 450, easing: 'wipeDrive' },
            exit: { type: 'wipeOutCenter', duration: 300, delay: 0, easing: 'exitAccel' },
          },
          props: {
            bindingSource: 'referenceData', bindingField: 'lastName',
            carSelector: 'target1', format: 'raw',
            fontFamily: 'Oswald, sans-serif', fontSize: 44, fontWeight: '800',
            color: '#FFFFFF', textAlign: 'left', textTransform: 'uppercase',
            fallback: 'DRIVER', prefix: '', suffix: '',
          },
        },
        // Horizontal divider — draws across
        {
          id: 'dc-divider', type: 'shape', name: 'Divider',
          x: 9, y: 85.5, width: 21, height: 0.15,
          opacity: 1, rotation: 0, groupId: null,
          animation: {
            enter: { type: 'clipRevealLeft', duration: 300, delay: 500, easing: 'power2.out' },
            exit: { type: 'clipHideLeft', duration: 200, delay: 0, easing: 'exitAccel' },
          },
          props: {
            shapeType: 'rectangle', fill: 'rgba(255,255,255,0.15)',
            strokeColor: '', strokeWidth: 0, borderRadius: 0,
          },
        },
        // Speed — fades in from left, crossfade on update, emphasis punch
        {
          id: 'dc-speed', type: 'data', name: 'Speed',
          x: 9, y: 86.5, width: 12, height: 4,
          opacity: 1, rotation: 0, groupId: null,
          animation: {
            enter: { type: 'fadeInLeft', duration: 300, delay: 550, easing: 'power2.out' },
            exit: { type: 'fadeOutLeft', duration: 250, delay: 0, easing: 'exitAccel' },
            update: { type: 'crossfade', duration: 300 },
            emphasis: { type: 'dataUpdate', duration: 200, trigger: 'onChange', repeat: 0 },
          },
          props: {
            bindingSource: 'telemetry', bindingField: 'speed',
            carSelector: 'target1', format: 'speed',
            fontFamily: 'Roboto Mono, monospace', fontSize: 22, fontWeight: '600',
            color: '#10b981', textAlign: 'left', fallback: '--- MPH',
            prefix: '', suffix: ' MPH',
          },
        },
        // Gap to leader — fades in from right, crossfade on update, gain flash
        {
          id: 'dc-gap', type: 'data', name: 'Gap to Leader',
          x: 21, y: 86.5, width: 10, height: 4,
          opacity: 1, rotation: 0, groupId: null,
          animation: {
            enter: { type: 'fadeInRight', duration: 300, delay: 600, easing: 'power2.out' },
            exit: { type: 'fadeOutRight', duration: 250, delay: 0, easing: 'exitAccel' },
            update: { type: 'crossfade', duration: 300 },
            emphasis: { type: 'gainFlash', duration: 300, trigger: 'onChange', repeat: 0 },
          },
          props: {
            bindingSource: 'leaderboard', bindingField: 'Time_Behind',
            carSelector: 'target1', format: 'delta',
            fontFamily: 'Roboto Mono, monospace', fontSize: 22, fontWeight: '500',
            color: '#f59e0b', textAlign: 'right', fallback: '--',
            prefix: '', suffix: '',
          },
        },
      ],
      groups: [],
      timeline: { holdDuration: 5000, pausePoints: [], loop: false },
      version: 1,
    },
  }, null);

  // ── Template 2: Timing Tower — "Tower Cascade" ──
  // Rows cascade in with alternating wipe directions. Header bar scales open.
  // Data elements snap in staggered with motorsport emphasis on updates.
  overlayService.createTemplate({
    name: 'Timing Tower',
    overlay_type: 'leaderboard',
    description: 'Cascading timing tower with alternating wipe reveals and live data emphasis.',
    canvas_width: 1920,
    canvas_height: 1080,
    template_data: {
      elements: [
        // Header bar — scales open from left edge
        {
          id: 'tt-header-bg', type: 'shape', name: 'Header BG',
          x: 1, y: 2, width: 15, height: 4.5,
          opacity: 1, rotation: 0, groupId: null,
          animation: {
            enter: { type: 'scaleInX', duration: 400, delay: 0, easing: 'springFirm' },
            exit: { type: 'scaleOutX', duration: 300, delay: 0, easing: 'exitAccel' },
          },
          props: {
            shapeType: 'rectangle',
            fill: '#1d4ed8',
            gradient: '135deg, #3b82f6 0%, #1d4ed8 100%',
            strokeColor: '', strokeWidth: 0, borderRadius: 4,
          },
        },
        // Header text — fades in after bar opens
        {
          id: 'tt-header', type: 'text', name: 'Header Text',
          x: 1.5, y: 2.2, width: 14, height: 4,
          opacity: 1, rotation: 0, groupId: null,
          animation: {
            enter: { type: 'fadeIn', duration: 300, delay: 250, easing: 'power2.out' },
            exit: { type: 'fadeOut', duration: 200, delay: 0, easing: 'power2.in' },
          },
          props: {
            text: 'RACE STANDINGS',
            fontFamily: 'Oswald, sans-serif', fontSize: 22, fontWeight: '700',
            color: '#FFFFFF', textAlign: 'center', letterSpacing: 3,
            textTransform: 'uppercase',
          },
        },
        ..._timingTowerRows(5),
      ],
      groups: [],
      timeline: { holdDuration: 0, pausePoints: [], loop: true },
      version: 1,
    },
  }, null);

  // ── Template 3: Lower Third — "Broadcast Sweep" ──
  // Cinematic lower third: background sweeps up, accent bar scales in,
  // separator draws across, text reveals staggered, data snaps in from right.
  overlayService.createTemplate({
    name: 'Lower Third',
    overlay_type: 'lbar',
    description: 'Cinematic lower third with sweep entrance, line draws, and data crossfade.',
    canvas_width: 1920,
    canvas_height: 1080,
    template_data: {
      elements: [
        // Main background — sweeps up from bottom
        {
          id: 'lt-bg', type: 'shape', name: 'Bar Background',
          x: 8, y: 80, width: 50, height: 14,
          opacity: 1, rotation: 0, groupId: null,
          animation: {
            enter: { type: 'wipeInUp', duration: 450, delay: 0, easing: 'wipeDrive' },
            exit: { type: 'wipeOutDown', duration: 400, delay: 100, easing: 'exitAccel' },
          },
          props: {
            shapeType: 'rectangle', fill: 'rgba(8,12,28,0.94)',
            strokeColor: '', strokeWidth: 0, borderRadius: 0,
          },
        },
        // Left accent bar — scales in vertically (urgency stripe)
        {
          id: 'lt-accent-left', type: 'shape', name: 'Left Accent',
          x: 8, y: 80, width: 0.4, height: 14,
          opacity: 1, rotation: 0, groupId: null,
          animation: {
            enter: { type: 'scaleInY', duration: 300, delay: 200, easing: 'springFirm' },
            exit: { type: 'scaleOutY', duration: 200, delay: 0, easing: 'exitAccel' },
          },
          props: {
            shapeType: 'rectangle', fill: '#ef4444',
            strokeColor: '', strokeWidth: 0, borderRadius: 0,
          },
        },
        // Bottom accent line — draws across
        {
          id: 'lt-accent-bottom', type: 'shape', name: 'Bottom Line',
          x: 8.5, y: 93.7, width: 49.5, height: 0.18,
          opacity: 1, rotation: 0, groupId: null,
          animation: {
            enter: { type: 'clipRevealLeft', duration: 400, delay: 300, easing: 'power3.out' },
            exit: { type: 'clipHideRight', duration: 300, delay: 0, easing: 'exitAccel' },
          },
          props: {
            shapeType: 'rectangle', fill: '#ef4444',
            strokeColor: '', strokeWidth: 0, borderRadius: 0,
          },
        },
        // Driver name — dramatic center wipe (hero text)
        {
          id: 'lt-name', type: 'data', name: 'Driver Name',
          x: 10, y: 81, width: 28, height: 7,
          opacity: 1, rotation: 0, groupId: null,
          animation: {
            enter: { type: 'wipeInCenter', duration: 400, delay: 350, easing: 'wipeDrive' },
            exit: { type: 'wipeOutCenter', duration: 300, delay: 50, easing: 'exitAccel' },
          },
          props: {
            bindingSource: 'referenceData', bindingField: 'lastName',
            carSelector: 'target1', format: 'raw',
            fontFamily: 'Oswald, sans-serif', fontSize: 48, fontWeight: '800',
            color: '#FFFFFF', textAlign: 'left', textTransform: 'uppercase',
            fallback: 'DRIVER NAME', prefix: '', suffix: '',
          },
        },
        // Team name — floats up softly after name
        {
          id: 'lt-team', type: 'data', name: 'Team Name',
          x: 10, y: 88, width: 28, height: 4,
          opacity: 1, rotation: 0, groupId: null,
          animation: {
            enter: { type: 'fadeInUp', duration: 300, delay: 500, easing: 'power2.out' },
            exit: { type: 'fadeOutDown', duration: 250, delay: 0, easing: 'power2.in' },
          },
          props: {
            bindingSource: 'referenceData', bindingField: 'team',
            carSelector: 'target1', format: 'raw',
            fontFamily: 'Inter, sans-serif', fontSize: 17, fontWeight: '400',
            color: '#94a3b8', textAlign: 'left', fallback: 'Team',
            prefix: '', suffix: '',
          },
        },
        // Vertical separator — draws down between name area and data
        {
          id: 'lt-divider', type: 'shape', name: 'Vertical Divider',
          x: 39, y: 81, width: 0.1, height: 12,
          opacity: 1, rotation: 0, groupId: null,
          animation: {
            enter: { type: 'clipRevealDown', duration: 300, delay: 400, easing: 'power2.out' },
            exit: { type: 'clipHideUp', duration: 200, delay: 0, easing: 'exitAccel' },
          },
          props: {
            shapeType: 'rectangle', fill: 'rgba(255,255,255,0.12)',
            strokeColor: '', strokeWidth: 0, borderRadius: 0,
          },
        },
        // Gap delta — snaps in from right, crossfade update, pulse emphasis
        {
          id: 'lt-gap', type: 'data', name: 'Gap',
          x: 40, y: 81, width: 17, height: 7,
          opacity: 1, rotation: 0, groupId: null,
          animation: {
            enter: { type: 'snapInRight', duration: 250, delay: 500, easing: 'towerSnap' },
            exit: { type: 'snapOutRight', duration: 200, delay: 0, easing: 'exitAccel' },
            update: { type: 'crossfade', duration: 300 },
            emphasis: { type: 'pulse', duration: 300, trigger: 'onChange', repeat: 0 },
          },
          props: {
            bindingSource: 'leaderboard', bindingField: 'Time_Behind',
            carSelector: 'target1', format: 'delta',
            fontFamily: 'Roboto Mono, monospace', fontSize: 40, fontWeight: '700',
            color: '#f59e0b', textAlign: 'center', verticalAlign: 'middle',
            fallback: '--', prefix: '', suffix: '',
          },
        },
        // Position — fades up below gap, crossfade update, dataUpdate emphasis
        {
          id: 'lt-pos', type: 'data', name: 'Position',
          x: 40, y: 88, width: 17, height: 4,
          opacity: 1, rotation: 0, groupId: null,
          animation: {
            enter: { type: 'fadeInUp', duration: 250, delay: 600, easing: 'power2.out' },
            exit: { type: 'fadeOutDown', duration: 200, delay: 0, easing: 'power2.in' },
            update: { type: 'crossfade', duration: 250 },
            emphasis: { type: 'dataUpdate', duration: 200, trigger: 'onChange', repeat: 0 },
          },
          props: {
            bindingSource: 'telemetry', bindingField: 'rank',
            carSelector: 'target1', format: 'ordinal',
            fontFamily: 'Inter, sans-serif', fontSize: 18, fontWeight: '600',
            color: '#3b82f6', textAlign: 'center', fallback: '--',
            prefix: '', suffix: '',
          },
        },
      ],
      groups: [],
      timeline: {
        holdDuration: 6000,
        pausePoints: [{ id: 'pp1', time: 450, label: 'After sweep' }],
        loop: false,
      },
      version: 1,
    },
  }, null);
}

/**
 * Generate timing tower row elements for positions 1..count.
 * Uses alternating wipe directions, staggered snap entrances, and motorsport emphasis.
 */
function _timingTowerRows(count) {
  const rows = [];
  const startY = 7.5;
  const rowH = 4.8;

  for (let i = 0; i < count; i++) {
    const rank = i + 1;
    const y = startY + i * rowH;
    const isEven = i % 2 === 0;
    const rowBg = isEven ? 'rgba(8,12,28,0.88)' : 'rgba(16,20,40,0.88)';
    const stagger = 350 + i * 100;

    // Row background — alternating wipe direction for visual rhythm
    rows.push({
      id: `tt-row${rank}-bg`, type: 'shape', name: `P${rank} BG`,
      x: 1, y, width: 15, height: rowH - 0.6,
      opacity: 1, rotation: 0, groupId: null,
      animation: {
        enter: {
          type: isEven ? 'wipeInLeft' : 'wipeInRight',
          duration: 350,
          delay: stagger,
          easing: 'wipeDrive',
        },
        exit: {
          type: isEven ? 'wipeOutLeft' : 'wipeOutRight',
          duration: 280,
          delay: i * 40,
          easing: 'exitAccel',
        },
      },
      props: {
        shapeType: 'rectangle', fill: rowBg,
        strokeColor: '', strokeWidth: 0, borderRadius: 3,
      },
    });

    // Position number — snaps up, gold shimmer for P1
    rows.push({
      id: `tt-row${rank}-pos`, type: 'data', name: `P${rank} Pos`,
      x: 1.5, y: y + 0.4, width: 3, height: rowH - 1.4,
      opacity: 1, rotation: 0, groupId: null,
      animation: {
        enter: { type: 'snapInUp', duration: 200, delay: stagger + 150, easing: 'towerSnap' },
        exit: { type: 'snapOutDown', duration: 180, delay: 0, easing: 'exitAccel' },
        update: { type: 'crossfade', duration: 250 },
        emphasis: {
          type: rank === 1 ? 'goldShimmer' : 'dataUpdate',
          duration: rank === 1 ? 400 : 200,
          trigger: 'onChange', repeat: 0,
        },
      },
      props: {
        bindingSource: 'telemetry', bindingField: 'rank',
        carSelector: `byRank:${rank}`, format: 'raw',
        fontFamily: 'Oswald, sans-serif', fontSize: 24, fontWeight: '700',
        color: rank === 1 ? '#f59e0b' : '#FFFFFF', textAlign: 'center',
        verticalAlign: 'middle',
        fallback: `${rank}`, prefix: '', suffix: '',
      },
    });

    // Car number — clip reveals in
    rows.push({
      id: `tt-row${rank}-car`, type: 'data', name: `P${rank} Car`,
      x: 5, y: y + 0.4, width: 4, height: rowH - 1.4,
      opacity: 1, rotation: 0, groupId: null,
      animation: {
        enter: { type: 'clipRevealLeft', duration: 250, delay: stagger + 200, easing: 'power2.out' },
        exit: { type: 'clipHideLeft', duration: 200, delay: 0, easing: 'exitAccel' },
        emphasis: { type: 'pulse', duration: 300, trigger: 'onChange', repeat: 0 },
      },
      props: {
        bindingSource: 'telemetry', bindingField: 'carNumber',
        carSelector: `byRank:${rank}`, format: 'raw',
        fontFamily: 'Oswald, sans-serif', fontSize: 20, fontWeight: '600',
        color: '#3b82f6', textAlign: 'left', verticalAlign: 'middle',
        fallback: '--', prefix: '#', suffix: '',
      },
    });

    // Gap — fades in from right, crossfade updates, gain flash
    rows.push({
      id: `tt-row${rank}-gap`, type: 'data', name: `P${rank} Gap`,
      x: 9.5, y: y + 0.4, width: 6, height: rowH - 1.4,
      opacity: 1, rotation: 0, groupId: null,
      animation: {
        enter: { type: 'fadeInRight', duration: 250, delay: stagger + 250, easing: 'power2.out' },
        exit: { type: 'fadeOutRight', duration: 200, delay: 0, easing: 'power2.in' },
        update: { type: 'crossfade', duration: 300 },
        emphasis: { type: 'gainFlash', duration: 250, trigger: 'onChange', repeat: 0 },
      },
      props: {
        bindingSource: 'leaderboard', bindingField: 'Time_Behind',
        carSelector: `byRank:${rank}`, format: 'delta',
        fontFamily: 'Roboto Mono, monospace', fontSize: 18, fontWeight: '500',
        color: rank === 1 ? '#f59e0b' : '#94a3b8', textAlign: 'right',
        verticalAlign: 'middle',
        fallback: rank === 1 ? 'Leader' : '--',
        prefix: '', suffix: '',
      },
    });
  }

  return rows;
}

/**
 * 2025 NTT IndyCar Series full-time driver roster (27 entries, 11 teams).
 */
function _2025Drivers() {
  return [
    { car_number: '2', first_name: 'Josef', last_name: 'Newgarden', team: 'Team Penske' },
    { car_number: '3', first_name: 'Scott', last_name: 'McLaughlin', team: 'Team Penske' },
    { car_number: '4', first_name: 'David', last_name: 'Malukas', team: 'A.J. Foyt Racing' },
    { car_number: '5', first_name: 'Pato', last_name: "O'Ward", team: 'Arrow McLaren' },
    { car_number: '6', first_name: 'Nolan', last_name: 'Siegel', team: 'Arrow McLaren' },
    { car_number: '7', first_name: 'Christian', last_name: 'Lundgaard', team: 'Arrow McLaren' },
    { car_number: '8', first_name: 'Kyffin', last_name: 'Simpson', team: 'Chip Ganassi Racing' },
    { car_number: '9', first_name: 'Scott', last_name: 'Dixon', team: 'Chip Ganassi Racing' },
    { car_number: '10', first_name: 'Alex', last_name: 'Palou', team: 'Chip Ganassi Racing' },
    { car_number: '12', first_name: 'Will', last_name: 'Power', team: 'Team Penske' },
    { car_number: '14', first_name: 'Santino', last_name: 'Ferrucci', team: 'A.J. Foyt Racing' },
    { car_number: '15', first_name: 'Graham', last_name: 'Rahal', team: 'Rahal Letterman Lanigan Racing' },
    { car_number: '18', first_name: 'Rinus', last_name: 'VeeKay', team: 'Dale Coyne Racing' },
    { car_number: '20', first_name: 'Alexander', last_name: 'Rossi', team: 'Ed Carpenter Racing' },
    { car_number: '21', first_name: 'Christian', last_name: 'Rasmussen', team: 'Ed Carpenter Racing' },
    { car_number: '26', first_name: 'Colton', last_name: 'Herta', team: 'Andretti Global' },
    { car_number: '27', first_name: 'Kyle', last_name: 'Kirkwood', team: 'Andretti Global' },
    { car_number: '28', first_name: 'Marcus', last_name: 'Ericsson', team: 'Andretti Global' },
    { car_number: '30', first_name: 'Louis', last_name: 'Foster', team: 'Rahal Letterman Lanigan Racing' },
    { car_number: '45', first_name: 'Devlin', last_name: 'DeFrancesco', team: 'Rahal Letterman Lanigan Racing' },
    { car_number: '51', first_name: 'Jacob', last_name: 'Abel', team: 'Dale Coyne Racing' },
    { car_number: '60', first_name: 'Felix', last_name: 'Rosenqvist', team: 'Meyer Shank Racing' },
    { car_number: '66', first_name: 'Marcus', last_name: 'Armstrong', team: 'Meyer Shank Racing' },
    { car_number: '77', first_name: 'Conor', last_name: 'Daly', team: 'Juncos Hollinger Racing' },
    { car_number: '78', first_name: 'Sting Ray', last_name: 'Robb', team: 'Juncos Hollinger Racing' },
    { car_number: '83', first_name: 'Robert', last_name: 'Shwartzman', team: 'PREMA Racing' },
    { car_number: '90', first_name: 'Callum', last_name: 'Ilott', team: 'PREMA Racing' },
  ];
}

module.exports = { initializeFirstRun };
