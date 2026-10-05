const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const walletService = require('../services/walletService');
const { authenticateToken } = require('../middleware/authMiddleware');

// Get wallet overview & balances
router.get('/overview', authenticateToken, (req, res) => {
  try {
    const user = db.prepare(`
      SELECT wallet_balance, roi_balance, commission_balance, usdt_address
      FROM users WHERE id = ?
    `).get(req.user.id);

    const totalEarnedRes = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM transactions
      WHERE user_id = ? AND type IN ('daily_roi', 'referral_roi', 'team_commission') AND status = 'completed'
    `).get(req.user.id);

    const totalWithdrawnRes = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM withdrawals
      WHERE user_id = ? AND status = 'approved'
    `).get(req.user.id);

    const pendingWithdrawnRes = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM withdrawals
      WHERE user_id = ? AND status = 'pending'
    `).get(req.user.id);

    // Get system settings for display (min_withdrawal, fee, deposit address)
    const settingsRows = db.prepare('SELECT key, value FROM system_settings').all();
    const settings = settingsRows.reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});

    res.json({
      success: true,
      wallets: {
        depositWallet: user.wallet_balance,
        roiWallet: user.roi_balance,
        commissionWallet: user.commission_balance,
        totalWithdrawable: user.roi_balance + user.commission_balance,
        totalEarned: totalEarnedRes.total,
        totalWithdrawn: totalWithdrawnRes.total,
        pendingWithdrawn: pendingWithdrawnRes.total,
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
router.post('/deposit', authenticateToken, (req, res) => {
  try {
    const { amount, network, txHash } = req.body;
    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, error: 'Valid deposit amount required' });
    }

    const result = walletService.deposit(req.user.id, Number(amount), network, txHash);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Reinvestment Transfer (ROI or Commission wallet -> Deposit wallet)
router.post('/transfer', authenticateToken, (req, res) => {
  try {
    const { amount, fromWallet } = req.body;
    const result = walletService.transferEarningsToDepositWallet(req.user.id, Number(amount), fromWallet);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Request Withdrawal (Min 15 USDT, 0% Fee, 0-24hr)
router.post('/withdraw', authenticateToken, (req, res) => {
  try {
    const { amount, usdtAddress, network, walletSource } = req.body;
    const result = walletService.requestWithdrawal(req.user.id, {
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
router.get('/transactions', authenticateToken, (req, res) => {
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

    const transactions = db.prepare(query).all(...params);
    res.json({ success: true, transactions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// User Withdrawal History
router.get('/withdrawals', authenticateToken, (req, res) => {
  try {
    const withdrawals = db.prepare(`
      SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC
    `).all(req.user.id);
    res.json({ success: true, withdrawals });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
