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
 */
function _seedExampleTemplates() {
  // Template 1: Driver Card
  overlayService.createTemplate({
    name: 'Driver Card',
    overlay_type: 'driver_card',
    description: 'Displays a single driver with name, car number, speed, and position.',
    canvas_width: 1920,
    canvas_height: 1080,
    template_data: {
      elements: [
        {
          id: 'dc-bg', type: 'shape', name: 'Background',
          x: 2, y: 75, width: 28, height: 18,
          opacity: 0.9, rotation: 0, groupId: null,
          props: {
            shapeType: 'rectangle', fill: 'rgba(10,10,30,0.85)',
            strokeColor: '#3b82f6', strokeWidth: 2, borderRadius: 8,
          },
        },
        {
          id: 'dc-pos', type: 'data', name: 'Position',
          x: 3, y: 76, width: 5, height: 6,
          opacity: 1, rotation: 0, groupId: null,
          props: {
            bindingSource: 'leaderboard', bindingField: 'position',
            carSelector: 'target1', format: 'ordinal',
            fontFamily: 'Oswald, sans-serif', fontSize: 48, fontWeight: '700',
            color: '#3b82f6', textAlign: 'center', fallback: '--',
            text: '1st', prefix: '', suffix: '',
          },
        },
        {
          id: 'dc-car', type: 'data', name: 'Car Number',
          x: 9, y: 76, width: 6, height: 4,
          opacity: 1, rotation: 0, groupId: null,
          props: {
            bindingSource: 'referenceData', bindingField: 'carNumber',
            carSelector: 'target1',
            fontFamily: 'Oswald, sans-serif', fontSize: 28, fontWeight: '700',
            color: '#FFFFFF', textAlign: 'left', fallback: '#--',
            text: '#21', prefix: '#', suffix: '',
          },
        },
        {
          id: 'dc-name', type: 'data', name: 'Driver Name',
          x: 9, y: 80, width: 18, height: 4,
          opacity: 1, rotation: 0, groupId: null,
          props: {
            bindingSource: 'referenceData', bindingField: 'driverLastName',
            carSelector: 'target1',
            fontFamily: 'Inter, sans-serif', fontSize: 22, fontWeight: '600',
            color: '#FFFFFF', textAlign: 'left', fallback: 'DRIVER',
            text: 'VAN KALMTHOUT', prefix: '', suffix: '',
          },
        },
        {
          id: 'dc-speed', type: 'data', name: 'Speed',
          x: 9, y: 85, width: 10, height: 4,
          opacity: 1, rotation: 0, groupId: null,
          props: {
            bindingSource: 'telemetry', bindingField: 'speed',
            carSelector: 'target1', format: 'speed',
            fontFamily: 'Roboto Mono, monospace', fontSize: 20, fontWeight: '600',
            color: '#10b981', textAlign: 'left', fallback: '--- mph',
            text: '224.3 mph', prefix: '', suffix: ' mph',
          },
        },
        {
          id: 'dc-gap', type: 'data', name: 'Gap to Leader',
          x: 20, y: 85, width: 8, height: 4,
          opacity: 1, rotation: 0, groupId: null,
          props: {
            bindingSource: 'leaderboard', bindingField: 'gapToLeader',
            carSelector: 'target1', format: 'delta',
            fontFamily: 'Roboto Mono, monospace', fontSize: 20, fontWeight: '500',
            color: '#f59e0b', textAlign: 'right', fallback: '--',
            text: '+1.234', prefix: '', suffix: '',
          },
        },
      ],
      groups: [],
      version: 1,
    },
  }, null);

  // Template 2: Timing Tower (Top 5 Leaderboard)
  overlayService.createTemplate({
    name: 'Timing Tower',
    overlay_type: 'leaderboard',
    description: 'Vertical timing tower showing top 5 positions with car number and gap.',
    canvas_width: 1920,
    canvas_height: 1080,
    template_data: {
      elements: [
        {
          id: 'tt-header-bg', type: 'shape', name: 'Header BG',
          x: 1, y: 2, width: 14, height: 4,
          opacity: 0.95, rotation: 0, groupId: null,
          props: {
            shapeType: 'rectangle', fill: '#3b82f6',
            strokeColor: '', strokeWidth: 0, borderRadius: 4,
          },
        },
        {
          id: 'tt-header', type: 'text', name: 'Header Text',
          x: 1.5, y: 2.5, width: 13, height: 3,
          opacity: 1, rotation: 0, groupId: null,
          props: {
            text: 'RACE STANDINGS',
            fontFamily: 'Oswald, sans-serif', fontSize: 22, fontWeight: '700',
            color: '#FFFFFF', textAlign: 'center',
          },
        },
        ..._timingTowerRows(5),
      ],
      groups: [],
      version: 1,
    },
  }, null);

  // Template 3: Lower Third (L-Bar)
  overlayService.createTemplate({
    name: 'Lower Third',
    overlay_type: 'lbar',
    description: 'Lower-third bar with driver name, team, and gap to leader.',
    canvas_width: 1920,
    canvas_height: 1080,
    template_data: {
      elements: [
        {
          id: 'lt-bg', type: 'shape', name: 'Bar Background',
          x: 5, y: 82, width: 40, height: 10,
          opacity: 0.9, rotation: 0, groupId: null,
          props: {
            shapeType: 'rectangle', fill: 'rgba(10,10,30,0.9)',
            strokeColor: '', strokeWidth: 0, borderRadius: 4,
          },
        },
        {
          id: 'lt-accent', type: 'shape', name: 'Accent Bar',
          x: 5, y: 82, width: 0.4, height: 10,
          opacity: 1, rotation: 0, groupId: null,
          props: {
            shapeType: 'rectangle', fill: '#3b82f6',
            strokeColor: '', strokeWidth: 0, borderRadius: 0,
          },
        },
        {
          id: 'lt-name', type: 'data', name: 'Driver Name',
          x: 7, y: 83, width: 20, height: 5,
          opacity: 1, rotation: 0, groupId: null,
          props: {
            bindingSource: 'referenceData', bindingField: 'driverLastName',
            carSelector: 'target1',
            fontFamily: 'Oswald, sans-serif', fontSize: 36, fontWeight: '700',
            color: '#FFFFFF', textAlign: 'left', fallback: 'DRIVER NAME',
            text: 'VAN KALMTHOUT', prefix: '', suffix: '',
          },
        },
        {
          id: 'lt-team', type: 'data', name: 'Team Name',
          x: 7, y: 88, width: 20, height: 3,
          opacity: 1, rotation: 0, groupId: null,
          props: {
            bindingSource: 'referenceData', bindingField: 'teamName',
            carSelector: 'target1',
            fontFamily: 'Inter, sans-serif', fontSize: 16, fontWeight: '400',
            color: '#94a3b8', textAlign: 'left', fallback: 'Team',
            text: 'Ed Carpenter Racing', prefix: '', suffix: '',
          },
        },
        {
          id: 'lt-gap', type: 'data', name: 'Gap',
          x: 34, y: 83, width: 10, height: 5,
          opacity: 1, rotation: 0, groupId: null,
          props: {
            bindingSource: 'leaderboard', bindingField: 'gapToLeader',
            carSelector: 'target1', format: 'delta',
            fontFamily: 'Roboto Mono, monospace', fontSize: 32, fontWeight: '600',
            color: '#f59e0b', textAlign: 'right', fallback: '--',
            text: '+1.234', prefix: '', suffix: '',
          },
        },
        {
          id: 'lt-pos', type: 'data', name: 'Position',
          x: 34, y: 88, width: 10, height: 3,
          opacity: 1, rotation: 0, groupId: null,
          props: {
            bindingSource: 'leaderboard', bindingField: 'position',
            carSelector: 'target1', format: 'ordinal',
            fontFamily: 'Inter, sans-serif', fontSize: 16, fontWeight: '600',
            color: '#3b82f6', textAlign: 'right', fallback: '--',
            text: '1st', prefix: '', suffix: '',
          },
        },
      ],
      groups: [],
      version: 1,
    },
  }, null);
}

/**
 * Generate timing tower row elements for positions 1..count.
 * Each row uses byRank selector to bind to that leaderboard position.
 */
function _timingTowerRows(count) {
  const rows = [];
  const startY = 7; // below header
  const rowH = 4.5;

  for (let i = 0; i < count; i++) {
    const rank = i + 1;
    const y = startY + i * rowH;
    const rowBg = (i % 2 === 0) ? 'rgba(10,10,30,0.85)' : 'rgba(20,20,45,0.85)';

    // Row background
    rows.push({
      id: `tt-row${rank}-bg`, type: 'shape', name: `P${rank} BG`,
      x: 1, y, width: 14, height: rowH - 0.5,
      opacity: 0.9, rotation: 0, groupId: null,
      props: {
        shapeType: 'rectangle', fill: rowBg,
        strokeColor: '', strokeWidth: 0, borderRadius: 2,
      },
    });

    // Position number
    rows.push({
      id: `tt-row${rank}-pos`, type: 'data', name: `P${rank} Pos`,
      x: 1.5, y: y + 0.3, width: 3, height: rowH - 1,
      opacity: 1, rotation: 0, groupId: null,
      props: {
        bindingSource: 'leaderboard', bindingField: 'position',
        carSelector: `byRank:${rank}`,
        fontFamily: 'Oswald, sans-serif', fontSize: 22, fontWeight: '700',
        color: rank === 1 ? '#f59e0b' : '#FFFFFF', textAlign: 'center',
        fallback: `${rank}`, text: `${rank}`, prefix: '', suffix: '',
      },
    });

    // Car number
    rows.push({
      id: `tt-row${rank}-car`, type: 'data', name: `P${rank} Car`,
      x: 5, y: y + 0.3, width: 4, height: rowH - 1,
      opacity: 1, rotation: 0, groupId: null,
      props: {
        bindingSource: 'referenceData', bindingField: 'carNumber',
        carSelector: `byRank:${rank}`,
        fontFamily: 'Oswald, sans-serif', fontSize: 20, fontWeight: '600',
        color: '#3b82f6', textAlign: 'left',
        fallback: '--', text: `#${21 + i}`, prefix: '#', suffix: '',
      },
    });

    // Gap
    rows.push({
      id: `tt-row${rank}-gap`, type: 'data', name: `P${rank} Gap`,
      x: 9.5, y: y + 0.3, width: 5, height: rowH - 1,
      opacity: 1, rotation: 0, groupId: null,
      props: {
        bindingSource: 'leaderboard', bindingField: 'gapToLeader',
        carSelector: `byRank:${rank}`, format: 'delta',
        fontFamily: 'Roboto Mono, monospace', fontSize: 18, fontWeight: '500',
        color: '#94a3b8', textAlign: 'right',
        fallback: rank === 1 ? 'Leader' : '--', text: rank === 1 ? 'Leader' : `+${(rank * 0.8).toFixed(3)}`,
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
