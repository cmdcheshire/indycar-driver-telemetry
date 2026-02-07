const authService = require('../services/auth.service');
const constants = require('../config/constants');

/**
 * First-run initialization: creates default admin user if no users exist.
 */
async function initializeFirstRun() {
  const userCount = authService.getUserCount();

  if (userCount === 0) {
    console.log('First run detected — creating default admin user...');
    await authService.createUser(constants.DEFAULT_USERNAME, constants.DEFAULT_PASSWORD, 'admin');
    console.log(`Default user created: ${constants.DEFAULT_USERNAME} / ${constants.DEFAULT_PASSWORD}`);
    console.log('IMPORTANT: Change the default password after first login!');
  }
}

module.exports = { initializeFirstRun };
