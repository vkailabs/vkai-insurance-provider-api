'use strict';

const express = require('express');
const prisma = require('../lib/prisma');
const entraAuth = require('../middleware/entraAuth');

const router = express.Router();

router.use(entraAuth);

// GET /v1/sync-issues -> all policies/premiums/claims rows with sync_status=failed.
// The "Sync issues" visibility screen for ops.
router.get('/', async (req, res, next) => {
  try {
    const [policies, premiums, claims] = await Promise.all([
      prisma.policy.findMany({
        where: { syncStatus: 'failed' },
        orderBy: { enrolledAt: 'desc' },
      }),
      prisma.premium.findMany({
        where: { syncStatus: 'failed' },
        orderBy: { paidAt: 'desc' },
      }),
      prisma.claim.findMany({
        where: { syncStatus: 'failed' },
        orderBy: { submittedAt: 'desc' },
      }),
    ]);

    res.json({
      counts: {
        policies: policies.length,
        premiums: premiums.length,
        claims: claims.length,
      },
      policies,
      premiums,
      claims,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
