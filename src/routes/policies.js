'use strict';

const express = require('express');
const prisma = require('../lib/prisma');
const entraAuth = require('../middleware/entraAuth');
const requireRole = require('../middleware/requireRole');
const { syncToClient } = require('../services/clientSync');

const router = express.Router();

router.use(entraAuth);

// GET /v1/policies -> list enrollments; ?status=pending for the pending queue
router.get('/', async (req, res, next) => {
  try {
    const { status } = req.query;
    const where = status ? { status } : {};

    const policies = await prisma.policy.findMany({
      where,
      orderBy: { enrolledAt: 'desc' },
      include: { policyCatalog: true },
    });
    res.json(policies);
  } catch (err) {
    next(err);
  }
});

// POST /v1/policies/:id/activate -> Approver only; status -> active, then push
// the new status back to the client side.
router.post('/:id/activate', requireRole('Approver'), async (req, res, next) => {
  try {
    const policy = await prisma.policy.findUnique({ where: { id: req.params.id } });
    if (!policy) {
      return res.status(404).json({ error: 'Policy not found' });
    }

    // Perform the local state change first so the ops action succeeds regardless
    // of the outbound sync outcome.
    const updated = await prisma.policy.update({
      where: { id: policy.id },
      data: { status: 'active' },
    });

    const result = await syncToClient(
      '/v1/sync/policies/status',
      {
        client_policy_id: updated.clientPolicyId,
        status: 'active',
      },
      {
        eventType: 'policy.activated',
        correlationId: req.correlationId,
      },
    );

    const synced = await prisma.policy.update({
      where: { id: policy.id },
      data: {
        eventId: result.eventId,
        syncStatus: result.ok ? 'synced' : 'failed',
        syncAttempts: result.ok ? policy.syncAttempts : policy.syncAttempts + 1,
      },
    });

    req.log.info(
      { policyId: synced.id, syncStatus: synced.syncStatus },
      'policy activated',
    );
    res.json(synced);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
