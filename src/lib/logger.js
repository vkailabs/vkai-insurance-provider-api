'use strict';

const pino = require('pino');
const env = require('../config/env');

// Structured JSON logs. Every line carries: timestamp, env, service, level,
// message — and correlationId when logging through a request-scoped child logger.
const logger = pino({
  level: env.logLevel,
  base: {
    env: env.nodeEnv,
    service: env.serviceName,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

module.exports = logger;
