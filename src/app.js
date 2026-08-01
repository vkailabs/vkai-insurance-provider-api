'use strict';

const express = require('express');
const cors = require('cors');

const env = require('./config/env');
const correlationId = require('./middleware/correlationId');
const errorHandler = require('./middleware/errorHandler');

const policyCatalogRoutes = require('./routes/policyCatalog');
const policiesRoutes = require('./routes/policies');
const premiumsRoutes = require('./routes/premiums');
const claimsRoutes = require('./routes/claims');
const syncIssuesRoutes = require('./routes/syncIssues');
const crossCloudRoutes = require('./routes/crossCloud');

const app = express();

// CORS — required from the start. Allow the provider frontend origin, the
// Authorization/Content-Type/sync/correlation headers, and OPTIONS preflight.
app.use(
  cors({
    origin: env.allowedOrigin,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-VKAI-Sync-Key',
      'X-VKAI-Correlation-Id',
    ],
  }),
);

app.use(express.json());
app.use(correlationId);

// Health check (unauthenticated).
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: env.serviceName });
});

// Ops-authenticated routes (Entra ID JWT enforced inside each router).
app.use('/v1/policy-catalog', policyCatalogRoutes);
app.use('/v1/policies', policiesRoutes);
app.use('/v1/premiums', premiumsRoutes);
app.use('/v1/claims', claimsRoutes);
app.use('/v1/sync-issues', syncIssuesRoutes);

// Cross-cloud routes (shared-secret enforced inside the router).
// Handles GET /v1/catalog/policies and POST /v1/sync/{policies,premiums,claims}.
app.use('/v1', crossCloudRoutes);

// 404 fallback.
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use(errorHandler);

module.exports = app;
