'use strict';

const env = require('../config/env');

// Guards the cross-cloud routes with a shared secret (X-VKAI-Sync-Key header).
// These routes are NOT behind the Entra ID ops JWT.
module.exports = function syncAuth(req, res, next) {
  const provided = req.headers['x-vkai-sync-key'];

  if (!env.syncKey) {
    req.log.error('sync key not configured on server');
    return res.status(500).json({ error: 'Sync key not configured on server' });
  }

  if (!provided || provided !== env.syncKey) {
    req.log.warn('rejected cross-cloud request: invalid sync key');
    return res.status(401).json({ error: 'Invalid or missing sync key' });
  }

  next();
};
