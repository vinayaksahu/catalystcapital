const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { db } = require('../db/database');
const { JWT_SECRET } = require('../middleware/authMiddleware');

class AuthService {
  generateReferralCode(prefix = 'CAT') {
    return prefix + crypto.randomBytes(3).toString('hex').toUpperCase();
  }

  async register({ username, email, password, fullName, phone, sponsorCode }) {
    // 1. Validation
    if (!username || !email || !password || !fullName) {
      throw new Error('All required fields must be filled');
    }

    const cleanUsername = username.trim().toLowerCase();
    const cleanEmail = email.trim().toLowerCase();

    // Check duplicate username or email
    const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(cleanUsername, cleanEmail);
    if (existing) {
      throw new Error('Username or Email already registered');
    }

    // 2. Validate Sponsor Code
    let sponsorId = null;
    if (sponsorCode && sponsorCode.trim()) {
      const sponsor = db.prepare('SELECT id FROM users WHERE referral_code = ?').get(sponsorCode.trim().toUpperCase());
      if (sponsor) {
        sponsorId = sponsor.id;
      } else {
        throw new Error('Invalid Sponsor / Referral code');
      }
    } else {
      // Find default admin or root user as fallback sponsor
      const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
      if (admin) {
        sponsorId = admin.id;
      }
    }

    // 3. Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 4. Generate unique referral code
    let referralCode = this.generateReferralCode();
    while (db.prepare('SELECT id FROM users WHERE referral_code = ?').get(referralCode)) {
      referralCode = this.generateReferralCode();
    }

    // 5. Insert user
    const insert = db.prepare(`
      INSERT INTO users (username, email, password_hash, full_name, phone, role, referral_code, sponsor_id, wallet_balance, roi_balance, commission_balance, status)
      VALUES (?, ?, ?, ?, ?, 'user', ?, ?, 0.0, 0.0, 0.0, 'active')
    `).run(cleanUsername, cleanEmail, passwordHash, fullName.trim(), phone ? phone.trim() : null, referralCode, sponsorId);

    const newUser = db.prepare('SELECT id, username, email, full_name, phone, role, referral_code, sponsor_id, wallet_balance, roi_balance, commission_balance FROM users WHERE id = ?').get(insert.lastInsertRowid);

    const token = jwt.sign(
      { id: newUser.id, username: newUser.username, role: newUser.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return { user: newUser, token };
  }

  async login({ loginId, password }) {
    if (!loginId || !password) {
      throw new Error('Username/Email and Password are required');
    }

    const cleanLogin = loginId.trim().toLowerCase();
    const user = db.prepare(`
      SELECT * FROM users WHERE lower(username) = ? OR lower(email) = ?
    `).get(cleanLogin, cleanLogin);

    if (!user) {
      throw new Error('Invalid credentials');
    }

    if (user.status !== 'active') {
      throw new Error('Your account is inactive or suspended');
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      throw new Error('Invalid credentials');
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const { password_hash, ...safeUser } = user;
    return { user: safeUser, token };
  }
}

module.exports = new AuthService();
