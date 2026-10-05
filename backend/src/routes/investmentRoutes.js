const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const walletService = require('../services/walletService');
const { authenticateToken } = require('../middleware/authMiddleware');

// Get all available investment plans
router.get('/plans', async (req, res) => {
  try {
    const plans = await db.all('SELECT * FROM plans WHERE is_active = 1 ORDER BY price ASC');
    res.json({ success: true, plans });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Purchase / Activate a plan
router.post('/purchase', authenticateToken, async (req, res) => {
  try {
    const { planId } = req.body;
    if (!planId) {
      return res.status(400).json({ success: false, error: 'planId is required' });
    }

    const result = await walletService.purchasePlan(req.user.id, Number(planId));
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Get user's own investments
router.get('/my', authenticateToken, async (req, res) => {
  try {
    const investments = await db.all(`
      SELECT i.*, p.name as plan_name, p.color as plan_color
      FROM investments i
      JOIN plans p ON i.plan_id = p.id
      WHERE i.user_id = ?
      ORDER BY i.created_at DESC
    `, [req.user.id]);

    const activeCount = investments.filter(i => i.status === 'active').length;
    const totalInvested = investments.reduce((acc, i) => acc + i.amount, 0);
    const totalEarned = investments.reduce((acc, i) => acc + i.total_earned, 0);
    const expectedDailyRoi = investments
      .filter(i => i.status === 'active')
      .reduce((acc, i) => acc + i.daily_roi, 0);

    res.json({
      success: true,
      stats: {
        totalInvested,
        activeCount,
        totalEarned,
        expectedDailyRoi
      },
      investments
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
