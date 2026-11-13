/**
 * Web Application Firewall (WAF) & Anti-SQL Injection Middleware
 * Protects against SQL injection probes, time-based attacks, and malicious payloads
 */

const SUSPICIOUS_PATTERNS = [
  /pg_sleep\s*\(/i,
  /\bsleep\s*\(\s*\d+\s*\)/i,
  /waitfor\s+delay\s+['"]/i,
  /benchmark\s*\(\s*\d+/i,
  /union\s+(all\s+)?select/i,
  /;\s*--/,
  /;\s*waitfor/i,
  /;\s*select/i,
  /information_schema/i,
  /'\s*or\s*'1'\s*=\s*'1/i,
  /'\s*or\s*1\s*=\s*1/i
];

function containsMaliciousPayload(value) {
  if (!value) return false;
  if (typeof value === 'string') {
    for (const pattern of SUSPICIOUS_PATTERNS) {
      if (pattern.test(value)) {
        return true;
      }
    }
  } else if (typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (containsMaliciousPayload(key) || containsMaliciousPayload(value[key])) {
        return true;
      }
    }
  }
  return false;
}

function wafMiddleware(req, res, next) {
  try {
    if (
      containsMaliciousPayload(req.body) ||
      containsMaliciousPayload(req.query) ||
      containsMaliciousPayload(req.params)
    ) {
      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
      console.warn(`🚨 [SECURITY WAF BLOCK] Blocked malicious SQLi/Probe payload from IP: ${clientIp} on ${req.method} ${req.originalUrl}`);
      return res.status(400).json({
        success: false,
        error: 'Invalid input characters or malicious payload detected.'
      });
    }
  } catch (err) {
    // If inspection fails, fail safe and continue
  }
  next();
}

module.exports = wafMiddleware;
