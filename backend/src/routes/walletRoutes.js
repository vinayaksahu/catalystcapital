const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const walletService = require('../services/walletService');
const { authenticateToken } = require('../middleware/authMiddleware');

// Get wallet overview & balances
router.get('/overview', authenticateToken, async (req, res) => {
  try {
    const user = await db.get(`
      SELECT wallet_balance, roi_balance, commission_balance, usdt_address
      FROM users WHERE id = ?
    `, [req.user.id]);

    const totalEarnedRes = await db.get(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM transactions
      WHERE user_id = ? AND type IN ('daily_roi', 'referral_roi', 'team_commission') AND status = 'completed'
    `, [req.user.id]);

    const totalWithdrawnRes = await db.get(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM withdrawals
      WHERE user_id = ? AND status = 'approved'
    `, [req.user.id]);

    const pendingWithdrawnRes = await db.get(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM withdrawals
      WHERE user_id = ? AND status = 'pending'
    `, [req.user.id]);

    const settingsRows = await db.all('SELECT key, value FROM system_settings');
    const settings = settingsRows.reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});

    res.json({
      success: true,
      wallets: {
        depositWallet: user.wallet_balance || 0,
        roiWallet: user.roi_balance || 0,
        commissionWallet: user.commission_balance || 0,
        totalWithdrawable: (user.roi_balance || 0) + (user.commission_balance || 0),
        totalEarned: totalEarnedRes ? totalEarnedRes.total : 0,
        totalWithdrawn: totalWithdrawnRes ? totalWithdrawnRes.total : 0,
        pendingWithdrawn: pendingWithdrawnRes ? pendingWithdrawnRes.total : 0,
        savedUsdtAddress: user.usdt_address
      },
      rules: {
        minWithdrawal: parseFloat(settings.min_withdrawal || '15'),
        withdrawalFee: parseFloat(settings.withdrawal_fee_percent || '0'),
        processingTime: settings.withdrawal_processing_time || '0 - 24 Hours',
        depositAddress: settings.usdt_deposit_address || 'TYDzsXDvGgT3vXkX7q5sK8y1jN9pLmQ6wZ'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Deposit USDT
router.post('/deposit', authenticateToken, async (req, res) => {
  try {
    const { amount, network, txHash } = req.body;
    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, error: 'Valid deposit amount required' });
    }

    const result = await walletService.deposit(req.user.id, Number(amount), network, txHash);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Reinvestment Transfer (ROI or Commission wallet -> Deposit wallet)
router.post('/transfer', authenticateToken, async (req, res) => {
  try {
    const { amount, fromWallet } = req.body;
    const result = await walletService.transferEarningsToDepositWallet(req.user.id, Number(amount), fromWallet);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Request Withdrawal (Min 15 USDT, 0% Fee, 0-24hr)
router.post('/withdraw', authenticateToken, async (req, res) => {
  try {
    const { amount, usdtAddress, network, walletSource } = req.body;
    const result = await walletService.requestWithdrawal(req.user.id, {
      amount: Number(amount),
      usdtAddress,
      network,
      walletSource
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Transaction History
router.get('/transactions', authenticateToken, async (req, res) => {
  try {
    const { type, limit = 50 } = req.query;
    let query = 'SELECT * FROM transactions WHERE user_id = ?';
    const params = [req.user.id];

    if (type && type !== 'all') {
      query += ' AND type = ?';
      params.push(type);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(Number(limit));

    const transactions = await db.all(query, params);
    res.json({ success: true, transactions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// User Withdrawal History
router.get('/withdrawals', authenticateToken, async (req, res) => {
  try {
    const withdrawals = await db.all(`
      SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC
    `, [req.user.id]);
    res.json({ success: true, withdrawals });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
