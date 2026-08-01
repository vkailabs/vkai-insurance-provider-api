'use strict';

const cron = require('node-cron');
const prisma = require('../lib/prisma');
const logger = require('../lib/logger');
const { syncToClient } = require('../services/clientSync');

const MAX_ATTEMPTS = 5;

// Retries outbound status pushes that haven't been confirmed synced. Reuses the
// stored event_id so the client side can dedupe the retry.
async function retryPolicies(log) {
  // Only policies that carry a decision worth pushing (i.e. already activated).
  const policies = await prisma.policy.findMany({
    where: {
      status: 'active',
      syncStatus: { in: ['pending', 'failed'] },
      syncAttempts: { lt: MAX_ATTEMPTS },
    },
  });

  for (const policy of policies) {
    const result = await syncToClient(
      '/v1/sync/policies/status',
      { client_policy_id: policy.clientPolicyId, status: policy.status },
      { eventType: 'policy.activated', eventId: policy.eventId || undefined },
    );

    await prisma.policy.update({
      where: { id: policy.id },
      data: {
        eventId: result.eventId,
        syncStatus: result.ok ? 'synced' : 'failed',
        syncAttempts: policy.syncAttempts + 1,
      },
    });
    log.info({ policyId: policy.id, ok: result.ok }, 'retry: policy status push');
  }
  return policies.length;
}

async function retryClaims(log) {
  // Only claims that have moved past the initial Submitted state carry a
  // provider-side decision that needs pushing.
  const claims = await prisma.claim.findMany({
    where: {
      status: { not: 'Submitted' },
      syncStatus: { in: ['pending', 'failed'] },
      syncAttempts: { lt: MAX_ATTEMPTS },
    },
  });

  for (const claim of claims) {
    const result = await syncToClient(
      '/v1/sync/claims/status',
      { client_claim_id: claim.clientClaimId, status: claim.status },
      { eventType: `claim.${claim.status.toLowerCase().replace(/\s+/g, '_')}`, eventId: claim.eventId || undefined },
    );

    await prisma.claim.update({
      where: { id: claim.id },
      data: {
        eventId: result.eventId,
        syncStatus: result.ok ? 'synced' : 'failed',
        syncAttempts: claim.syncAttempts + 1,
      },
    });
    log.info({ claimId: claim.id, ok: result.ok }, 'retry: claim status push');
  }
  return claims.length;
}

async function runOnce() {
  const log = logger.child({ job: 'retrySync' });
  try {
    const [policyCount, claimCount] = await Promise.all([
      retryPolicies(log),
      retryClaims(log),
    ]);
    if (policyCount || claimCount) {
      log.info({ policyCount, claimCount }, 'retry sweep complete');
    }
  } catch (err) {
    log.error({ err: err.message }, 'retry sweep failed');
  }
}

// Schedules the retry sweep every 5 minutes. Returns the cron task.
function start() {
  logger.info('starting background sync retry job (every 5 minutes)');
  return cron.schedule('*/5 * * * *', runOnce);
}

module.exports = { start, runOnce };
