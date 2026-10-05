const { db } = require('../db/database');
const mlmService = require('./mlmService');

class WalletService {
  /**
   * Process a Deposit (USDT)
   */
  deposit(userId, amount, network = 'USDT-TRC20', txHash = null) {
    if (amount <= 0) {
      throw new Error('Deposit amount must be greater than 0');
    }

    const cleanHash = txHash || 'TX-' + Math.random().toString(36).substring(2, 10).toUpperCase();

    // Insert deposit record
    const res = db.prepare(`
      INSERT INTO deposits (user_id, amount, network, tx_hash, status)
      VALUES (?, ?, ?, ?, 'completed')
    `).run(userId, amount, network, cleanHash);

    // Credit user's wallet_balance
    db.prepare('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?').run(amount, userId);

    // Record transaction
    db.prepare(`
      INSERT INTO transactions (user_id, amount, type, wallet_type, description, reference_id, status)
      VALUES (?, ?, 'deposit', 'wallet_balance', ?, ?, 'completed')
    `).run(userId, amount, `Deposit of $${amount} via ${network}`, cleanHash);

    return {
      success: true,
      depositId: res.lastInsertRowid,
      amount,
      txHash: cleanHash
    };
  }

  /**
   * Purchase / Activate an Investment Plan
   * Activates Daily ROI tracking and pays 3-level Team Commission (6%, 2%, 1%)
   */
  purchasePlan(userId, planId) {
    const plan = db.prepare('SELECT * FROM plans WHERE id = ? AND is_active = 1').get(planId);
    if (!plan) {
      throw new Error('Invalid or inactive investment plan');
    }

    const user = db.prepare('SELECT id, username, wallet_balance, status FROM users WHERE id = ?').get(userId);
    if (!user) {
      throw new Error('User not found');
    }

    if (user.wallet_balance < plan.price) {
      throw new Error(`Insufficient wallet balance ($${user.wallet_balance.toFixed(2)} available). Plan requires $${plan.price.toFixed(2)}. Please deposit funds.`);
    }

    // 1. Deduct price from wallet balance
    db.prepare('UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?').run(plan.price, userId);

    // 2. Insert Investment record
    const invRes = db.prepare(`
      INSERT INTO investments (user_id, plan_id, amount, daily_roi, total_days, days_credited, total_earned, status)
      VALUES (?, ?, ?, ?, ?, 0, 0.0, 'active')
    `).run(userId, plan.id, plan.price, plan.daily_roi, plan.duration_days);

    const investmentId = invRes.lastInsertRowid;

    // 3. Record Investment purchase transaction
    db.prepare(`
      INSERT INTO transactions (user_id, amount, type, wallet_type, description, reference_id, status)
      VALUES (?, ?, 'investment', 'wallet_balance', ?, ?, 'completed')
    `).run(
      userId,
      plan.price,
      `Activated ${plan.name} ($${plan.price} for ${plan.duration_days} days @ $${plan.daily_roi}/day)`,
      `INV-${investmentId}`
    );

    // 4. Distribute Team Commission (One-Time: L1: 6%, L2: 2%, L3: 1%)
    const teamCommissions = mlmService.distributeTeamCommission(userId, plan.price, investmentId);

    return {
      success: true,
      investmentId,
      planName: plan.name,
      amount: plan.price,
      dailyRoi: plan.daily_roi,
      durationDays: plan.duration_days,
      teamCommissions
    };
  }

  /**
   * Transfer earnings (ROI or Commission) to Deposit Wallet to enable re-investment
   */
  transferEarningsToDepositWallet(userId, amount, fromWallet = 'roi_balance') {
    if (amount <= 0) throw new Error('Amount must be greater than 0');

    const validWallets = ['roi_balance', 'commission_balance'];
    if (!validWallets.includes(fromWallet)) {
      throw new Error('Invalid source wallet for transfer');
    }

    const user = db.prepare(`SELECT ${fromWallet} as bal FROM users WHERE id = ?`).get(userId);
    if (!user || user.bal < amount) {
      throw new Error(`Insufficient balance in ${fromWallet.replace('_', ' ')}`);
    }

    // Deduct from source and credit to wallet_balance
    db.prepare(`UPDATE users SET ${fromWallet} = ${fromWallet} - ?, wallet_balance = wallet_balance + ? WHERE id = ?`)
      .run(amount, amount, userId);

    const walletLabel = fromWallet === 'roi_balance' ? 'ROI Wallet' : 'Commission Wallet';

    db.prepare(`
      INSERT INTO transactions (user_id, amount, type, wallet_type, description, status)
      VALUES (?, ?, 'transfer', 'wallet_balance', ?, 'completed')
    `).run(userId, amount, `Reinvestment transfer from ${walletLabel} to Deposit Wallet`);

    return { success: true, amount, fromWallet };
  }

  /**
   * Request a Withdrawal
   * Enforces Catalyst Capital terms:
   * - Minimum: 15 USDT
   * - Fee: 0%
   * - Processing time: 0 - 24 hours
   */
  requestWithdrawal(userId, { amount, usdtAddress, network = 'USDT-TRC20', walletSource = 'roi_balance' }) {
    if (!amount || amount <= 0) {
      throw new Error('Please enter a valid withdrawal amount');
    }

    // Minimum withdrawal rule: 15 USDT
    const minWithdrawalSetting = db.prepare("SELECT value FROM system_settings WHERE key = 'min_withdrawal'").get();
    const minWithdrawal = minWithdrawalSetting ? parseFloat(minWithdrawalSetting.value) : 15.0;

    if (amount < minWithdrawal) {
      throw new Error(`Minimum withdrawal is ${minWithdrawal} USDT`);
    }

    if (!usdtAddress || usdtAddress.trim().length < 10) {
      throw new Error('Please provide a valid USDT destination address');
    }

    const user = db.prepare('SELECT id, wallet_balance, roi_balance, commission_balance, status FROM users WHERE id = ?').get(userId);
    if (!user || user.status !== 'active') {
      throw new Error('User not found or account inactive');
    }

    // Determine available balance
    let available = 0;
    if (walletSource === 'roi_balance') {
      available = user.roi_balance;
    } else if (walletSource === 'commission_balance') {
      available = user.commission_balance;
    } else if (walletSource === 'all') {
      available = user.roi_balance + user.commission_balance;
    } else {
      throw new Error('Invalid withdrawal source wallet');
    }

    if (available < amount) {
      throw new Error(`Insufficient earnings balance ($${available.toFixed(2)} available in selected source)`);
    }

    // Deduct from appropriate wallet(s)
    if (walletSource === 'roi_balance') {
      db.prepare('UPDATE users SET roi_balance = roi_balance - ? WHERE id = ?').run(amount, userId);
    } else if (walletSource === 'commission_balance') {
      db.prepare('UPDATE users SET commission_balance = commission_balance - ? WHERE id = ?').run(amount, userId);
    } else {
      // Deduct from ROI first, then remainder from Commission
      if (user.roi_balance >= amount) {
        db.prepare('UPDATE users SET roi_balance = roi_balance - ? WHERE id = ?').run(amount, userId);
      } else {
        const remainder = amount - user.roi_balance;
        db.prepare('UPDATE users SET roi_balance = 0, commission_balance = commission_balance - ? WHERE id = ?').run(remainder, userId);
      }
    }

    // Update saved USDT address
    db.prepare('UPDATE users SET usdt_address = ? WHERE id = ?').run(usdtAddress.trim(), userId);

    // Fee is 0%
    const fee = 0.0;
    const netAmount = amount;

    const res = db.prepare(`
      INSERT INTO withdrawals (user_id, amount, fee, net_amount, wallet_type, usdt_address, network, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(userId, amount, fee, netAmount, walletSource, usdtAddress.trim(), network);

    // Log transaction
    db.prepare(`
      INSERT INTO transactions (user_id, amount, type, wallet_type, description, reference_id, status)
      VALUES (?, ?, 'withdrawal', ?, ?, ?, 'pending')
    `).run(
      userId,
      amount,
      walletSource,
      `Withdrawal Request to ${usdtAddress.trim()} (Fee: 0%, Processing: 0-24hr)`,
      `WTH-${res.lastInsertRowid}`
    );

    return {
      success: true,
      withdrawalId: res.lastInsertRowid,
      amount,
      fee,
      netAmount,
      usdtAddress: usdtAddress.trim(),
      status: 'pending',
      processingTime: '0 - 24 hours'
    };
  }

  /**
   * Admin approves withdrawal
   */
  approveWithdrawal(withdrawalId, txHash = null, adminNote = '') {
    const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(withdrawalId);
    if (!w) throw new Error('Withdrawal record not found');
    if (w.status !== 'pending') throw new Error(`Withdrawal is already ${w.status}`);

    const hash = txHash || 'USDT-TX-' + Math.random().toString(36).substring(2, 12).toUpperCase();

    db.prepare(`
      UPDATE withdrawals
      SET status = 'approved',
          tx_hash = ?,
          admin_note = ?,
          processed_at = datetime('now')
      WHERE id = ?
    `).run(hash, adminNote, withdrawalId);

    db.prepare(`
      UPDATE transactions
      SET status = 'completed',
          description = description || ' [Approved: ' || ? || ']'
      WHERE reference_id = ?
    `).run(hash, `WTH-${withdrawalId}`);

    return { success: true, withdrawalId, status: 'approved', txHash: hash };
  }

  /**
   * Admin rejects withdrawal (refunds balance)
   */
  rejectWithdrawal(withdrawalId, reason = 'Administrative cancellation') {
    const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(withdrawalId);
    if (!w) throw new Error('Withdrawal record not found');
    if (w.status !== 'pending') throw new Error(`Withdrawal is already ${w.status}`);

    // Refund to user's wallet
    const refundWallet = w.wallet_type === 'commission_balance' ? 'commission_balance' : 'roi_balance';
    db.prepare(`UPDATE users SET ${refundWallet} = ${refundWallet} + ? WHERE id = ?`).run(w.amount, w.user_id);

    db.prepare(`
      UPDATE withdrawals
      SET status = 'rejected',
          admin_note = ?,
          processed_at = datetime('now')
      WHERE id = ?
    `).run(reason, withdrawalId);

    // Record refund transaction
    db.prepare(`
      INSERT INTO transactions (user_id, amount, type, wallet_type, description, reference_id, status)
      VALUES (?, ?, 'refund', ?, ?, ?, 'completed')
    `).run(w.user_id, w.amount, refundWallet, `Withdrawal Refund: ${reason}`, `REF-${withdrawalId}`);

    db.prepare(`UPDATE transactions SET status = 'rejected' WHERE reference_id = ?`).run(`WTH-${withdrawalId}`);

    return { success: true, withdrawalId, status: 'rejected', refundedAmount: w.amount };
  }
}

module.exports = new WalletService();
