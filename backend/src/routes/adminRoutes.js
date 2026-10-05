const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const roiEngineService = require('../services/roiEngineService');
const walletService = require('../services/walletService');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');

router.use(authenticateToken);
router.use(requireAdmin);

// Platform stats
router.get('/stats', (req, res) => {
  try {
    const totalUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'user'").get().c;
    const totalInvestments = db.prepare('SELECT COUNT(*) as c, COALESCE(SUM(amount), 0) as vol FROM investments').get();
    const activeInvestments = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(amount), 0) as vol FROM investments WHERE status = 'active'").get();

    const roiPaid = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'daily_roi' AND status = 'completed'").get().total;
    const referralRoiPaid = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'referral_roi' AND status = 'completed'").get().total;
    const teamCommissionPaid = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'team_commission' AND status = 'completed'").get().total;

    const pendingWithdrawals = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(amount), 0) as vol FROM withdrawals WHERE status = 'pending'").get();
    const approvedWithdrawals = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(amount), 0) as vol FROM withdrawals WHERE status = 'approved'").get();

    res.json({
      success: true,
      stats: {
        totalUsers,
        totalInvestments: totalInvestments.c,
        totalInvestmentVolume: totalInvestments.vol,
        activeInvestments: activeInvestments.c,
        activeInvestmentVolume: activeInvestments.vol,
        totalRoiDistributed: roiPaid,
        totalReferralRoiDistributed: referralRoiPaid,
        totalTeamCommissionDistributed: teamCommissionPaid,
        totalPayouts: roiPaid + referralRoiPaid + teamCommissionPaid,
        pendingWithdrawalsCount: pendingWithdrawals.c,
        pendingWithdrawalsVolume: pendingWithdrawals.vol,
        approvedWithdrawalsCount: approvedWithdrawals.c,
        approvedWithdrawalsVolume: approvedWithdrawals.vol
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Users management list
router.get('/users', (req, res) => {
  try {
    const users = db.prepare(`
      SELECT u.id, u.username, u.email, u.full_name, u.phone, u.role, u.referral_code, u.sponsor_id,
             u.wallet_balance, u.roi_balance, u.commission_balance, u.status, u.created_at,
             s.username as sponsor_username,
             COALESCE((SELECT SUM(amount) FROM investments WHERE user_id = u.id AND status = 'active'), 0) as active_invested
      FROM users u
      LEFT JOIN users s ON u.sponsor_id = s.id
      ORDER BY u.created_at DESC
    `).all();

    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Adjust balance manually
router.post('/adjust-balance', (req, res) => {
  try {
    const { userId, amount, walletType = 'wallet_balance', action = 'credit', reason = 'Admin adjustment' } = req.body;
    const numAmount = Number(amount);

    if (numAmount <= 0) return res.status(400).json({ success: false, error: 'Amount must be > 0' });

    const delta = action === 'debit' ? -numAmount : numAmount;

    db.prepare(`UPDATE users SET ${walletType} = ${walletType} + ? WHERE id = ?`).run(delta, userId);

    db.prepare(`
      INSERT INTO transactions (user_id, amount, type, wallet_type, description, status)
      VALUES (?, ?, 'admin_adjustment', ?, ?, 'completed')
    `).run(userId, delta, walletType, `Admin Adjustment: ${action.toUpperCase()} $${numAmount} (${reason})`);

    res.json({ success: true, message: `Successfully adjusted balance by ${delta}` });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Withdrawals list
router.get('/withdrawals', (req, res) => {
  try {
    const withdrawals = db.prepare(`
      SELECT w.*, u.username, u.full_name, u.email
      FROM withdrawals w
      JOIN users u ON w.user_id = u.id
      ORDER BY w.created_at DESC
    `).all();

    res.json({ success: true, withdrawals });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Approve withdrawal
router.post('/withdrawals/:id/approve', (req, res) => {
  try {
    const { txHash, adminNote } = req.body;
    const result = walletService.approveWithdrawal(Number(req.params.id), txHash, adminNote);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Reject withdrawal
router.post('/withdrawals/:id/reject', (req, res) => {
  try {
    const { reason } = req.body;
    const result = walletService.rejectWithdrawal(Number(req.params.id), reason);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Trigger daily ROI cycle manually
router.post('/trigger-daily-roi', (req, res) => {
  try {
    const { force = true } = req.body;
    const result = roiEngineService.processDailyRoi(force);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Forecast pending daily ROI
router.get('/pending-roi-summary', (req, res) => {
  try {
    const forecast = roiEngineService.getPendingRoiSummary();
    res.json({ success: true, forecast });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// System Settings
router.get('/settings', (req, res) => {
  try {
    const settings = db.prepare('SELECT key, value FROM system_settings').all();
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/settings', (req, res) => {
  try {
    const { key, value } = req.body;
    db.prepare('INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?')
      .run(key, String(value), String(value));
    res.json({ success: true, message: 'Setting updated' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
