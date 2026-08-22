const jwt = require('jsonwebtoken');

// Accepts either an `Authorization: Bearer` header or the httpOnly
// `radiance_token` cookie the dashboard login sets — the cookie is what the
// browser actually uses; the header stays supported for non-browser callers.
function auth(req, res, next) {
  const authHeader = req.header('Authorization');
  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.replace('Bearer ', '').trim();
  } else if (req.cookies && req.cookies.radiance_token) {
    token = req.cookies.radiance_token;
  }

  if (!token) {
    return res.status(401).json({ error: 'No token provided. Authorization denied.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded.user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired. Please log in again.' });
    }
    return res.status(401).json({ error: 'Invalid token.' });
  }
}

// Chain after `auth` on routes that only admins should reach (creating logins,
// deleting sites, etc). Supervisors and HR get a clear 403, not a silent no-op.
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

// Chain after `auth` on config-level routes (sites, shifts, services,
// contractors) that admins and HR manage but a single-site supervisor
// shouldn't be able to reconfigure.
function requireAdminOrHr(req, res, next) {
  if (!req.user || !['admin', 'hr'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Admin or HR access required.' });
  }
  next();
}

module.exports = auth;
module.exports.requireAdmin = requireAdmin;
module.exports.requireAdminOrHr = requireAdminOrHr;
