'use strict';

const express = require('express');
const prisma = require('../lib/prisma');
const entraAuth = require('../middleware/entraAuth');
const requireRole = require('../middleware/requireRole');
const { makeUniquePolicyKey } = require('../lib/policyKey');
const { syncToClient } = require('../services/clientSync');
const {
  CATALOG_SYNC_PATH,
  CATALOG_EVENT_TYPE,
  buildCatalogSyncPayload,
} = require('../lib/catalogSync');

const router = express.Router();

// All catalog routes require an authenticated ops user.
router.use(entraAuth);

// Pushes a catalog row (create or edit/deactivate) to the client cache and
// records the outcome on the row. Never throws — the ops write has already been
// persisted, so a push failure only marks the row 'failed' for the retry sweep.
async function pushCatalogUpsert(req, entry) {
  const result = await syncToClient(
    CATALOG_SYNC_PATH,
    buildCatalogSyncPayload(entry),
    {
      eventType: CATALOG_EVENT_TYPE,
      correlationId: req.correlationId,
    },
  );

  return prisma.policyCatalog.update({
    where: { id: entry.id },
    data: {
      eventId: result.eventId,
      syncStatus: result.ok ? 'synced' : 'failed',
      syncAttempts: result.ok ? entry.syncAttempts : entry.syncAttempts + 1,
    },
  });
}

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

    // Derive a unique catalog key from the name and persist it. Retry on the
    // rare race where a concurrent create grabs the same key between our
    // uniqueness check and the insert (unique violation -> re-derive).
    let created;
    for (let attempt = 0; ; attempt += 1) {
      const key = await makeUniquePolicyKey(prisma, name);
      try {
        created = await prisma.policyCatalog.create({
          data: {
            key,
            name,
            description: description ?? null,
            premiumAmount,
            coverageAmount,
            isActive: isActive ?? true,
          },
        });
        break;
      } catch (e) {
        if (e.code === 'P2002' && e.meta && e.meta.target && e.meta.target.includes('key') && attempt < 5) {
          continue;
        }
        throw e;
      }
    }

    req.log.info({ policyCatalogId: created.id, key: created.key }, 'policy catalog entry created');

    // Push the new plan to the client cache immediately (fallback: client pull).
    const synced = await pushCatalogUpsert(req, created);
    res.status(201).json(synced);
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

    // Push the edit/deactivation to the client cache immediately (a deactivate,
    // isActive=false, is pushed too so the client can reflect it).
    const synced = await pushCatalogUpsert(req, updated);
    res.json(synced);
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Policy catalog entry not found' });
    }
    next(err);
  }
});

module.exports = router;
