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

module.exports = router;
