const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const { authenticateToken } = require('../middleware/authMiddleware');
const emailService = require('../services/emailService');

// Public Announcement & Pop Image Ticker Endpoint
router.get('/announcements', async (req, res) => {
  try {
    const { db } = require('../db/database');
    const settingsRows = await db.all('SELECT key, value FROM system_settings');
    const settings = settingsRows.reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});

    res.json({
      success: true,
      announcementTicker: settings.announcement_ticker || 'Welcome to the official Catalyst Capital trading platform • High Frequency AI Trading • Instant 0% Withdrawal Payouts • Daily ROI Active •',
      popupImageUrl: settings.popup_image_url || '',
      popupImageActive: settings.popup_image_active === '1' || settings.popup_image_active === 'true',
      popupImageTitle: settings.popup_image_title || 'Special Platform Announcement'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Send Email OTP (for registration, forgot_password, or wallet_update)
router.post('/send-otp', async (req, res) => {
  try {
    const { email, purpose = 'registration' } = req.body;
    if (!email || !email.trim()) {
      return res.status(400).json({ success: false, error: 'Email address is required' });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Validations based on purpose
    if (purpose === 'registration') {
      const { db } = require('../db/database');
      const existing = await db.get('SELECT id FROM users WHERE lower(email) = ?', [cleanEmail]);
      if (existing) {
        return res.status(400).json({ success: false, error: 'Email is already registered. Please login or reset password.' });
      }
    } else if (purpose === 'forgot_password') {
      const { db } = require('../db/database');
      const existing = await db.get('SELECT id FROM users WHERE lower(email) = ?', [cleanEmail]);
      if (!existing) {
        return res.status(400).json({ success: false, error: 'No account found with this email address.' });
      }
    }

    const result = await emailService.createAndSendOtp(cleanEmail, purpose);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Member requesting OTP for BEP-20 wallet address change
router.post('/wallet-address/send-otp', authenticateToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    if (!userEmail) {
      return res.status(400).json({ success: false, error: 'User does not have a registered email' });
    }
    const result = await emailService.createAndSendOtp(userEmail, 'wallet_update');
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reset password with OTP
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    const result = await authService.resetPasswordWithOtp({ email, otp, newPassword });
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/register', async (req, res) => {
  try {
    const { username, email, password, fullName, phone, sponsorCode, otp } = req.body;
    const result = await authService.register({ username, email, password, fullName, phone, sponsorCode, otp });
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { loginId, password, portalType } = req.body;
    const result = await authService.login({ loginId, password, portalType });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(401).json({ success: false, error: err.message });
  }
});

router.get('/me', authenticateToken, (req, res) => {
  res.json({ success: true, user: req.user });
});

// Member requesting OTP for Email Address change (sent to their current/old email)
router.post('/email/send-change-otp', authenticateToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    if (!userEmail) {
      return res.status(400).json({ success: false, error: 'User does not have a registered email address' });
    }
    const result = await emailService.createAndSendOtp(userEmail, 'email_change');
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { fullName, phone, email, otp } = req.body;
    const updatedUser = await authService.updateProfile(req.user.id, { fullName, phone, newEmail: email, otp });
    res.json({ success: true, user: updatedUser });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const result = await authService.changePassword(req.user.id, { currentPassword, newPassword });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/wallet-address', authenticateToken, async (req, res) => {
  try {
    const { walletAddress, otp } = req.body;
    const updatedUser = await authService.updateWalletAddress(req.user.id, { walletAddress, otp });
    res.json({ success: true, user: updatedUser });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Member Support Tickets
router.get('/tickets', authenticateToken, async (req, res) => {
  try {
    const { db } = require('../db/database');
    const tickets = await db.all('SELECT * FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);
    res.json({ success: true, tickets });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/tickets', authenticateToken, async (req, res) => {
  try {
    const { subject, category = 'General', message } = req.body;
    if (!subject || !message) {
      return res.status(400).json({ success: false, error: 'Subject and message are required' });
    }
    const { db } = require('../db/database');
    const insert = await db.run(`
      INSERT INTO support_tickets (user_id, subject, category, message, status)
      VALUES (?, ?, ?, ?, 'open')
    `, [req.user.id, subject.trim(), category.trim(), message.trim()]);
    res.json({ success: true, message: 'Support ticket submitted successfully!', ticketId: insert.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
