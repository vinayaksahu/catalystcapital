const rateLimit = require('express-rate-limit');

/**
 * Global API Rate Limiter
 * 300 requests per 15 minutes per IP
 */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests from this IP. Please try again after 15 minutes.'
  }
});

/**
 * Authentication & Login Rate Limiter (Brute-Force & Credential Stuffing Protection)
 * Max 10 attempts per 15 minutes per IP
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many authentication attempts from this IP. Please try again after 15 minutes.'
  }
});

/**
 * OTP Request Limiter (Prevents Email Bombing, Quota Exhaustion & Abuse)
 * Max 5 OTP requests per 15 minutes per IP
 */
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many OTP requests. Please wait 15 minutes before requesting a new OTP.'
  }
});

/**
 * Financial Transactions Limiter (Deposits, Withdrawals, Transfers, Plan Purchases)
 * Max 25 transaction requests per 15 minutes per IP to prevent race conditions and transaction flooding
 */
const financialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
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
