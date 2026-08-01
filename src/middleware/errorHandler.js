'use strict';

// Central error handler. Keep it last in the middleware chain.
// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, next) {
  const log = req.log || require('../lib/logger');
  log.error({ err: { message: err.message, stack: err.stack } }, 'unhandled error');

  const status = err.status || 500;
  res.status(status).json({
    error: status === 500 ? 'Internal server error' : err.message,
  });
};
