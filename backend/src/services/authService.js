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
    if (!username || !email || !password || !fullName) {
      throw new Error('All required fields must be filled');
    }

    const cleanUsername = username.trim().toLowerCase();
    const cleanEmail = email.trim().toLowerCase();

    // Check duplicate username or email
    const existing = await db.get('SELECT id FROM users WHERE username = ? OR email = ?', [cleanUsername, cleanEmail]);
    if (existing) {
      throw new Error('Username or Email already registered');
    }

    // Validate Sponsor Code
    let sponsorId = null;
    if (sponsorCode && sponsorCode.trim()) {
      const sponsor = await db.get('SELECT id FROM users WHERE referral_code = ?', [sponsorCode.trim().toUpperCase()]);
      if (sponsor) {
        sponsorId = sponsor.id;
      } else {
        throw new Error('Invalid Sponsor / Referral code');
      }
    } else {
      const admin = await db.get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
      if (admin) {
        sponsorId = admin.id;
      }
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Generate unique referral code
    let referralCode = this.generateReferralCode();
    let exists = await db.get('SELECT id FROM users WHERE referral_code = ?', [referralCode]);
    while (exists) {
      referralCode = this.generateReferralCode();
      exists = await db.get('SELECT id FROM users WHERE referral_code = ?', [referralCode]);
    }

    // Insert user
    const insert = await db.run(`
      INSERT INTO users (username, email, password_hash, full_name, phone, role, referral_code, sponsor_id, wallet_balance, roi_balance, commission_balance, status)
      VALUES (?, ?, ?, ?, ?, 'user', ?, ?, 0.0, 0.0, 0.0, 'active')
    `, [cleanUsername, cleanEmail, passwordHash, fullName.trim(), phone ? phone.trim() : null, referralCode, sponsorId]);

    const newUser = await db.get('SELECT id, username, email, full_name, phone, role, referral_code, sponsor_id, wallet_balance, roi_balance, commission_balance FROM users WHERE id = ?', [insert.lastInsertRowid]);

    const token = jwt.sign(
      { id: newUser.id, username: newUser.username, role: newUser.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return { user: newUser, token };
  }

  async login({ loginId, password, portalType = 'member' }) {
    if (!loginId || !password) {
      throw new Error('Username/Email and Password are required');
    }

    const cleanLogin = loginId.trim().toLowerCase();
    const user = await db.get(`
      SELECT * FROM users WHERE lower(username) = ? OR lower(email) = ?
    `, [cleanLogin, cleanLogin]);

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

    // Role vs Portal restriction:
    // If admin tries to login from Member portal:
    if (user.role === 'admin' && portalType !== 'admin') {
      throw new Error('Admin credentials cannot be used here. Please use the Admin Portal login page (/adminlogin).');
    }

    // If regular user tries to login from Admin portal:
    if (portalType === 'admin' && user.role !== 'admin') {
      throw new Error('Access denied. Only authorized administrators can login through this portal.');
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const { password_hash, ...safeUser } = user;
    return { user: safeUser, token };
  }

  async updateProfile(userId, { fullName, phone, email }) {
    if (!fullName || !email) {
      throw new Error('Full Name and Email are required');
    }
    const cleanEmail = email.trim().toLowerCase();
    const existing = await db.get('SELECT id FROM users WHERE lower(email) = ? AND id != ?', [cleanEmail, userId]);
    if (existing) {
      throw new Error('Email already used by another account');
    }
    await db.run(`
      UPDATE users
      SET full_name = ?, phone = ?, email = ?
      WHERE id = ?
    `, [fullName.trim(), phone ? phone.trim() : null, cleanEmail, userId]);

    const updated = await db.get(`
      SELECT id, username, email, full_name, phone, role, referral_code, sponsor_id,
             wallet_balance, roi_balance, commission_balance, usdt_address, status
      FROM users WHERE id = ?
    `, [userId]);
    return updated;
  }

  async changePassword(userId, { currentPassword, newPassword }) {
    if (!currentPassword || !newPassword) {
      throw new Error('Current password and new password are required');
    }
    if (newPassword.length < 6) {
      throw new Error('New password must be at least 6 characters');
    }
    const user = await db.get('SELECT password_hash FROM users WHERE id = ?', [userId]);
    if (!user) {
      throw new Error('User not found');
    }
    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      throw new Error('Current password is incorrect');
    }
    const salt = await bcrypt.genSalt(10);
    const newHash = await bcrypt.hash(newPassword, salt);
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, userId]);
    return { success: true, message: 'Password updated successfully' };
  }

  async updateWalletAddress(userId, { walletAddress }) {
    if (!walletAddress || !walletAddress.trim()) {
      throw new Error('Valid wallet address is required');
    }
    await db.run('UPDATE users SET usdt_address = ? WHERE id = ?', [walletAddress.trim(), userId]);
    const updated = await db.get(`
      SELECT id, username, email, full_name, phone, role, referral_code, sponsor_id,
             wallet_balance, roi_balance, commission_balance, usdt_address, status
      FROM users WHERE id = ?
    `, [userId]);
    return updated;
  }
}

module.exports = new AuthService();
