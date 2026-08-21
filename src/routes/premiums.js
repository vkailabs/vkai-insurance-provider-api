'use strict';

const express = require('express');
const prisma = require('../lib/prisma');
const entraAuth = require('../middleware/entraAuth');

const router = express.Router();

router.use(entraAuth);

// GET /v1/premiums -> list premium records (view only, both roles)
//
// Response is enriched with `policyName`, resolved entirely from provider-local
// data via the relational join premium -> policy -> policyCatalog (no cross-cloud
// call). When a premium's policy or its catalog row can't be resolved, `policyName`
// is `null` (the frontend renders "Unknown plan"). A deactivated-but-present plan
// (isActive=false) still has a catalog row and resolves to its real name normally.
//
// Also enriched with `enrolmentDate` (VKAI-009): the stored premium.enrolmentDate
// (ISO date string, or null). If that is null, fall back to the linked
// policy.enrolledAt (the provider mirrors this on the policies table); if neither
// exists, null. Same provider-local pattern as the policyName enrichment above.
router.get('/', async (req, res, next) => {
  try {
    const premiums = await prisma.premium.findMany({
      orderBy: { paidAt: 'desc' },
      include: { policy: { include: { policyCatalog: true } } },
    });
    const enriched = premiums.map((premium) => ({
      ...premium,
      policyName: premium.policy?.policyCatalog?.name ?? null,
      enrolmentDate: premium.enrolmentDate ?? premium.policy?.enrolledAt ?? null,
    }));
    res.json(enriched);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
