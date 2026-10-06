const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const roiEngineService = require('../services/roiEngineService');
const walletService = require('../services/walletService');
const notificationService = require('../services/notificationService');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');

router.use(authenticateToken);
router.use(requireAdmin);



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

    await notificationService.createNotification({
      userId,
      type: 'adjustment',
      title: `Balance ${action === 'debit' ? 'Debited' : 'Credited'} by Admin`,
      message: `${action === 'debit' ? '-' : '+'}$${numAmount} USDT adjusted in your ${walletType.replace('_', ' ')} (${reason}).`,
      amount: delta
    });

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

// Enhanced Platform Stats (Total Business, Deposits, Withdrawals, Users, ROI)
router.get('/stats', async (req, res) => {
  try {
    const totalUsersRow = await db.get("SELECT COUNT(*) as c FROM users WHERE role = 'user'");
    const totalUsers = totalUsersRow ? parseInt(totalUsersRow.c, 10) : 0;

    const totalInvestments = await db.get('SELECT COUNT(*) as c, COALESCE(SUM(amount), 0) as vol FROM investments');
    const activeInvestments = await db.get("SELECT COUNT(*) as c, COALESCE(SUM(amount), 0) as vol FROM investments WHERE status = 'active'");

    // Total Business = all completed deposits + all active & completed investments volume
    const totalDepositsCompleted = await db.get("SELECT COUNT(*) as c, COALESCE(SUM(amount), 0) as vol FROM deposits WHERE status = 'completed'");
    const pendingDeposits = await db.get("SELECT COUNT(*) as c, COALESCE(SUM(amount), 0) as vol FROM deposits WHERE status = 'pending'");

    const roiPaidRow = await db.get("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'daily_roi' AND status = 'completed'");
    const referralRoiPaidRow = await db.get("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'referral_roi' AND status = 'completed'");
    const teamCommissionPaidRow = await db.get("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'team_commission' AND status = 'completed'");

    const roiPaid = roiPaidRow ? roiPaidRow.total : 0;
    const referralRoiPaid = referralRoiPaidRow ? referralRoiPaidRow.total : 0;
    const teamCommissionPaid = teamCommissionPaidRow ? teamCommissionPaidRow.total : 0;

    const pendingWithdrawals = await db.get("SELECT COUNT(*) as c, COALESCE(SUM(amount), 0) as vol FROM withdrawals WHERE status = 'pending'");
    const approvedWithdrawals = await db.get("SELECT COUNT(*) as c, COALESCE(SUM(amount), 0) as vol FROM withdrawals WHERE status = 'approved'");

    const openTicketsRow = await db.get("SELECT COUNT(*) as c FROM support_tickets WHERE status = 'open'");

    const totalInvestmentVol = totalInvestments ? totalInvestments.vol : 0;
    const totalDepositVol = totalDepositsCompleted ? totalDepositsCompleted.vol : 0;
    const totalBusiness = Math.max(totalInvestmentVol, totalDepositVol);

    res.json({
      success: true,
      stats: {
        totalUsers,
        totalBusiness,
        totalDepositsVolume: totalDepositVol,
        totalDepositsCount: totalDepositsCompleted ? parseInt(totalDepositsCompleted.c, 10) : 0,
        pendingDepositsCount: pendingDeposits ? parseInt(pendingDeposits.c, 10) : 0,
        pendingDepositsVolume: pendingDeposits ? pendingDeposits.vol : 0,
        totalInvestments: totalInvestments ? parseInt(totalInvestments.c, 10) : 0,
        totalInvestmentVolume: totalInvestmentVol,
        activeInvestments: activeInvestments ? parseInt(activeInvestments.c, 10) : 0,
        activeInvestmentVolume: activeInvestments ? activeInvestments.vol : 0,
        totalRoiDistributed: roiPaid,
        totalReferralRoiDistributed: referralRoiPaid,
        totalTeamCommissionDistributed: teamCommissionPaid,
        totalPayouts: roiPaid + referralRoiPaid + teamCommissionPaid,
        pendingWithdrawalsCount: pendingWithdrawals ? parseInt(pendingWithdrawals.c, 10) : 0,
        pendingWithdrawalsVolume: pendingWithdrawals ? pendingWithdrawals.vol : 0,
        approvedWithdrawalsCount: approvedWithdrawals ? parseInt(approvedWithdrawals.c, 10) : 0,
        approvedWithdrawalsVolume: approvedWithdrawals ? approvedWithdrawals.vol : 0,
        openTicketsCount: openTicketsRow ? parseInt(openTicketsRow.c, 10) : 0
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Impersonate any user: generates a JWT for that user so admin can view/act as their portal
router.post('/impersonate/:id', async (req, res) => {
  try {
    const targetUser = await db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!targetUser) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    if (targetUser.role === 'admin') {
      return res.status(400).json({ success: false, error: 'Cannot open portal for administrator account' });
    }

    const { JWT_SECRET } = require('../middleware/authMiddleware');
    const jwt = require('jsonwebtoken');

    const impersonationToken = jwt.sign(
      { id: targetUser.id, username: targetUser.username, role: targetUser.role, impersonatedBy: req.user.username },
      JWT_SECRET,
      { expiresIn: '2h' }
    );

    res.json({
      success: true,
      token: impersonationToken,
      user: {
        id: targetUser.id,
        username: targetUser.username,
        email: targetUser.email,
        full_name: targetUser.full_name,
        role: targetUser.role,
        referral_code: targetUser.referral_code,
        wallet_balance: targetUser.wallet_balance,
        roi_balance: targetUser.roi_balance,
        commission_balance: targetUser.commission_balance,
        status: targetUser.status
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// View specific user's comprehensive portfolio details
router.get('/users/:id/details', async (req, res) => {
  try {
    const user = await db.get(`
      SELECT u.*, s.username as sponsor_username, s.full_name as sponsor_name
      FROM users u
      LEFT JOIN users s ON u.sponsor_id = s.id
      WHERE u.id = ?
    `, [req.params.id]);

    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const investments = await db.all(`
      SELECT i.*, p.name as plan_name
      FROM investments i
      JOIN plans p ON i.plan_id = p.id
      WHERE i.user_id = ?
      ORDER BY i.created_at DESC
    `, [req.params.id]);

    const deposits = await db.all('SELECT * FROM deposits WHERE user_id = ? ORDER BY created_at DESC', [req.params.id]);
    const withdrawals = await db.all('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC', [req.params.id]);
    const directReferrals = await db.all('SELECT id, username, full_name, email, wallet_balance, status, created_at FROM users WHERE sponsor_id = ?', [req.params.id]);

    res.json({
      success: true,
      user,
      investments,
      deposits,
      withdrawals,
      directReferrals
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Manage User Status (active, suspended)
router.post('/users/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'suspended', 'inactive'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }
    await db.run('UPDATE users SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ success: true, message: `User status changed to ${status}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Deposits List
router.get('/deposits', async (req, res) => {
  try {
    const deposits = await db.all(`
      SELECT d.*, u.username, u.full_name, u.email
      FROM deposits d
      JOIN users u ON d.user_id = u.id
      ORDER BY d.created_at DESC
    `);
    res.json({ success: true, deposits });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Approve Manual Deposit (Credits user wallet_balance if pending)
router.post('/deposits/:id/approve', async (req, res) => {
  try {
    const deposit = await db.get('SELECT * FROM deposits WHERE id = ?', [req.params.id]);
    if (!deposit) return res.status(404).json({ success: false, error: 'Deposit record not found' });
    if (deposit.status === 'completed') return res.status(400).json({ success: false, error: 'Deposit already completed' });

    await db.run("UPDATE deposits SET status = 'completed' WHERE id = ?", [req.params.id]);
    await db.run('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [deposit.amount, deposit.user_id]);

    // Update existing pending transaction or insert completed one
    const existingTx = deposit.tx_hash ? await db.get("SELECT id FROM transactions WHERE reference_id = ? AND user_id = ?", [deposit.tx_hash, deposit.user_id]) : null;
    if (existingTx) {
      await db.run("UPDATE transactions SET status = 'completed', description = ? WHERE id = ?", [`Deposit Approved by Admin ($${deposit.amount})`, existingTx.id]);
    } else {
      await db.run(`
        INSERT INTO transactions (user_id, amount, type, wallet_type, description, reference_id, status)
        VALUES (?, ?, 'deposit', 'wallet_balance', ?, ?, 'completed')
      `, [deposit.user_id, deposit.amount, `Deposit Approved by Admin ($${deposit.amount})`, deposit.tx_hash || `DEP-${deposit.id}`]);
    }

    // Deposit Approved Notification
    await notificationService.createNotification({
      userId: deposit.user_id,
      type: 'deposit',
      title: 'Deposit Approved & Credited!',
      message: `Your deposit of $${deposit.amount} USDT has been approved and credited to your Recharge Balance.`,
      amount: deposit.amount,
      referenceId: deposit.tx_hash || `DEP-${deposit.id}`
    });

    res.json({ success: true, message: `Deposit #${deposit.id} approved and credited` });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Reject Manual Deposit
router.post('/deposits/:id/reject', async (req, res) => {
  try {
    const { reason = 'Invalid transaction hash / Rejected by Admin' } = req.body;
    const deposit = await db.get('SELECT * FROM deposits WHERE id = ?', [req.params.id]);
    if (!deposit) return res.status(404).json({ success: false, error: 'Deposit record not found' });
    if (deposit.status === 'completed') return res.status(400).json({ success: false, error: 'Completed deposits cannot be rejected' });

    await db.run("UPDATE deposits SET status = 'rejected' WHERE id = ?", [req.params.id]);
    if (deposit.tx_hash) {
      await db.run("UPDATE transactions SET status = 'failed', description = ? WHERE reference_id = ? AND user_id = ?", [`Deposit Rejected by Admin (${reason})`, deposit.tx_hash, deposit.user_id]);
    }

    // Deposit Rejected Notification
    await notificationService.createNotification({
      userId: deposit.user_id,
      type: 'deposit',
      title: 'Deposit Verification Failed',
      message: `Your deposit request of $${deposit.amount} USDT was rejected (${reason}).`,
      amount: deposit.amount,
      referenceId: deposit.tx_hash
    });

    res.json({ success: true, message: `Deposit #${deposit.id} rejected (${reason})` });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Manual Deposit Injection (Admin directly adds deposit for any user)
router.post('/deposits/manual-create', async (req, res) => {
  try {
    const { userId, amount, network = 'USDT-BEP20', txHash } = req.body;
    const numAmount = Number(amount);
    if (!userId || numAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Valid userId and amount required' });
    }

    const cleanHash = txHash || 'ADMIN-DEP-' + Math.random().toString(36).substring(2, 10).toUpperCase();

    const insert = await db.run(`
      INSERT INTO deposits (user_id, amount, network, tx_hash, status)
      VALUES (?, ?, ?, ?, 'completed')
    `, [userId, numAmount, network, cleanHash]);

    await db.run('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [numAmount, userId]);

    await db.run(`
      INSERT INTO transactions (user_id, amount, type, wallet_type, description, reference_id, status)
      VALUES (?, ?, 'deposit', 'wallet_balance', ?, ?, 'completed')
    `, [userId, numAmount, `Manual Deposit Credited by Admin via ${network}`, cleanHash]);

    // Manual Deposit Notification
    await notificationService.createNotification({
      userId,
      type: 'deposit',
      title: 'Deposit Credited by Admin!',
      message: `+$${numAmount.toFixed(2)} USDT deposit credited to your Recharge Balance via ${network}.`,
      amount: numAmount,
      referenceId: cleanHash
    });

    res.json({ success: true, message: `Credited $${numAmount} USDT deposit to user #${userId}`, depositId: insert.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Support Tickets: Admin List & Reply
router.get('/tickets', async (req, res) => {
  try {
    const tickets = await db.all(`
      SELECT t.*, u.username, u.full_name, u.email
      FROM support_tickets t
      JOIN users u ON t.user_id = u.id
      ORDER BY t.created_at DESC
    `);
    res.json({ success: true, tickets });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/tickets/:id/reply', async (req, res) => {
  try {
    const { reply, status = 'resolved' } = req.body;
    if (!reply) return res.status(400).json({ success: false, error: 'Reply text required' });

    const nowExpr = db.isPostgres ? 'CURRENT_TIMESTAMP' : "datetime('now')";
    await db.run(`
      UPDATE support_tickets
      SET admin_reply = ?, status = ?, updated_at = ${nowExpr}
      WHERE id = ?
    `, [reply.trim(), status, req.params.id]);

    res.json({ success: true, message: 'Reply sent and ticket updated' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
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
    const { key, value, settings } = req.body;

    // Support batch saving multiple settings in one single fast transaction
    if (settings && typeof settings === 'object') {
      for (const [k, v] of Object.entries(settings)) {
        if (db.isPostgres) {
          await db.run(
            'INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
            [k, String(v)]
          );
        } else {
          await db.run(
            'INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?',
            [k, String(v), String(v)]
          );
        }
      }
      return res.json({ success: true, message: 'Settings updated successfully' });
    }

    if (!key) return res.status(400).json({ success: false, error: 'Key is required' });

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
