const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const walletService = require('../services/walletService');
const { authenticateToken } = require('../middleware/authMiddleware');

// Public endpoint for anyone (members, guests) to get active BEP-20 deposit address
router.get('/deposit-address', async (req, res) => {
  try {
    const setting = await db.get("SELECT value FROM system_settings WHERE key = 'usdt_deposit_address'");
    let depositAddress = setting && setting.value ? setting.value.trim() : null;
    if (!depositAddress) {
      const admin = await db.get("SELECT usdt_address FROM users WHERE (role = 'admin' OR id = 1) AND usdt_address IS NOT NULL AND usdt_address != '' ORDER BY id ASC LIMIT 1");
      depositAddress = admin && admin.usdt_address ? admin.usdt_address.trim() : null;
    }
    res.json({
      success: true,
      depositAddress: depositAddress || '0x71C87050fA86BD1b297bB3B6a8d6C9081B1A53b5'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get wallet overview & balances
router.get('/overview', authenticateToken, async (req, res) => {
  try {
    const user = await db.get(`
      SELECT wallet_balance, roi_balance, commission_balance, usdt_address
      FROM users WHERE id = ?
    `, [req.user.id]);

    const totalDepositedRes = await db.get(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM deposits
      WHERE user_id = ? AND status = 'completed'
    `, [req.user.id]);
    const totalRecharge = totalDepositedRes ? (parseFloat(totalDepositedRes.total) || 0) : 0;

    const activeInvestRes = await db.get(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM investments
      WHERE user_id = ? AND status = 'active'
    `, [req.user.id]);
    const tradingAssets = activeInvestRes ? (parseFloat(activeInvestRes.total) || 0) : 0;

    const earningsRows = await db.all(`
      SELECT amount, type, created_at
      FROM transactions
      WHERE user_id = ? AND type IN ('daily_roi', 'referral_roi', 'team_commission') AND status = 'completed'
    `, [req.user.id]);

    const todayStr = new Date().toISOString().slice(0, 10);
    const yest = new Date(Date.now() - 86400000);
    const yestStr = yest.toISOString().slice(0, 10);

    let totalRoiIncome = 0;
    let totalTeamRoiIncome = 0;
    let totalTeamCommission = 0;
    let todayIncome = 0;
    let yesterdayIncome = 0;
    let accumulatedBonus = 0;
    let totalEarned = 0;

    for (const tx of earningsRows) {
      const txDate = new Date(tx.created_at).toISOString().slice(0, 10);
      const amt = parseFloat(tx.amount) || 0;
      totalEarned += amt;
      if (tx.type === 'daily_roi') {
        totalRoiIncome += amt;
      } else if (tx.type === 'referral_roi') {
        totalTeamRoiIncome += amt;
        accumulatedBonus += amt;
      } else if (tx.type === 'team_commission') {
        totalTeamCommission += amt;
        accumulatedBonus += amt;
      }
      if (txDate === todayStr) {
        todayIncome += amt;
      } else if (txDate === yestStr) {
        yesterdayIncome += amt;
      }
    }

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

    const totalAssets = (user.wallet_balance || 0) + (user.roi_balance || 0) + (user.commission_balance || 0) + tradingAssets;

    let depositAddress = settings.usdt_deposit_address && settings.usdt_deposit_address.trim() ? settings.usdt_deposit_address.trim() : null;
    if (!depositAddress) {
      const admin = await db.get("SELECT usdt_address FROM users WHERE (role = 'admin' OR id = 1) AND usdt_address IS NOT NULL AND usdt_address != '' ORDER BY id ASC LIMIT 1");
      depositAddress = admin && admin.usdt_address ? admin.usdt_address.trim() : null;
    }

    res.json({
      success: true,
      wallets: {
        totalAssets,
        totalRecharge,
        totalWithdrawn: totalWithdrawnRes ? (parseFloat(totalWithdrawnRes.total) || 0) : 0,
        totalRoiIncome,
        totalTeamRoiIncome,
        totalTeamCommission,
        tradingAssets,
        bonusAssets: user.commission_balance || 0,
        accumulatedBonus,
        yesterdayIncome,
        todayIncome,
        profitMargin: '4.00%',
        depositWallet: user.wallet_balance || 0,
        roiWallet: user.roi_balance || 0,
        commissionWallet: user.commission_balance || 0,
        totalWithdrawable: (user.roi_balance || 0) + (user.commission_balance || 0) + (user.wallet_balance || 0),
        totalEarned,
        pendingWithdrawn: pendingWithdrawnRes ? (parseFloat(pendingWithdrawnRes.total) || 0) : 0,
        savedUsdtAddress: user.usdt_address
      },
      rules: {
        minWithdrawal: parseFloat(settings.min_withdrawal || '15'),
        withdrawalFee: parseFloat(settings.withdrawal_fee_percent || '0'),
        processingTime: settings.withdrawal_processing_time || '0 - 24 Hours',
        depositAddress: depositAddress || '0x71C87050fA86BD1b297bB3B6a8d6C9081B1A53b5',
        announcementTicker: settings.announcement_ticker || 'Welcome to the official Catalyst Capital trading platform • High Frequency AI Trading • Instant 0% Withdrawal Payouts • Daily ROI Active •',
        popupImageUrl: settings.popup_image_url || '',
        popupImageActive: settings.popup_image_active === '1' || settings.popup_image_active === 'true',
        popupImageTitle: settings.popup_image_title || 'Special Platform Announcement'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Deposit USDT (BEP-20)
router.post('/deposit', authenticateToken, async (req, res) => {
  try {
    const { amount, network = 'USDT-BEP20', txHash } = req.body;
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

// Request Withdrawal (Min 15 USDT, 0% Fee, 0-24hr, BEP-20)
router.post('/withdraw', authenticateToken, async (req, res) => {
  try {
    const { amount, usdtAddress, network = 'USDT-BEP20', walletSource } = req.body;
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
