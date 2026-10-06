const jwt = require('jsonwebtoken');
const { db } = require('../db/database');

const JWT_SECRET = process.env.JWT_SECRET || 'catalyst_capital_secret_key_2026';

async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await db.get(`
      SELECT id, username, email, full_name, role, referral_code, sponsor_id, team_admin_id, team_name,
             wallet_balance, roi_balance, commission_balance, usdt_address, status
      FROM users WHERE id = ?
    `, [decoded.id]);

    if (!user) {
      return res.status(401).json({ error: 'User no longer exists' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Account suspended. Contact support.' });
    }

    req.user = user;
    if (decoded.isImpersonation) {
      req.user.isImpersonation = true;
      req.user.impersonatedBy = decoded.impersonatedBy;
      if (decoded.role) {
        req.user.role = decoded.role;
      }
    }
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'superadmin' || req.user.isImpersonation) {
    return res.status(403).json({ error: 'Unauthorized access' });
  }
  next();
}

module.exports = { authenticateToken, requireAdmin, requireSuperAdmin, JWT_SECRET };
