const { db } = require('../db/database');

function getClientIp(req) {
  if (!req) return 'unknown';
  const forwarded = req.headers ? (req.headers['x-forwarded-for'] || req.headers['x-real-ip']) : null;
  if (forwarded) {
    const list = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return list.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

class AuditService {
  async logAction({ req, userId, username, action, details, oldValue, newValue }) {
    try {
      const ip = req ? getClientIp(req) : 'unknown';
      const userAgent = req && req.headers ? req.headers['user-agent'] : null;
      const uId = userId || (req && req.user ? req.user.id : null);
      const uName = username || (req && req.user ? req.user.username : 'system');

      if (db.isPostgres) {
        await db.run(`
          INSERT INTO audit_logs (user_id, username, action, details, old_value, new_value, ip_address, user_agent)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [uId, uName, action, details || null, oldValue || null, newValue || null, ip, userAgent || null]);
      } else {
        await db.run(`
          INSERT INTO audit_logs (user_id, username, action, details, old_value, new_value, ip_address, user_agent)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [uId, uName, action, details || null, oldValue || null, newValue || null, ip, userAgent || null]);
      }
    } catch (err) {
      console.error('[AUDIT LOG ERROR]', err.message);
    }
  }
}

module.exports = new AuditService();
module.exports.getClientIp = getClientIp;