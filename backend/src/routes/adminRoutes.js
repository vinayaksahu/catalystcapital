const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const roiEngineService = require('../services/roiEngineService');
const walletService = require('../services/walletService');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');

router.use(authenticateToken);
router.use(requireAdmin);

// Platform stats
router.get('/stats', async (req, res) => {
  try {
    const totalUsersRow = await db.get("SELECT COUNT(*) as c FROM users WHERE role = 'user'");
    const totalUsers = totalUsersRow ? parseInt(totalUsersRow.c, 10) : 0;

    const totalInvestments = await db.get('SELECT COUNT(*) as c, COALESCE(SUM(amount), 0) as vol FROM investments');
    const activeInvestments = await db.get("SELECT COUNT(*) as c, COALESCE(SUM(amount), 0) as vol FROM investments WHERE status = 'active'");

    const roiPaidRow = await db.get("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'daily_roi' AND status = 'completed'");
    const referralRoiPaidRow = await db.get("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'referral_roi' AND status = 'completed'");
    const teamCommissionPaidRow = await db.get("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'team_commission' AND status = 'completed'");

    const roiPaid = roiPaidRow ? roiPaidRow.total : 0;
    const referralRoiPaid = referralRoiPaidRow ? referralRoiPaidRow.total : 0;
    const teamCommissionPaid = teamCommissionPaidRow ? teamCommissionPaidRow.total : 0;

    const pendingWithdrawals = await db.get("SELECT COUNT(*) as c, COALESCE(SUM(amount), 0) as vol FROM withdrawals WHERE status = 'pending'");
    const approvedWithdrawals = await db.get("SELECT COUNT(*) as c, COALESCE(SUM(amount), 0) as vol FROM withdrawals WHERE status = 'approved'");

    res.json({
      success: true,
      stats: {
        totalUsers,
        totalInvestments: totalInvestments ? parseInt(totalInvestments.c, 10) : 0,
        totalInvestmentVolume: totalInvestments ? totalInvestments.vol : 0,
        activeInvestments: activeInvestments ? parseInt(activeInvestments.c, 10) : 0,
        activeInvestmentVolume: activeInvestments ? activeInvestments.vol : 0,
        totalRoiDistributed: roiPaid,
        totalReferralRoiDistributed: referralRoiPaid,
        totalTeamCommissionDistributed: teamCommissionPaid,
        totalPayouts: roiPaid + referralRoiPaid + teamCommissionPaid,
        pendingWithdrawalsCount: pendingWithdrawals ? parseInt(pendingWithdrawals.c, 10) : 0,
        pendingWithdrawalsVolume: pendingWithdrawals ? pendingWithdrawals.vol : 0,
        approvedWithdrawalsCount: approvedWithdrawals ? parseInt(approvedWithdrawals.c, 10) : 0,
        approvedWithdrawalsVolume: approvedWithdrawals ? approvedWithdrawals.vol : 0
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Users management list
router.get('/users', async (req, res) => {
  try {
    const users = await db.all(`
      SELECT u.id, u.username, u.email, u.full_name, u.phone, u.role, u.referral_code, u.sponsor_id,
             u.wallet_balance, u.roi_balance, u.commission_balance, u.status, u.created_at,
             s.username as sponsor_username,
             COALESCE((SELECT SUM(amount) FROM investments WHERE user_id = u.id AND status = 'active'), 0) as active_invested
      FROM users u
      LEFT JOIN users s ON u.sponsor_id = s.id
      ORDER BY u.created_at DESC
    `);

    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Adjust balance manually
router.post('/adjust-balance', async (req, res) => {
  try {
    const { userId, amount, walletType = 'wallet_balance', action = 'credit', reason = 'Admin adjustment' } = req.body;
    const numAmount = Number(amount);

    if (numAmount <= 0) return res.status(400).json({ success: false, error: 'Amount must be > 0' });

    const delta = action === 'debit' ? -numAmount : numAmount;

    await db.run(`UPDATE users SET ${walletType} = ${walletType} + ? WHERE id = ?`, [delta, userId]);

    await db.run(`
      INSERT INTO transactions (user_id, amount, type, wallet_type, description, status)
      VALUES (?, ?, 'admin_adjustment', ?, ?, 'completed')
    `, [userId, delta, walletType, `Admin Adjustment: ${action.toUpperCase()} $${numAmount} (${reason})`]);

    res.json({ success: true, message: `Successfully adjusted balance by ${delta}` });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Withdrawals list
router.get('/withdrawals', async (req, res) => {
  try {
    const withdrawals = await db.all(`
      SELECT w.*, u.username, u.full_name, u.email
      FROM withdrawals w
      JOIN users u ON w.user_id = u.id
      ORDER BY w.created_at DESC
    `);

    res.json({ success: true, withdrawals });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Approve withdrawal
router.post('/withdrawals/:id/approve', async (req, res) => {
  try {
    const { txHash, adminNote } = req.body;
    const result = await walletService.approveWithdrawal(Number(req.params.id), txHash, adminNote);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Reject withdrawal
router.post('/withdrawals/:id/reject', async (req, res) => {
  try {
    const { reason } = req.body;
    const result = await walletService.rejectWithdrawal(Number(req.params.id), reason);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Trigger daily ROI cycle manually
router.post('/trigger-daily-roi', async (req, res) => {
  try {
    const { force = true } = req.body;
    const result = await roiEngineService.processDailyRoi(force);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Forecast pending daily ROI
router.get('/pending-roi-summary', async (req, res) => {
  try {
    const forecast = await roiEngineService.getPendingRoiSummary();
    res.json({ success: true, forecast });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// System Settings
router.get('/settings', async (req, res) => {
  try {
    const settings = await db.all('SELECT key, value FROM system_settings');
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/settings', async (req, res) => {
  try {
    const { key, value } = req.body;
    if (db.isPostgres) {
      await db.run(
        'INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
        [key, String(value)]
      );
    } else {
      await db.run(
        'INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?',
        [key, String(value), String(value)]
      );
    }
    res.json({ success: true, message: 'Setting updated' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
