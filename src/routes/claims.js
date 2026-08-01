'use strict';

const express = require('express');
const prisma = require('../lib/prisma');
const entraAuth = require('../middleware/entraAuth');
const requireRole = require('../middleware/requireRole');
const { syncToClient } = require('../services/clientSync');

const router = express.Router();

router.use(entraAuth);

// Pushes a claim's new status to the client side and records the outcome on the
// claim row. Never throws — the ops transition has already been persisted.
async function pushClaimStatus(req, claim, eventType) {
  const result = await syncToClient(
    '/v1/sync/claims/status',
    {
      client_claim_id: claim.clientClaimId,
      status: claim.status,
    },
    {
      eventType,
      correlationId: req.correlationId,
    },
  );

  return prisma.claim.update({
    where: { id: claim.id },
    data: {
      eventId: result.eventId,
      syncStatus: result.ok ? 'synced' : 'failed',
      syncAttempts: result.ok ? claim.syncAttempts : claim.syncAttempts + 1,
    },
  });
}

// GET /v1/claims -> list claims; ?status=<value> filter
router.get('/', async (req, res, next) => {
  try {
    const { status } = req.query;
    const where = status ? { status } : {};

    const claims = await prisma.claim.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
      include: { policy: true, reviewedBy: true, approvedBy: true },
    });
    res.json(claims);
  } catch (err) {
    next(err);
  }
});

// POST /v1/claims/:id/review -> Reviewer or Approver; status -> Under Review
router.post('/:id/review', requireRole('Reviewer', 'Approver'), async (req, res, next) => {
  try {
    const claim = await prisma.claim.findUnique({ where: { id: req.params.id } });
    if (!claim) return res.status(404).json({ error: 'Claim not found' });

    const updated = await prisma.claim.update({
      where: { id: claim.id },
      data: { status: 'Under Review', reviewedById: req.opsUser.id },
    });

    const synced = await pushClaimStatus(req, updated, 'claim.under_review');
    req.log.info({ claimId: synced.id }, 'claim moved to Under Review');
    res.json(synced);
  } catch (err) {
    next(err);
  }
});

// POST /v1/claims/:id/approve -> Approver only; status -> Approved
router.post('/:id/approve', requireRole('Approver'), async (req, res, next) => {
  try {
    const claim = await prisma.claim.findUnique({ where: { id: req.params.id } });
    if (!claim) return res.status(404).json({ error: 'Claim not found' });

    const updated = await prisma.claim.update({
      where: { id: claim.id },
      data: { status: 'Approved', approvedById: req.opsUser.id },
    });

    const synced = await pushClaimStatus(req, updated, 'claim.approved');
    req.log.info({ claimId: synced.id }, 'claim approved');
    res.json(synced);
  } catch (err) {
    next(err);
  }
});

// POST /v1/claims/:id/reject -> Approver only; status -> Rejected
router.post('/:id/reject', requireRole('Approver'), async (req, res, next) => {
  try {
    const claim = await prisma.claim.findUnique({ where: { id: req.params.id } });
    if (!claim) return res.status(404).json({ error: 'Claim not found' });

    const updated = await prisma.claim.update({
      where: { id: claim.id },
      data: { status: 'Rejected', approvedById: req.opsUser.id },
    });

    const synced = await pushClaimStatus(req, updated, 'claim.rejected');
    req.log.info({ claimId: synced.id }, 'claim rejected');
    res.json(synced);
  } catch (err) {
    next(err);
  }
});

// POST /v1/claims/:id/mark-paid -> Approver only; valid only from Approved
router.post('/:id/mark-paid', requireRole('Approver'), async (req, res, next) => {
  try {
    const claim = await prisma.claim.findUnique({ where: { id: req.params.id } });
    if (!claim) return res.status(404).json({ error: 'Claim not found' });

    if (claim.status !== 'Approved') {
      return res.status(409).json({
        error: `Claim must be Approved before it can be marked Paid (current: ${claim.status})`,
      });
    }

    const updated = await prisma.claim.update({
      where: { id: claim.id },
      data: { status: 'Paid' },
    });

    const synced = await pushClaimStatus(req, updated, 'claim.paid');
    req.log.info({ claimId: synced.id }, 'claim marked paid');
    res.json(synced);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
