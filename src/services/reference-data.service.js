const { getDb } = require('../config/database');
const state = require('../telemetry/race-state');

function getAllDrivers() {
  return getDb().prepare('SELECT * FROM drivers ORDER BY car_number').all();
}

function getDriver(carNumber) {
  return getDb().prepare('SELECT * FROM drivers WHERE car_number = ?').get(carNumber);
}

function upsertDriver(data) {
  const { car_number, first_name, last_name, display_name, team, headshot_path, car_logo_path, team_logo_path } = data;

  if (!car_number || !first_name || !last_name) {
    throw new Error('car_number, first_name, and last_name are required');
  }

  const now = new Date().toISOString();
  const name = display_name || `${first_name} ${last_name}`;

  getDb().prepare(
    `INSERT INTO drivers (car_number, first_name, last_name, display_name, team, headshot_path, car_logo_path, team_logo_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(car_number) DO UPDATE SET
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       display_name = excluded.display_name,
       team = excluded.team,
       headshot_path = excluded.headshot_path,
       car_logo_path = excluded.car_logo_path,
       team_logo_path = excluded.team_logo_path,
       updated_at = excluded.updated_at`
  ).run(car_number, first_name, last_name, name, team || null, headshot_path || null, car_logo_path || null, team_logo_path || null, now, now);

  // Update in-memory reference data
  syncToRaceState();

  return getDriver(car_number);
}

function deleteDriver(carNumber) {
  getDb().prepare('DELETE FROM drivers WHERE car_number = ?').run(carNumber);
  syncToRaceState();
}

function bulkImportDrivers(drivers) {
  const db = getDb();
  const now = new Date().toISOString();

  const insert = db.prepare(
    `INSERT INTO drivers (car_number, first_name, last_name, display_name, team, headshot_path, car_logo_path, team_logo_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(car_number) DO UPDATE SET
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       display_name = excluded.display_name,
       team = excluded.team,
       headshot_path = excluded.headshot_path,
       car_logo_path = excluded.car_logo_path,
       team_logo_path = excluded.team_logo_path,
       updated_at = excluded.updated_at`
  );

  const transaction = db.transaction((list) => {
    for (const d of list) {
      const name = d.display_name || `${d.first_name} ${d.last_name}`;
      insert.run(
        d.car_number, d.first_name, d.last_name, name,
        d.team || null, d.headshot_path || null, d.car_logo_path || null, d.team_logo_path || null,
        now, now
      );
    }
    return list.length;
  });

  const count = transaction(drivers);
  syncToRaceState();
  return count;
}

function getImagesByCategory(category) {
  return getDb().prepare('SELECT * FROM reference_images WHERE category = ? ORDER BY name').all(category);
}

/**
 * Sync database drivers to the in-memory race state reference data.
 * Also reinitializes per-driver data structures.
 */
function syncToRaceState() {
  const drivers = getAllDrivers();
  state.referenceData.drivers = {};

  for (const d of drivers) {
    state.referenceData.drivers[d.car_number] = {
      carLogo: d.car_logo_path || '',
      team: d.team || '',
      teamLogo: d.team_logo_path || '',
      firstName: d.first_name,
      lastName: d.last_name,
      displayName: d.display_name,
      headshot: d.headshot_path || '',
    };
  }

  state.initializeDriverData();
  console.log(`Reference data synced: ${drivers.length} drivers`);
}

/**
 * Load reference data from DB into race state on startup.
 */
function loadReferenceData() {
  syncToRaceState();

  // Load reference images
  const images = getDb().prepare('SELECT * FROM reference_images').all();
  state.referenceData.tireImages = {};
  state.referenceData.indicatorImages = {};
  state.referenceData.leaderboardImages = {};

  for (const img of images) {
    if (img.category === 'tire') state.referenceData.tireImages[img.name] = img.image_path;
    else if (img.category === 'indicator') state.referenceData.indicatorImages[img.name] = img.image_path;
    else if (img.category === 'leaderboard') state.referenceData.leaderboardImages[img.name] = img.image_path;
  }
}

module.exports = {
  getAllDrivers,
  getDriver,
  upsertDriver,
  deleteDriver,
  bulkImportDrivers,
  getImagesByCategory,
  loadReferenceData,
  syncToRaceState,
};
