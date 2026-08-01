'use strict';

const jwt = require('jsonwebtoken');
const { JwksClient } = require('jwks-rsa');
const env = require('../config/env');
const prisma = require('../lib/prisma');

// --- Entra ID (Azure AD) v2 token verification ---
//
// We validate the incoming Bearer JWT against Microsoft's tenant JWKS endpoint,
// then upsert an ops_users row from the token claims, mapping group membership
// to a role (Reviewer/Approver) via the two configured group-id env vars.
//
// NOTE: No real Entra ID app registration exists yet, so this cannot be tested
// end-to-end. It is written against the standard Azure AD v2 token contract.
// Real values for ENTRA_TENANT_ID / ENTRA_CLIENT_ID are required before login
// will actually succeed (see README).

let jwksClient = null;

function getJwksClient() {
  if (jwksClient) return jwksClient;
  if (!env.entra.tenantId) return null;

  jwksClient = new JwksClient({
    jwksUri: `https://login.microsoftonline.com/${env.entra.tenantId}/discovery/v2.0/keys`,
    cache: true,
    cacheMaxage: 24 * 60 * 60 * 1000, // 24h
    rateLimit: true,
  });
  return jwksClient;
}

// jsonwebtoken key-resolution callback backed by the JWKS client.
function getSigningKey(header, callback) {
  const client = getJwksClient();
  if (!client) {
    return callback(new Error('Entra tenant not configured'));
  }
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

function verifyToken(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getSigningKey,
      {
        algorithms: ['RS256'],
        audience: env.entra.clientId,
        issuer: `https://login.microsoftonline.com/${env.entra.tenantId}/v2.0`,
      },
      (err, decoded) => {
        if (err) return reject(err);
        resolve(decoded);
      },
    );
  });
}

// Maps a token's group claim array to our internal role.
// Approver takes precedence over Reviewer if a user is in both groups.
function roleFromGroups(groups) {
  const list = Array.isArray(groups) ? groups : [];
  if (env.entra.approverGroupId && list.includes(env.entra.approverGroupId)) {
    return 'Approver';
  }
  if (env.entra.reviewerGroupId && list.includes(env.entra.reviewerGroupId)) {
    return 'Reviewer';
  }
  return null;
}

module.exports = async function entraAuth(req, res, next) {
  try {
    if (!env.entra.tenantId || !env.entra.clientId) {
      req.log.error('Entra ID not configured (tenant/client id missing)');
      return res.status(500).json({
        error: 'Entra ID auth not configured on server',
      });
    }

    const authHeader = req.headers.authorization || '';
    const [scheme, token] = authHeader.split(' ');
    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ error: 'Missing or malformed Authorization header' });
    }

    const claims = await verifyToken(token);

    const entraObjectId = claims.oid || claims.sub;
    const email = claims.preferred_username || claims.email || claims.upn;
    const name = claims.name || null;

    if (!entraObjectId || !email) {
      return res.status(401).json({ error: 'Token missing required identity claims' });
    }

    const role = roleFromGroups(claims.groups);
    if (!role) {
      req.log.warn({ entraObjectId }, 'token has no recognized ops group');
      return res.status(403).json({
        error: 'User is not a member of a recognized ops group (Reviewer/Approver)',
      });
    }

    // Upsert the ops user from claims on every request (cheap, keeps role/email fresh).
    const opsUser = await prisma.opsUser.upsert({
      where: { entraObjectId },
      update: { email, name, role },
      create: { entraObjectId, email, name, role },
    });

    req.opsUser = opsUser;
    req.log = req.log.child({ opsUserId: opsUser.id, role: opsUser.role });
    next();
  } catch (err) {
    req.log.warn({ err: err.message }, 'token verification failed');
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};
