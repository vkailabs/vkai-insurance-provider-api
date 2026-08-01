'use strict';

// Central env access. Loads .env for local (non-Docker) runs; in Docker the
// values come from the compose environment, so a missing .env file is fine.
try {
  require('dotenv').config();
} catch (_) {
  // dotenv is optional (not a hard dependency); ignore if unavailable.
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.VKAI_INSURANCE_PROVIDER_API_PORT || '4100', 10),
  databaseUrl: process.env.VKAI_INSURANCE_PROVIDER_API_DATABASE_URL,
  logLevel: process.env.VKAI_INSURANCE_PROVIDER_API_LOG_LEVEL || 'info',

  entra: {
    tenantId: process.env.VKAI_INSURANCE_PROVIDER_API_ENTRA_TENANT_ID,
    clientId: process.env.VKAI_INSURANCE_PROVIDER_API_ENTRA_CLIENT_ID,
    reviewerGroupId: process.env.VKAI_INSURANCE_PROVIDER_API_ENTRA_REVIEWER_GROUP_ID,
    approverGroupId: process.env.VKAI_INSURANCE_PROVIDER_API_ENTRA_APPROVER_GROUP_ID,
  },

  syncKey: process.env.VKAI_INSURANCE_PROVIDER_API_SYNC_KEY,
  clientApiBaseUrl: process.env.VKAI_INSURANCE_CLIENT_API_BASE_URL || 'http://localhost:4000',
  allowedOrigin: process.env.VKAI_INSURANCE_PROVIDER_API_ALLOWED_ORIGIN || 'http://localhost:5174',

  serviceName: 'vkai-insurance-provider-api',
};

module.exports = env;
