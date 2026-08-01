'use strict';

const { v4: uuidv4 } = require('uuid');
const logger = require('../lib/logger');

const HEADER = 'x-vkai-correlation-id';

// Reads X-VKAI-Correlation-Id or generates one, attaches it to req and a
// request-scoped child logger, and echoes it back on the response.
module.exports = function correlationId(req, res, next) {
  const id = req.headers[HEADER] || uuidv4();
  req.correlationId = id;
  req.log = logger.child({ correlationId: id });
  res.setHeader('X-VKAI-Correlation-Id', id);

  req.log.info({ method: req.method, path: req.originalUrl }, 'request received');
  next();
};
