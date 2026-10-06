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

module.exports = router;
