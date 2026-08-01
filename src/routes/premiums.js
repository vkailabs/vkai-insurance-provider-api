'use strict';

const express = require('express');
const prisma = require('../lib/prisma');
const entraAuth = require('../middleware/entraAuth');

const router = express.Router();

router.use(entraAuth);

// GET /v1/premiums -> list premium records (view only, both roles)
router.get('/', async (req, res, next) => {
  try {
    const premiums = await prisma.premium.findMany({
      orderBy: { paidAt: 'desc' },
      include: { policy: true },
    });
    res.json(premiums);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
