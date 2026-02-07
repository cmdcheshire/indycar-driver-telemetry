function registerRoutes(app) {
  app.use('/api/auth', require('./auth.routes'));
  app.use('/api/control', require('./control.routes'));
  app.use('/api/telemetry', require('./telemetry.routes'));
  app.use('/api/overlays', require('./overlays.routes'));
  app.use('/api/reference', require('./reference.routes'));
  app.use('/api/assets', require('./assets.routes'));
  app.use('/api/settings', require('./settings.routes'));
}

module.exports = { registerRoutes };
