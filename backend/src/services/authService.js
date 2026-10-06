const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { db } = require('../db/database');
const { JWT_SECRET } = require('../middleware/authMiddleware');

const emailService = require('./emailService');
const notificationService = require('./notificationService');

// Account-level lockout protection (5 failed attempts -> 15 min lock)
const failedLoginAttemptsMap = new Map();
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

class AuthService {
  generateUserId() {
    // Generate 'CC' followed by 5 random digits (10000 - 99999)
    const randomDigits = Math.floor(10000 + Math.random() * 90000);
    return `CC${randomDigits}`;
  }

  generateReferralCode() {
    return this.generateUserId();
  }

  async register({ username, email, password, fullName, phone, sponsorCode, otp }) {
    if (!email || !password || !fullName) {
      throw new Error('All required fields must be filled');
    }

    const cleanEmail = email.trim().toLowerCase();
    let cleanUsername = (username || '').trim().toLowerCase();

    // Verify confirmation OTP if provided
    if (otp) {
      const otpVerify = await emailService.verifyOtp(cleanEmail, otp, 'registration');
      if (!otpVerify.success) {
        throw new Error(otpVerify.error || 'Invalid or expired registration OTP');
      }
    }

    // Auto-generate username from email prefix or fullName if not provided
    if (!cleanUsername) {
      const emailPrefix = cleanEmail.split('@')[0].replace(/[^a-z0-9]/g, '');
      cleanUsername = emailPrefix || ('user' + crypto.randomBytes(2).toString('hex'));

      let userExists = await db.get('SELECT id FROM users WHERE lower(username) = ?', [cleanUsername]);
      let counter = 1;
      while (userExists) {
        const candidate = `${cleanUsername}${counter}`;
        userExists = await db.get('SELECT id FROM users WHERE lower(username) = ?', [candidate]);
        if (!userExists) {
          cleanUsername = candidate;
          break;
        }
        counter++;
      }
    } else {
      // Check duplicate username if provided
      const existing = await db.get('SELECT id FROM users WHERE lower(username) = ?', [cleanUsername]);
      if (existing) {
        throw new Error('Username already registered');
      }
    }

    // Check duplicate email
    const existing = await db.get('SELECT id FROM users WHERE lower(email) = ?', [cleanEmail]);
    if (existing) {
      throw new Error('Email already registered');
    }

    // Validate Sponsor Code
    let sponsorId = null;
    if (sponsorCode && sponsorCode.trim()) {
      const sponsor = await db.get('SELECT id FROM users WHERE upper(referral_code) = ?', [sponsorCode.trim().toUpperCase()]);
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

    // Generate unique USERID (CC followed by 5 digits, e.g. CC56754)
    let userIdCode = this.generateUserId();
    let exists = await db.get('SELECT id FROM users WHERE referral_code = ?', [userIdCode]);
    while (exists) {
      userIdCode = this.generateUserId();
      exists = await db.get('SELECT id FROM users WHERE referral_code = ?', [userIdCode]);
    }

    // Insert user
    const insert = await db.run(`
      INSERT INTO users (username, email, password_hash, full_name, phone, role, referral_code, sponsor_id, wallet_balance, roi_balance, commission_balance, status)
      VALUES (?, ?, ?, ?, ?, 'user', ?, ?, 0.0, 0.0, 0.0, 'active')
    `, [cleanUsername, cleanEmail, passwordHash, fullName.trim(), phone ? phone.trim() : null, userIdCode, sponsorId]);

    const newUser = await db.get('SELECT id, username, email, full_name, phone, role, referral_code, sponsor_id, wallet_balance, roi_balance, commission_balance FROM users WHERE id = ?', [insert.lastInsertRowid]);

    // Send Welcome Credentials Email with Member USERID and Password
    try {
      await emailService.sendWelcomeCredentials({
        to: cleanEmail,
        fullName: fullName.trim(),
        username: cleanUsername,
        userId: userIdCode,
        password: password,
        referralCode: userIdCode
      });
    } catch (mailErr) {
      console.error('Failed to send welcome credentials mail:', mailErr.message);
    }

    // Welcome Notification for New User
    await notificationService.createNotification({
      userId: newUser.id,
      type: 'welcome',
      title: 'Welcome to Catalyst Capital!',
      message: `Account activated successfully. Your Member ID is ${userIdCode}. Start trading or stake a VIP plan to earn daily ROI!`,
      referenceId: userIdCode
    });

    // Notify Sponsor if exists
    if (sponsorId) {
      await notificationService.createNotification({
        userId: sponsorId,
        type: 'referral',
        title: 'New Team Member Joined!',
        message: `${newUser.full_name} (@${newUser.username}) joined your team with User ID ${userIdCode}.`,
        referenceId: userIdCode
      });
    }

    // Notify Admins about new registration
    await notificationService.notifyAdmins({
      type: 'user',
      title: 'New Member Registered!',
      message: `${newUser.full_name || newUser.username} (@${newUser.username}, ID: ${userIdCode}) registered on platform.`,
      referenceId: userIdCode
    });

    const token = jwt.sign(
      { id: newUser.id, username: newUser.username, role: newUser.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return { user: newUser, token, memberUserId: userIdCode };
  }

  async login({ loginId, password, portalType = 'member' }) {
    if (!loginId || !password) {
      throw new Error('Username, User ID or Email and Password are required');
    }

    const cleanLogin = loginId.trim().toLowerCase();
    const cleanUpper = loginId.trim().toUpperCase();

    // Check account lockout
    const now = Date.now();
    const lockKey = cleanLogin;
    const existingLock = failedLoginAttemptsMap.get(lockKey);

    if (existingLock && existingLock.lockedUntil && existingLock.lockedUntil > now) {
      const remainingMinutes = Math.ceil((existingLock.lockedUntil - now) / 60000);
      throw new Error(`Account temporarily locked due to multiple failed login attempts. Please try again in ${remainingMinutes} minute(s) or reset your password.`);
    }

    const user = await db.get(`
      SELECT * FROM users
      WHERE lower(username) = ? OR lower(email) = ? OR upper(referral_code) = ?
    `, [cleanLogin, cleanLogin, cleanUpper]);

    const handleFailedAttempt = () => {
      const current = failedLoginAttemptsMap.get(lockKey) || { count: 0, firstAttemptAt: now };
      if (now - current.firstAttemptAt > LOCKOUT_DURATION_MS) {
        current.count = 0;
        current.firstAttemptAt = now;
      }
      current.count += 1;
      if (current.count >= MAX_FAILED_ATTEMPTS) {
        current.lockedUntil = now + LOCKOUT_DURATION_MS;
        failedLoginAttemptsMap.set(lockKey, current);
        throw new Error('Too many failed login attempts. Account temporarily locked for 15 minutes.');
      } else {
        failedLoginAttemptsMap.set(lockKey, current);
        const remaining = MAX_FAILED_ATTEMPTS - current.count;
        throw new Error(`Invalid credentials. (${remaining} attempt(s) remaining before temporary lockout)`);
      }
    };

    if (!user) {
      handleFailedAttempt();
    }

    if (user.status !== 'active') {
      throw new Error('Your account is inactive or suspended');
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      handleFailedAttempt();
    }

    // Credentials verified! Reset any failed attempts
    failedLoginAttemptsMap.delete(lockKey);

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

  async updateProfile(userId, { fullName, phone, newEmail, otp }) {
    if (!fullName || !fullName.trim()) {
      throw new Error('Full Name is required');
    }

    const currentUser = await db.get('SELECT email FROM users WHERE id = ?', [userId]);
    if (!currentUser) {
      throw new Error('User not found');
    }

    let cleanNewEmail = newEmail ? newEmail.trim().toLowerCase() : null;
    let emailToUpdate = currentUser.email;

    // If user is attempting to change their email address
    if (cleanNewEmail && cleanNewEmail !== currentUser.email.toLowerCase()) {
      if (!cleanNewEmail.includes('@') || !cleanNewEmail.includes('.')) {
        throw new Error('Please enter a valid new email address');
      }

      const existing = await db.get('SELECT id FROM users WHERE lower(email) = ? AND id != ?', [cleanNewEmail, userId]);
      if (existing) {
        throw new Error('This new email is already registered to another account');
      }

      if (!otp || !String(otp).trim()) {
        throw new Error('Security verification required: Please enter the OTP sent to your old registered email address');
      }

      const otpVerify = await emailService.verifyOtp(currentUser.email, otp, 'email_change');
      if (!otpVerify.success) {
        throw new Error(otpVerify.error || 'Invalid or expired OTP code sent to your old email');
      }

      emailToUpdate = cleanNewEmail;
    }

    await db.run(`
      UPDATE users
      SET full_name = ?, phone = ?, email = ?
      WHERE id = ?
    `, [fullName.trim(), phone ? phone.trim() : null, emailToUpdate, userId]);

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

  async resetPasswordWithOtp({ email, otp, newPassword }) {
    if (!email || !otp || !newPassword) {
      throw new Error('Email, OTP code and new password are required');
    }
    if (newPassword.length < 6) {
      throw new Error('New password must be at least 6 characters');
    }

    const cleanEmail = email.trim().toLowerCase();
    const otpVerify = await emailService.verifyOtp(cleanEmail, otp, 'forgot_password');
    if (!otpVerify.success) {
      throw new Error(otpVerify.error || 'Invalid or expired OTP code');
    }

    const user = await db.get('SELECT id FROM users WHERE lower(email) = ?', [cleanEmail]);
    if (!user) {
      throw new Error('No user found with this email address');
    }

    const salt = await bcrypt.genSalt(10);
    const newHash = await bcrypt.hash(newPassword, salt);
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, user.id]);

    return { success: true, message: 'Password reset successfully! You can now login with your new password.' };
  }

  async updateWalletAddress(userId, { walletAddress, otp }) {
    if (!walletAddress || !walletAddress.trim()) {
      throw new Error('Valid BEP-20 wallet address is required');
    }

    const cleanAddr = walletAddress.trim();
    if (!cleanAddr.startsWith('0x') || cleanAddr.length < 10) {
      throw new Error('Wallet address must be a valid BEP-20 address starting with 0x');
    }

    const user = await db.get('SELECT id, email, role FROM users WHERE id = ?', [userId]);
    if (!user) {
      throw new Error('User not found');
    }

    const isAdmin = user.role === 'admin' || user.id === 1;

    // For regular users, OTP is required. For admin, check OTP if provided
    if (!isAdmin || otp) {
      if (!otp) {
        throw new Error('Email OTP code is required to update BEP-20 wallet address');
      }
      const otpVerify = await emailService.verifyOtp(user.email, otp, 'wallet_update');
      if (!otpVerify.success) {
        throw new Error(otpVerify.error || 'Invalid or expired OTP code');
      }
    }

    await db.run('UPDATE users SET usdt_address = ? WHERE id = ?', [cleanAddr, userId]);

    // If user is admin, also automatically update the platform official deposit address
    if (isAdmin) {
      if (db.isPostgres) {
        await db.run(
          'INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
          ['usdt_deposit_address', cleanAddr]
        );
      } else {
        await db.run(
          'INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?',
          ['usdt_deposit_address', cleanAddr, cleanAddr]
        );
      }
    }

    const updated = await db.get(`
      SELECT id, username, email, full_name, phone, role, referral_code, sponsor_id,
             wallet_balance, roi_balance, commission_balance, usdt_address, status
      FROM users WHERE id = ?
    `, [userId]);
    return updated;
  }
}

module.exports = new AuthService();
