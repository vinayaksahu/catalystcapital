const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const mlmService = require('../services/mlmService');
const { authenticateToken } = require('../middleware/authMiddleware');

// Get downline stats (Level 1, 2, 3 counts and volumes)
router.get('/downline-stats', authenticateToken, async (req, res) => {
  try {
    const stats = await mlmService.getDownlineStats(req.user.id);
    res.json({ success: true, ...stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get MLM downline tree hierarchy for visual graph
router.get('/tree', authenticateToken, async (req, res) => {
  try {
    const tree = await mlmService.getUserTreeNode(req.user.id, 3);
    res.json({ success: true, tree });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get direct referrals list with active investments
router.get('/direct-referrals', authenticateToken, async (req, res) => {
  try {
    const referrals = await db.all(`
      SELECT u.id, u.username, u.full_name, u.email, u.phone, u.status, u.created_at,
             COALESCE((SELECT SUM(amount) FROM investments WHERE user_id = u.id AND status = 'active'), 0) as active_investment,
             COALESCE((SELECT SUM(amount) FROM transactions WHERE user_id = ? AND from_user_id = u.id), 0) as total_commission_from_user
      FROM users u
      WHERE u.sponsor_id = ?
      ORDER BY u.created_at DESC
    `, [req.user.id, req.user.id]);

    res.json({ success: true, referrals });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
