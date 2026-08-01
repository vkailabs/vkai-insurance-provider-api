'use strict';

// Small role-check helper. Use AFTER entraAuth so req.opsUser is populated.
// e.g. router.post('/', requireRole('Approver'), handler)
module.exports = function requireRole(...allowedRoles) {
  return function (req, res, next) {
    if (!req.opsUser) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!allowedRoles.includes(req.opsUser.role)) {
      req.log.warn(
        { role: req.opsUser.role, required: allowedRoles },
        'rejected: insufficient role',
      );
      return res.status(403).json({
        error: `Requires role: ${allowedRoles.join(' or ')}`,
      });
    }
    next();
  };
};
