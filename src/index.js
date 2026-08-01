'use strict';

const app = require('./app');
const env = require('./config/env');
const logger = require('./lib/logger');
const prisma = require('./lib/prisma');
const retrySync = require('./jobs/retrySync');

async function main() {
  const server = app.listen(env.port, () => {
    logger.info({ port: env.port }, `${env.serviceName} listening`);
  });

  // Start the background sync retry job.
  const retryTask = retrySync.start();

  // Graceful shutdown.
  const shutdown = async (signal) => {
    logger.info({ signal }, 'shutting down');
    if (retryTask) retryTask.stop();
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err: err.message }, 'fatal startup error');
  process.exit(1);
});
