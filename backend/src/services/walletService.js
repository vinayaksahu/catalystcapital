const { db } = require('../db/database');
const mlmService = require('./mlmService');
const notificationService = require('./notificationService');

const userWithdrawalLocks = new Set();

class WalletService {
  /**
   * Process a Deposit (USDT)
   */
  async deposit(userId, amount, network = 'USDT-BEP20', txHash = null) {
    if (!amount || amount <= 0) {
      throw new Error('Deposit amount must be greater than 0');
    }

    if (!txHash || typeof txHash !== 'string' || !txHash.trim()) {
      throw new Error('Transaction Hash / TXID is required for deposit verification');
    }

    const cleanHash = txHash.trim();
    // Validate BSC BEP20 Tx Hash format: 66 chars, starts with 0x, followed by 64 hex characters
    const txHashRegex = /^0x[a-fA-F0-9]{64}$/i;
    if (!txHashRegex.test(cleanHash)) {
      throw new Error('Invalid Transaction Hash. Must be a valid 66-character BEP-20 transaction hash (e.g. 0x followed by 64 hex characters)');
    }

    // Check for duplicate transaction hash
    const existing = await db.get('SELECT id FROM deposits WHERE tx_hash = ?', [cleanHash]);
    if (existing) {
      throw new Error('This transaction hash has already been submitted for deposit verification');
    }

    // Insert deposit record with 'pending' status
    const res = await db.run(`
      INSERT INTO deposits (user_id, amount, network, tx_hash, status)
      VALUES (?, ?, ?, ?, 'pending')
    `, [userId, amount, network || 'USDT-BEP20', cleanHash]);

    // Record pending transaction (Do NOT update wallet_balance until admin approves)
    await db.run(`
      INSERT INTO transactions (user_id, amount, type, wallet_type, description, reference_id, status)
      VALUES (?, ?, 'deposit', 'wallet_balance', ?, ?, 'pending')
    `, [userId, amount, `Deposit request of $${amount} via ${network || 'USDT-BEP20'} (Awaiting Admin Approval)`, cleanHash]);

    // Notify Admins about new pending deposit
    const u = await db.get('SELECT username FROM users WHERE id = ?', [userId]);
    await notificationService.notifyAdmins({
      type: 'deposit',
      title: 'New Deposit Request!',
      message: `@${u?.username || 'User'} requested verification for $${amount} USDT deposit.`,
      amount,
      referenceId: `DEP-${res.lastInsertRowid}`
    });

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

    const user = await db.get('SELECT id, username, wallet_balance, roi_balance, commission_balance, status FROM users WHERE id = ?', [userId]);
    if (!user) {
      throw new Error('User not found');
    }

    const walBal = Math.max(0, parseFloat(user.wallet_balance) || 0);
    const roiBal = Math.max(0, parseFloat(user.roi_balance) || 0);
    const commBal = Math.max(0, parseFloat(user.commission_balance) || 0);
    const totalAvailable = parseFloat((walBal + roiBal + commBal).toFixed(4));

    if (totalAvailable < plan.price) {
      throw new Error(`Insufficient wallet balance ($${totalAvailable.toFixed(2)} available). Plan requires $${plan.price.toFixed(2)}. Please deposit funds.`);
    }

    // 1. Deduct price from available balance (Deposit balance first, then ROI, then Commission)
    let rem = plan.price;
    const sourcesUsed = [];

    if (walBal > 0) {
      const take = Math.min(walBal, rem);
      await db.run('UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ? AND wallet_balance >= ?', [take, userId, take]);
      rem = parseFloat((rem - take).toFixed(4));
      sourcesUsed.push(`Deposit: $${take.toFixed(2)}`);
    }
    if (rem > 0 && roiBal > 0) {
      const take = Math.min(roiBal, rem);
      await db.run('UPDATE users SET roi_balance = roi_balance - ? WHERE id = ? AND roi_balance >= ?', [take, userId, take]);
      rem = parseFloat((rem - take).toFixed(4));
      sourcesUsed.push(`ROI: $${take.toFixed(2)}`);
    }
    if (rem > 0 && commBal > 0) {
      const take = Math.min(commBal, rem);
      await db.run('UPDATE users SET commission_balance = commission_balance - ? WHERE id = ? AND commission_balance >= ?', [take, userId, take]);
      rem = parseFloat((rem - take).toFixed(4));
      sourcesUsed.push(`Commission: $${take.toFixed(2)}`);
    }
    if (rem > 0) {
      throw new Error('Insufficient balance to complete purchase');
    }

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
      `Activated ${plan.name} ($${plan.price} for ${plan.duration_days} days @ $${plan.daily_roi}/day) [Paid via ${sourcesUsed.join(', ')}]`,
      `INV-${investmentId}`
    ]);

    // Plan Activation Notification
    await notificationService.createNotification({
      userId,
      type: 'investment',
      title: 'Plan Activated Successfully!',
      message: `${plan.name} ($${plan.price}) activated. Daily ROI of $${plan.daily_roi}/day for ${plan.duration_days} days has commenced.`,
      amount: plan.price,
      referenceId: `INV-${investmentId}`
    });

    // Notify Admins about plan purchase
    await notificationService.notifyAdmins({
      type: 'investment',
      title: 'New Plan Activated!',
      message: `@${user.username} activated ${plan.name} ($${plan.price} USDT).`,
      amount: plan.price,
      referenceId: `INV-${investmentId}`
    });

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
  async requestWithdrawal(userId, { amount, usdtAddress, network = 'USDT-BEP20', walletSource = 'roi_balance' }) {
    if (!amount || amount <= 0) {
      throw new Error('Please enter a valid withdrawal amount');
    }

    // Concurrency Lock: prevent rapid double-clicks/spamming for the same user
    if (userWithdrawalLocks.has(userId)) {
      throw new Error('A withdrawal transaction is currently being processed. Please wait a moment.');
    }
    userWithdrawalLocks.add(userId);

    try {
      const minWithdrawalSetting = await db.get("SELECT value FROM system_settings WHERE key = 'min_withdrawal'");
      const minWithdrawal = minWithdrawalSetting ? parseFloat(minWithdrawalSetting.value) : 15.0;

      if (amount < minWithdrawal) {
        throw new Error(`Minimum withdrawal is ${minWithdrawal} USDT`);
      }

      const bep20AddressRegex = /^0x[a-fA-F0-9]{40}$/i;
      if (!usdtAddress || typeof usdtAddress !== 'string' || !bep20AddressRegex.test(usdtAddress.trim())) {
        throw new Error('Please provide a valid 42-character USDT (BEP-20) wallet address starting with 0x');
      }

      const user = await db.get('SELECT id, username, wallet_balance, roi_balance, commission_balance, status FROM users WHERE id = ?', [userId]);
      if (!user || user.status !== 'active') {
        throw new Error('User not found or account inactive');
      }

      const roiBal = Math.max(0, parseFloat(user.roi_balance) || 0);
      const commBal = Math.max(0, parseFloat(user.commission_balance) || 0);
      const walBal = Math.max(0, parseFloat(user.wallet_balance) || 0);

      let available = 0;
      if (walletSource === 'roi_balance') {
        available = roiBal;
      } else if (walletSource === 'commission_balance') {
        available = commBal;
      } else if (walletSource === 'wallet_balance') {
        available = walBal;
      } else if (walletSource === 'all') {
        available = parseFloat((roiBal + commBal + walBal).toFixed(4));
      } else {
        throw new Error('Invalid withdrawal source wallet');
      }

      if (available < amount) {
        throw new Error(`Insufficient balance ($${available.toFixed(2)} available in selected source)`);
      }

      // Deduct atomically: enforce WHERE balance >= amount so balance can NEVER become negative
      if (walletSource === 'roi_balance') {
        const upd = await db.run('UPDATE users SET roi_balance = roi_balance - ? WHERE id = ? AND roi_balance >= ?', [amount, userId, amount]);
        if (upd.changes === 0 || (db.isPostgres && upd.rowCount === 0)) {
          throw new Error('Insufficient balance in ROI Wallet for withdrawal');
        }
      } else if (walletSource === 'commission_balance') {
        const upd = await db.run('UPDATE users SET commission_balance = commission_balance - ? WHERE id = ? AND commission_balance >= ?', [amount, userId, amount]);
        if (upd.changes === 0 || (db.isPostgres && upd.rowCount === 0)) {
          throw new Error('Insufficient balance in Commission Wallet for withdrawal');
        }
      } else if (walletSource === 'wallet_balance') {
        const upd = await db.run('UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ? AND wallet_balance >= ?', [amount, userId, amount]);
        if (upd.changes === 0 || (db.isPostgres && upd.rowCount === 0)) {
          throw new Error('Insufficient balance in Deposit/Principal Wallet for withdrawal');
        }
      } else {
        // Combined 'all': deduct from roi_balance first, then commission_balance, then wallet_balance
        let rem = amount;
        if (roiBal > 0) {
          const takeRoi = Math.min(roiBal, rem);
          const upd = await db.run('UPDATE users SET roi_balance = roi_balance - ? WHERE id = ? AND roi_balance >= ?', [takeRoi, userId, takeRoi]);
          if (upd.changes === 0 || (db.isPostgres && upd.rowCount === 0)) {
            throw new Error('Insufficient ROI balance');
          }
          rem = parseFloat((rem - takeRoi).toFixed(4));
        }
        if (rem > 0 && commBal > 0) {
          const takeComm = Math.min(commBal, rem);
          const upd = await db.run('UPDATE users SET commission_balance = commission_balance - ? WHERE id = ? AND commission_balance >= ?', [takeComm, userId, takeComm]);
          if (upd.changes === 0 || (db.isPostgres && upd.rowCount === 0)) {
            throw new Error('Insufficient Commission balance');
          }
          rem = parseFloat((rem - takeComm).toFixed(4));
        }
        if (rem > 0 && walBal > 0) {
          const takeWal = Math.min(walBal, rem);
          const upd = await db.run('UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ? AND wallet_balance >= ?', [takeWal, userId, takeWal]);
          if (upd.changes === 0 || (db.isPostgres && upd.rowCount === 0)) {
            throw new Error('Insufficient Deposit balance');
          }
          rem = parseFloat((rem - takeWal).toFixed(4));
        }
        if (rem > 0) {
          throw new Error(`Insufficient combined balance to withdraw $${amount}`);
        }
      }

      // Safety guard: ensure no wallet balance is negative
      await db.run('UPDATE users SET wallet_balance = 0 WHERE id = ? AND wallet_balance < 0', [userId]);
      await db.run('UPDATE users SET roi_balance = 0 WHERE id = ? AND roi_balance < 0', [userId]);
      await db.run('UPDATE users SET commission_balance = 0 WHERE id = ? AND commission_balance < 0', [userId]);

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

      // Notify Admins about new withdrawal request
      await notificationService.notifyAdmins({
        type: 'withdrawal',
        title: 'New Withdrawal Request!',
        message: `@${user.username || 'User'} requested withdrawal of $${amount} USDT to ${usdtAddress.trim().substring(0, 10)}...`,
        amount,
        referenceId: `WTH-${res.lastInsertRowid}`
      });

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
    } finally {
      userWithdrawalLocks.delete(userId);
    }
  }

  /**
   * Admin approves withdrawal
   */
  async approveWithdrawal(withdrawalId, txHash = null, adminNote = '') {
    const w = await db.get('SELECT * FROM withdrawals WHERE id = ?', [withdrawalId]);
    if (!w) throw new Error('Withdrawal record not found');
    if (w.status !== 'pending') throw new Error(`Withdrawal is already ${w.status}`);

    const crypto = require('crypto');
    const hash = txHash || ('0x' + crypto.randomBytes(32).toString('hex'));
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

    // Withdrawal Approved Notification
    await notificationService.createNotification({
      userId: w.user_id,
      type: 'withdrawal',
      title: 'Withdrawal Approved & Sent!',
      message: `Your withdrawal of $${w.amount} USDT has been sent to ${w.usdt_address} (TXID: ${hash}).`,
      amount: w.amount,
      referenceId: hash
    });

    return { success: true, withdrawalId, status: 'approved', txHash: hash };
  }

  /**
   * Admin rejects withdrawal (refunds balance)
   */
  async rejectWithdrawal(withdrawalId, reason = 'Administrative cancellation') {
    const w = await db.get('SELECT * FROM withdrawals WHERE id = ?', [withdrawalId]);
    if (!w) throw new Error('Withdrawal record not found');
    if (w.status !== 'pending') throw new Error(`Withdrawal is already ${w.status}`);

    let refundWallet = 'wallet_balance';
    if (w.wallet_type === 'roi_balance') refundWallet = 'roi_balance';
    else if (w.wallet_type === 'commission_balance') refundWallet = 'commission_balance';
    else if (w.wallet_type === 'wallet_balance') refundWallet = 'wallet_balance';
    else if (w.wallet_type === 'all') refundWallet = 'wallet_balance';

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

    const descAppend = ` [Rejected: ${reason}]`;
    await db.run(`
      UPDATE transactions
      SET status = 'rejected',
          description = description || ?
      WHERE reference_id = ?
    `, [descAppend, `WTH-${withdrawalId}`]);

    // Withdrawal Rejected Notification
    await notificationService.createNotification({
      userId: w.user_id,
      type: 'withdrawal',
      title: 'Withdrawal Rejected & Refunded',
      message: `Your withdrawal request of $${w.amount} was rejected (${reason}). Funds have been refunded to your ${refundWallet.replace('_', ' ')}.`,
      amount: w.amount,
      referenceId: `WTH-${withdrawalId}`
    });

    return { success: true, withdrawalId, status: 'rejected', refundedAmount: w.amount };
  }
}

module.exports = new WalletService();
