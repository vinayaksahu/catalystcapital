const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const { authenticateToken } = require('../middleware/authMiddleware');

router.post('/register', async (req, res) => {
  try {
    const { username, email, password, fullName, phone, sponsorCode } = req.body;
    const result = await authService.register({ username, email, password, fullName, phone, sponsorCode });
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { loginId, password } = req.body;
    const result = await authService.login({ loginId, password });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(401).json({ success: false, error: err.message });
  }
});

router.get('/me', authenticateToken, (req, res) => {
  res.json({ success: true, user: req.user });
});

router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { fullName, phone, email } = req.body;
    const updatedUser = await authService.updateProfile(req.user.id, { fullName, phone, email });
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
    const { walletAddress } = req.body;
    const updatedUser = await authService.updateWalletAddress(req.user.id, { walletAddress });
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
