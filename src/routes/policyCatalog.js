'use strict';

const express = require('express');
const prisma = require('../lib/prisma');
const entraAuth = require('../middleware/entraAuth');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

// All catalog routes require an authenticated ops user.
router.use(entraAuth);

// GET /v1/policy-catalog -> list all catalog entries
router.get('/', async (req, res, next) => {
  try {
    const items = await prisma.policyCatalog.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json(items);
  } catch (err) {
    next(err);
  }
});

// POST /v1/policy-catalog -> create a plan (Approver only)
router.post('/', requireRole('Approver'), async (req, res, next) => {
  try {
    const { name, description, premiumAmount, coverageAmount, isActive } = req.body || {};

    if (!name || premiumAmount == null || coverageAmount == null) {
      return res.status(400).json({
        error: 'name, premiumAmount and coverageAmount are required',
      });
    }

    const created = await prisma.policyCatalog.create({
      data: {
        name,
        description: description ?? null,
        premiumAmount,
        coverageAmount,
        isActive: isActive ?? true,
      },
    });

    req.log.info({ policyCatalogId: created.id }, 'policy catalog entry created');
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// PATCH /v1/policy-catalog/:id -> edit/deactivate a plan (Approver only)
router.patch('/:id', requireRole('Approver'), async (req, res, next) => {
  try {
    const { name, description, premiumAmount, coverageAmount, isActive } = req.body || {};

    const data = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (premiumAmount !== undefined) data.premiumAmount = premiumAmount;
    if (coverageAmount !== undefined) data.coverageAmount = coverageAmount;
    if (isActive !== undefined) data.isActive = isActive;

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }

    const updated = await prisma.policyCatalog.update({
      where: { id: req.params.id },
      data,
    });

    req.log.info({ policyCatalogId: updated.id }, 'policy catalog entry updated');
    res.json(updated);
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Policy catalog entry not found' });
    }
    next(err);
  }
});

module.exports = router;
