'use strict';

const { v4: uuidv4 } = require('uuid');
const env = require('../config/env');
const logger = require('../lib/logger');

// Reusable outbound sync to the client-side (GCP) API.
//
// Wraps `payload` in the standard event envelope and POSTs it to
// `${CLIENT_API_BASE_URL}${endpointPath}` with the shared sync key and a
// correlation id. Never throws — returns { ok, eventId, status?, error? } so the
// caller can update sync_status without the ops action failing on a sync error.
//
// Options:
//   eventType       - the envelope event_type (e.g. "policy.activated")
//   eventId         - reuse an existing idempotency key (retries); generated if absent
//   correlationId   - propagate the request's correlation id
async function syncToClient(endpointPath, payload, options = {}) {
  const eventId = options.eventId || uuidv4();
  const correlationId = options.correlationId || uuidv4();
  const log = logger.child({ correlationId, endpointPath, eventId });

  if (!env.clientApiBaseUrl) {
    log.error('client API base URL not configured; skipping outbound sync');
    return { ok: false, eventId, error: 'client API base URL not configured' };
  }

  const envelope = {
    event_id: eventId,
    event_type: options.eventType || 'unknown',
    occurred_at: new Date().toISOString(),
    source: 'provider',
    payload,
  };

  const url = `${env.clientApiBaseUrl}${endpointPath}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-VKAI-Sync-Key': env.syncKey || '',
        'X-VKAI-Correlation-Id': correlationId,
      },
      body: JSON.stringify(envelope),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      log.warn({ status: res.status, body }, 'outbound sync returned non-2xx');
      return { ok: false, eventId, status: res.status, error: `HTTP ${res.status}` };
    }

    log.info({ status: res.status }, 'outbound sync succeeded');
    return { ok: true, eventId, status: res.status };
  } catch (err) {
    log.warn({ err: err.message }, 'outbound sync failed');
    return { ok: false, eventId, error: err.message };
  }
}

module.exports = { syncToClient };
