'use strict';

// Policy-catalog "key" derivation.
//
// Algorithm (must stay in lockstep with the SQL backfill in
// prisma/migrations/*_add_policy_catalog_key/migration.sql):
//   - split the plan name on whitespace
//   - drop empty tokens
//   - take the FIRST character of each token, uppercased
//   - concatenate them
// Examples: "Premium Gold 2024" -> "PG2", "Gold Plan 2" -> "GP2".
// A numeric token contributes its first digit ("2024" -> "2").
function derivePolicyKey(name) {
  const base = String(name || '')
    .trim()
    .split(/\s+/)
    .filter((tok) => tok.length > 0)
    .map((tok) => tok.charAt(0).toUpperCase())
    .join('');
  // Fallback so a nameless/blank plan still yields a non-empty, storable key.
  return base || 'PLAN';
}

// Make a derived key unique against the catalog table. If the base key is
// already taken, append a readable dash-numeric suffix starting at 2:
//   "PG2" -> "PG2-2" -> "PG2-3" -> ...
// The uniqueness check runs against the database (via the given Prisma client
// or transaction handle).
async function makeUniquePolicyKey(client, name) {
  const base = derivePolicyKey(name);
  let candidate = base;
  let n = 2;
  // eslint-disable-next-line no-await-in-loop
  while (await client.policyCatalog.findUnique({ where: { key: candidate } })) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  return candidate;
}

module.exports = { derivePolicyKey, makeUniquePolicyKey };
