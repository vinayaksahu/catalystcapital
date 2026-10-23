const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

/**
 * Robust Client IP Resolver:
 * Extracts real client IP when running behind reverse proxies like Vercel edge, Cloudflare, AWS, Nginx.
 */
function getClientIp(req) {
  // Cloudflare Connecting IP header
  const cfIp = req.headers['cf-connecting-ip'];
  if (cfIp) return (Array.isArray(cfIp) ? cfIp[0] : cfIp).trim();

  // Standard X-Forwarded-For header (First IP is the origin client)
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const list = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const clientIp = list.split(',')[0].trim();
    if (clientIp) return clientIp;
  }

  // X-Real-IP header
  const realIp = req.headers['x-real-ip'];
  if (realIp) return (Array.isArray(realIp) ? realIp[0] : realIp).trim();

  // Express resolved req.ip (with trust proxy enabled) or direct socket address
  return req.ip || req.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Global API Rate Limiter
 * 300 requests per 15 minutes per IP
 */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(getClientIp(req)),
  message: {
    success: false,
    error: 'Too many requests from this IP. Please try again after 15 minutes.'
  }
});

/**
 * Authentication & Login Rate Limiter (Brute-Force & Credential Stuffing Protection)
 * Max 10 failed attempts per 15 minutes per IP + user account.
 * 
 * Key Highlights:
 * 1. skipSuccessfulRequests: true -> Successful logins do NOT consume attempt quota!
 * 2. Keyed by (Client IP + Login ID) -> If one user or attacker types wrong credentials,
 *    other users and accounts are NOT locked out.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const clientIp = getClientIp(req);
    const normalizedIp = ipKeyGenerator(clientIp);
    const loginId = req.body && req.body.loginId ? String(req.body.loginId).trim().toLowerCase() : '';
    return loginId ? `${normalizedIp}_${loginId}` : normalizedIp;
  },
  message: {
    success: false,
    error: 'Too many authentication attempts. Please try again after 15 minutes.'
  }
});

/**
 * OTP Request Limiter (Prevents Email Bombing, Quota Exhaustion & Abuse)
 * Max 5 OTP requests per 15 minutes per IP + recipient email
 */
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const clientIp = getClientIp(req);
    const normalizedIp = ipKeyGenerator(clientIp);
    const email = req.body && req.body.email ? String(req.body.email).trim().toLowerCase() : (req.user?.email || '');
    return email ? `${normalizedIp}_${email}` : normalizedIp;
  },
  message: {
    success: false,
    error: 'Too many OTP requests. Please wait 15 minutes before requesting a new OTP.'
  }
});

/**
 * Financial Transactions Limiter (Deposits, Withdrawals, Transfers, Plan Purchases)
 * Max 25 transaction requests per 15 minutes per IP/user to prevent race conditions and transaction flooding
 */
const financialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const clientIp = getClientIp(req);
    const normalizedIp = ipKeyGenerator(clientIp);
    const userId = req.user?.id ? String(req.user.id) : '';
    return userId ? `${normalizedIp}_${userId}` : normalizedIp;
  },
  message: {
    success: false,
    error: 'Too many transaction requests submitted. Please wait a few minutes before trying again.'
  }
});

module.exports = {
  globalLimiter,
  authLimiter,
  otpLimiter,
  financialLimiter
};
