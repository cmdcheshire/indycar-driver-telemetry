const morgan = require('morgan');

morgan.token('user', (req) => {
  return req.user ? req.user.username : 'anonymous';
});

const httpLogger = morgan(':method :url :status :response-time ms - :user');

module.exports = { httpLogger };
