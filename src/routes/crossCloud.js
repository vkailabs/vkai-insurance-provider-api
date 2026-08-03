'use strict';

const express = require('express');
const prisma = require('../lib/prisma');
const syncAuth = require('../middleware/syncAuth');

const router = express.Router();

// Every route here is protected by the shared sync secret, NOT the ops JWT.
router.use(syncAuth);

// Inbound pushes arrive wrapped in the standard envelope
// { event_id, event_type, occurred_at, source, payload }. Unwrap defensively so
// a flat body still works.
function unwrap(body) {
  if (body && typeof body === 'object' && body.payload && typeof body.payload === 'object') {
    return { eventId: body.event_id || null, payload: body.payload };
  }
  return { eventId: (body && body.event_id) || null, payload: body || {} };
}

// GET /v1/catalog/policies -> active policy_catalog rows the client side pulls.
// NOTE: response shape is intentionally frozen for the client cache via an
// explicit select. As of VKAI-002 the `key` column IS included here on purpose
// (VKAI-001 had deliberately excluded it; that decision is now reversed) so the
// client caches the plan key alongside the rest of the catalog row.
router.get('/catalog/policies', async (req, res, next) => {
  try {
    const items = await prisma.policyCatalog.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        premiumAmount: true,
        coverageAmount: true,
        isActive: true,
        createdAt: true,
      },
    });
    res.json(items);
  } catch (err) {
    next(err);
  }
});

// POST /v1/sync/policies -> inbound enrollment. Idempotent on client_policy_id.
router.post('/sync/policies', async (req, res, next) => {
  try {
    const { eventId, payload } = unwrap(req.body);
    const {
      policy_catalog_id,
      client_policy_id,
      client_user_ref,
      enrolled_at,
      expiry_date,
    } = payload;

    if (!policy_catalog_id || !client_policy_id || !client_user_ref || !expiry_date) {
      return res.status(400).json({
        error:
          'policy_catalog_id, client_policy_id, client_user_ref and expiry_date are required',
      });
    }

    // Idempotent: retried delivery of the same client_policy_id returns the existing row.
    const existing = await prisma.policy.findUnique({
      where: { clientPolicyId: client_policy_id },
    });
    if (existing) {
      req.log.info({ policyId: existing.id }, 'sync/policies: duplicate ignored');
      return res.status(200).json({ status: 'duplicate', policy: existing });
    }

    const created = await prisma.policy.create({
      data: {
        policyCatalogId: policy_catalog_id,
        clientPolicyId: client_policy_id,
        clientUserRef: client_user_ref,
        status: 'pending',
        enrolledAt: enrolled_at ? new Date(enrolled_at) : new Date(),
        expiryDate: new Date(expiry_date),
        eventId: eventId || undefined,
      },
    });

    req.log.info({ policyId: created.id }, 'sync/policies: enrollment created');
    res.status(201).json({ status: 'created', policy: created });
  } catch (err) {
    if (err.code === 'P2003') {
      return res.status(400).json({ error: 'Unknown policy_catalog_id' });
    }
    next(err);
  }
});

// POST /v1/sync/premiums -> inbound premium payment. Idempotent on event_id.
router.post('/sync/premiums', async (req, res, next) => {
  try {
    const { eventId, payload } = unwrap(req.body);
    const { client_policy_id, amount, paid_at } = payload;

    if (!client_policy_id || amount == null) {
      return res.status(400).json({ error: 'client_policy_id and amount are required' });
    }

    // Idempotent on the delivery's event_id when present.
    if (eventId) {
      const dupe = await prisma.premium.findUnique({ where: { eventId } });
      if (dupe) {
        req.log.info({ premiumId: dupe.id }, 'sync/premiums: duplicate ignored');
        return res.status(200).json({ status: 'duplicate', premium: dupe });
      }
    }

    const policy = await prisma.policy.findUnique({
      where: { clientPolicyId: client_policy_id },
    });
    if (!policy) {
      return res.status(404).json({ error: 'No policy for given client_policy_id' });
    }

    const created = await prisma.premium.create({
      data: {
        policyId: policy.id,
        amount,
        paidAt: paid_at ? new Date(paid_at) : new Date(),
        syncStatus: 'synced', // premiums are recorded passively, no outbound push
        eventId: eventId || undefined,
      },
    });

    req.log.info({ premiumId: created.id }, 'sync/premiums: premium recorded');
    res.status(201).json({ status: 'created', premium: created });
  } catch (err) {
    next(err);
  }
});

// POST /v1/sync/claims -> inbound claim. Idempotent on client_claim_id.
router.post('/sync/claims', async (req, res, next) => {
  try {
    const { eventId, payload } = unwrap(req.body);
    const { client_claim_id, client_policy_id, amount_claimed, description, submitted_at } =
      payload;

    if (!client_claim_id || !client_policy_id || amount_claimed == null) {
      return res.status(400).json({
        error: 'client_claim_id, client_policy_id and amount_claimed are required',
      });
    }

    const existing = await prisma.claim.findUnique({
      where: { clientClaimId: client_claim_id },
    });
    if (existing) {
      req.log.info({ claimId: existing.id }, 'sync/claims: duplicate ignored');
      return res.status(200).json({ status: 'duplicate', claim: existing });
    }

    const policy = await prisma.policy.findUnique({
      where: { clientPolicyId: client_policy_id },
    });
    if (!policy) {
      return res.status(404).json({ error: 'No policy for given client_policy_id' });
    }

    const created = await prisma.claim.create({
      data: {
        policyId: policy.id,
        clientClaimId: client_claim_id,
        amountClaimed: amount_claimed,
        description: description || '',
        status: 'Submitted',
        submittedAt: submitted_at ? new Date(submitted_at) : new Date(),
        eventId: eventId || undefined,
      },
    });

    req.log.info({ claimId: created.id }, 'sync/claims: claim created');
    res.status(201).json({ status: 'created', claim: created });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
