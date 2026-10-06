const { db } = require('../db/database');
const mlmService = require('./mlmService');

class WalletService {
  /**
   * Process a Deposit (USDT)
   */
  async deposit(userId, amount, network = 'USDT-TRC20', txHash = null) {
    if (amount <= 0) {
      throw new Error('Deposit amount must be greater than 0');
    }

    const cleanHash = txHash || 'TX-' + Math.random().toString(36).substring(2, 10).toUpperCase();

    // Insert deposit record with 'pending' status
    const res = await db.run(`
      INSERT INTO deposits (user_id, amount, network, tx_hash, status)
      VALUES (?, ?, ?, ?, 'pending')
    `, [userId, amount, network, cleanHash]);

    // Record pending transaction (Do NOT update wallet_balance until admin approves)
    await db.run(`
      INSERT INTO transactions (user_id, amount, type, wallet_type, description, reference_id, status)
      VALUES (?, ?, 'deposit', 'wallet_balance', ?, ?, 'pending')
    `, [userId, amount, `Deposit request of $${amount} via ${network} (Awaiting Admin Approval)`, cleanHash]);

    return {
      success: true,
      pending: true,
      depositId: res.lastInsertRowid,
      amount,
      txHash: cleanHash,
      message: 'Deposit request submitted successfully! Funds will be credited once verified and approved by Admin.'
    };
  }

  /**
   * Purchase / Activate an Investment Plan
   * Activates Daily ROI tracking and pays 3-level Team Commission (6%, 2%, 1%)
   */
  async purchasePlan(userId, planId) {
    const plan = await db.get('SELECT * FROM plans WHERE id = ? AND is_active = 1', [planId]);
    if (!plan) {
      throw new Error('Invalid or inactive investment plan');
    }

    const user = await db.get('SELECT id, username, wallet_balance, status FROM users WHERE id = ?', [userId]);
    if (!user) {
      throw new Error('User not found');
    }

    if (user.wallet_balance < plan.price) {
      throw new Error(`Insufficient wallet balance ($${user.wallet_balance.toFixed(2)} available). Plan requires $${plan.price.toFixed(2)}. Please deposit funds.`);
    }

    // 1. Deduct price from wallet balance
    await db.run('UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?', [plan.price, userId]);

    // 2. Insert Investment record
    const invRes = await db.run(`
      INSERT INTO investments (user_id, plan_id, amount, daily_roi, total_days, days_credited, total_earned, status)
      VALUES (?, ?, ?, ?, ?, 0, 0.0, 'active')
    `, [userId, plan.id, plan.price, plan.daily_roi, plan.duration_days]);

    const investmentId = invRes.lastInsertRowid;

    // 3. Record Investment purchase transaction
    await db.run(`
      INSERT INTO transactions (user_id, amount, type, wallet_type, description, reference_id, status)
      VALUES (?, ?, 'investment', 'wallet_balance', ?, ?, 'completed')
    `, [
      userId,
      plan.price,
      `Activated ${plan.name} ($${plan.price} for ${plan.duration_days} days @ $${plan.daily_roi}/day)`,
      `INV-${investmentId}`
    ]);

    // 4. Distribute Team Commission (One-Time: L1: 6%, L2: 2%, L3: 1%)
    const teamCommissions = await mlmService.distributeTeamCommission(userId, plan.price, investmentId);

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
  async transferEarningsToDepositWallet(userId, amount, fromWallet = 'roi_balance') {
    if (amount <= 0) throw new Error('Amount must be greater than 0');

    const validWallets = ['roi_balance', 'commission_balance'];
    if (!validWallets.includes(fromWallet)) {
      throw new Error('Invalid source wallet for transfer');
    }

    const user = await db.get(`SELECT ${fromWallet} as bal FROM users WHERE id = ?`, [userId]);
    if (!user || user.bal < amount) {
      throw new Error(`Insufficient balance in ${fromWallet.replace('_', ' ')}`);
    }

    // Deduct from source and credit to wallet_balance
    await db.run(`UPDATE users SET ${fromWallet} = ${fromWallet} - ?, wallet_balance = wallet_balance + ? WHERE id = ?`, [amount, amount, userId]);

    const walletLabel = fromWallet === 'roi_balance' ? 'ROI Wallet' : 'Commission Wallet';

    await db.run(`
      INSERT INTO transactions (user_id, amount, type, wallet_type, description, status)
      VALUES (?, ?, 'transfer', 'wallet_balance', ?, 'completed')
    `, [userId, amount, `Reinvestment transfer from ${walletLabel} to Deposit Wallet`]);

    return { success: true, amount, fromWallet };
  }

  /**
   * Request a Withdrawal
   * Enforces Catalyst Capital terms:
   * - Minimum: 15 USDT
   * - Fee: 0%
   * - Processing time: 0 - 24 hours
   */
  async requestWithdrawal(userId, { amount, usdtAddress, network = 'USDT-TRC20', walletSource = 'roi_balance' }) {
    if (!amount || amount <= 0) {
      throw new Error('Please enter a valid withdrawal amount');
    }

    const minWithdrawalSetting = await db.get("SELECT value FROM system_settings WHERE key = 'min_withdrawal'");
    const minWithdrawal = minWithdrawalSetting ? parseFloat(minWithdrawalSetting.value) : 15.0;

    if (amount < minWithdrawal) {
      throw new Error(`Minimum withdrawal is ${minWithdrawal} USDT`);
    }

    if (!usdtAddress || usdtAddress.trim().length < 10) {
      throw new Error('Please provide a valid USDT destination address');
    }

    const user = await db.get('SELECT id, wallet_balance, roi_balance, commission_balance, status FROM users WHERE id = ?', [userId]);
    if (!user || user.status !== 'active') {
      throw new Error('User not found or account inactive');
    }

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
      await db.run('UPDATE users SET roi_balance = roi_balance - ? WHERE id = ?', [amount, userId]);
    } else if (walletSource === 'commission_balance') {
      await db.run('UPDATE users SET commission_balance = commission_balance - ? WHERE id = ?', [amount, userId]);
    } else {
      if (user.roi_balance >= amount) {
        await db.run('UPDATE users SET roi_balance = roi_balance - ? WHERE id = ?', [amount, userId]);
      } else {
        const remainder = amount - user.roi_balance;
        await db.run('UPDATE users SET roi_balance = 0, commission_balance = commission_balance - ? WHERE id = ?', [remainder, userId]);
      }
    }

    // Update saved USDT address
    await db.run('UPDATE users SET usdt_address = ? WHERE id = ?', [usdtAddress.trim(), userId]);

    // Fee is 0%
    const fee = 0.0;
    const netAmount = amount;

    const res = await db.run(`
      INSERT INTO withdrawals (user_id, amount, fee, net_amount, wallet_type, usdt_address, network, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `, [userId, amount, fee, netAmount, walletSource, usdtAddress.trim(), network]);

    // Log transaction
    await db.run(`
      INSERT INTO transactions (user_id, amount, type, wallet_type, description, reference_id, status)
      VALUES (?, ?, 'withdrawal', ?, ?, ?, 'pending')
    `, [
      userId,
      amount,
      walletSource,
      `Withdrawal Request to ${usdtAddress.trim()} (Fee: 0%, Processing: 0-24hr)`,
      `WTH-${res.lastInsertRowid}`
    ]);

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
  async approveWithdrawal(withdrawalId, txHash = null, adminNote = '') {
    const w = await db.get('SELECT * FROM withdrawals WHERE id = ?', [withdrawalId]);
    if (!w) throw new Error('Withdrawal record not found');
    if (w.status !== 'pending') throw new Error(`Withdrawal is already ${w.status}`);

    const hash = txHash || 'USDT-TX-' + Math.random().toString(36).substring(2, 12).toUpperCase();
    const nowExpr = db.isPostgres ? 'CURRENT_TIMESTAMP' : "datetime('now')";

    await db.run(`
      UPDATE withdrawals
      SET status = 'approved',
          tx_hash = ?,
          admin_note = ?,
          processed_at = ${nowExpr}
      WHERE id = ?
    `, [hash, adminNote, withdrawalId]);

    const descAppend = ` [Approved: ${hash}]`;
    if (db.isPostgres) {
      await db.run(`
        UPDATE transactions
        SET status = 'completed',
            description = description || ?
        WHERE reference_id = ?
      `, [descAppend, `WTH-${withdrawalId}`]);
    } else {
      await db.run(`
        UPDATE transactions
        SET status = 'completed',
            description = description || ?
        WHERE reference_id = ?
      `, [descAppend, `WTH-${withdrawalId}`]);
    }

    return { success: true, withdrawalId, status: 'approved', txHash: hash };
  }

  /**
   * Admin rejects withdrawal (refunds balance)
   */
  async rejectWithdrawal(withdrawalId, reason = 'Administrative cancellation') {
    const w = await db.get('SELECT * FROM withdrawals WHERE id = ?', [withdrawalId]);
    if (!w) throw new Error('Withdrawal record not found');
    if (w.status !== 'pending') throw new Error(`Withdrawal is already ${w.status}`);

    const refundWallet = w.wallet_type === 'commission_balance' ? 'commission_balance' : 'roi_balance';
    await db.run(`UPDATE users SET ${refundWallet} = ${refundWallet} + ? WHERE id = ?`, [w.amount, w.user_id]);

    const nowExpr = db.isPostgres ? 'CURRENT_TIMESTAMP' : "datetime('now')";

    await db.run(`
      UPDATE withdrawals
      SET status = 'rejected',
          admin_note = ?,
          processed_at = ${nowExpr}
      WHERE id = ?
    `, [reason, withdrawalId]);

    await db.run(`
      INSERT INTO transactions (user_id, amount, type, wallet_type, description, reference_id, status)
      VALUES (?, ?, 'refund', ?, ?, ?, 'completed')
    `, [w.user_id, w.amount, refundWallet, `Withdrawal Refund: ${reason}`, `REF-${withdrawalId}`]);

    await db.run("UPDATE transactions SET status = 'rejected' WHERE reference_id = ?", [`WTH-${withdrawalId}`]);

    return { success: true, withdrawalId, status: 'rejected', refundedAmount: w.amount };
  }
}

module.exports = new WalletService();
