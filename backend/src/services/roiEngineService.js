const { db } = require('../db/database');
const mlmService = require('./mlmService');
const notificationService = require('./notificationService');

class RoiEngineService {
  /**
   * Process daily ROI for all active investments and distribute ROI of ROI to upline
   */
  async processDailyRoi(force = false) {
    const today = new Date().toISOString().split('T')[0];

    // Find all active investments that still have days remaining
    const activeInvestments = await db.all(`
      SELECT i.*, p.name as plan_name, u.username, u.status as user_status
      FROM investments i
      JOIN plans p ON i.plan_id = p.id
      JOIN users u ON i.user_id = u.id
      WHERE i.status = 'active'
        AND i.days_credited < i.total_days
        AND u.status = 'active'
    `);

    let processedCount = 0;
    let totalRoiDistributed = 0;
    let totalReferralRoiDistributed = 0;
    const details = [];

    for (const inv of activeInvestments) {
      if (!force && inv.last_roi_at) {
        const lastDate = typeof inv.last_roi_at === 'string'
          ? inv.last_roi_at.split(' ')[0].split('T')[0]
          : new Date(inv.last_roi_at).toISOString().split('T')[0];
        if (lastDate === today) {
          continue;
        }
      }

      const dailyRoi = inv.daily_roi;
      const nextDaysCredited = inv.days_credited + 1;
      const isCompleted = nextDaysCredited >= inv.total_days;
      const newStatus = isCompleted ? 'completed' : 'active';
      const nowExpr = db.isPostgres ? 'CURRENT_TIMESTAMP' : "datetime('now')";

      // 1. Update investment record
      await db.run(`
        UPDATE investments
        SET days_credited = days_credited + ?,
            total_earned = total_earned + ?,
            last_roi_at = ${nowExpr},
            status = ?,
            completed_at = ${isCompleted ? nowExpr : "NULL"}
        WHERE id = ?
      `, [1, dailyRoi, newStatus, inv.id]);

      // 2. Credit user's ROI wallet
      await db.run('UPDATE users SET roi_balance = roi_balance + ? WHERE id = ?', [dailyRoi, inv.user_id]);

      // 3. Log user's daily ROI transaction
      await db.run(`
        INSERT INTO transactions (user_id, amount, type, wallet_type, description, reference_id, status)
        VALUES (?, ?, 'daily_roi', 'roi_balance', ?, ?, 'completed')
      `, [
        inv.user_id,
        dailyRoi,
        `Daily ROI Payout (Day ${nextDaysCredited}/${inv.total_days}) for ${inv.plan_name} ($${inv.amount})`,
        `ROI-INV-${inv.id}`
      ]);

      // 4. Principal Amount Refund on Final Closing Day
      // When user reaches Max Return (nextDaysCredited >= total_days), refund the principal amount back to wallet
      let principalRefunded = 0;
      if (isCompleted) {
        principalRefunded = inv.amount;
        // Credit original staked principal back to user's wallet_balance
        await db.run('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [principalRefunded, inv.user_id]);

        // Record principal return transaction
        await db.run(`
          INSERT INTO transactions (user_id, amount, type, wallet_type, description, reference_id, status)
          VALUES (?, ?, 'principal_return', 'wallet_balance', ?, ?, 'completed')
        `, [
          inv.user_id,
          principalRefunded,
          `Principal Capital Refund on Maturity (Day ${nextDaysCredited}/${inv.total_days}) for ${inv.plan_name} ($${principalRefunded})`,
          `PRINCIPAL-INV-${inv.id}`
        ]);

        // Plan Completed & Principal Refund Notification
        await notificationService.createNotification({
          userId: inv.user_id,
          type: 'investment',
          title: 'Plan Completed & Principal Credited! 🎉',
          message: `Congratulations! ${inv.plan_name} has reached its Max Return. Your staked principal amount of $${principalRefunded.toFixed(2)} USDT has been credited back to your wallet alongside your final day ROI payout.`,
          amount: principalRefunded,
          referenceId: `PRINCIPAL-INV-${inv.id}`
        });
      }

      // Daily ROI Notification
      await notificationService.createNotification({
        userId: inv.user_id,
        type: 'roi',
        title: isCompleted ? 'Final Day ROI Credited (Plan Completed!)' : 'Daily ROI Credited!',
        message: isCompleted
          ? `+$${dailyRoi.toFixed(2)} USDT final day ROI credited for ${inv.plan_name} ($${inv.amount}) - Day ${nextDaysCredited}/${inv.total_days}. Plan complete & $${inv.amount.toFixed(2)} USDT principal credited back to your wallet!`
          : `+$${dailyRoi.toFixed(2)} USDT credited for ${inv.plan_name} ($${inv.amount}) - Day ${nextDaysCredited}/${inv.total_days}.`,
        amount: dailyRoi,
        referenceId: `ROI-INV-${inv.id}`
      });

      totalRoiDistributed += dailyRoi;
      processedCount++;

      // 5. Distribute Referral Income (ROI of ROI: L1=10%, L2=4%, L3=2%)
      const referralDistributions = await mlmService.distributeReferralRoi(inv.user_id, dailyRoi, inv.id);
      const referralSum = referralDistributions.reduce((acc, d) => acc + d.amount, 0);
      totalReferralRoiDistributed += referralSum;

      details.push({
        investmentId: inv.id,
        userId: inv.user_id,
        username: inv.username,
        planName: inv.plan_name,
        amount: inv.amount,
        dailyRoi,
        dayNumber: nextDaysCredited,
        totalDays: inv.total_days,
        isCompleted,
        principalRefunded,
        referralDistributions
      });
    }

    return {
      success: true,
      processedInvestments: processedCount,
      totalRoiDistributed: parseFloat(totalRoiDistributed.toFixed(4)),
      totalReferralRoiDistributed: parseFloat(totalReferralRoiDistributed.toFixed(4)),
      details
    };
  }

  /**
   * Forecast of pending daily cycle
   */
  async getPendingRoiSummary() {
    const activeInvestments = await db.all(`
      SELECT i.*, p.name as plan_name, u.username
      FROM investments i
      JOIN plans p ON i.plan_id = p.id
      JOIN users u ON i.user_id = u.id
      WHERE i.status = 'active'
        AND i.days_credited < i.total_days
        AND u.status = 'active'
    `);

    let estimatedDailyRoi = 0;
    let estimatedReferralRoi = 0;

    for (const inv of activeInvestments) {
      estimatedDailyRoi += inv.daily_roi;
      const uplines = await mlmService.getUplineChain(inv.user_id, 3);
      for (const { level } of uplines) {
        if (level === 1) estimatedReferralRoi += inv.daily_roi * 0.10;
        if (level === 2) estimatedReferralRoi += inv.daily_roi * 0.04;
        if (level === 3) estimatedReferralRoi += inv.daily_roi * 0.02;
      }
    }

    return {
      activeInvestmentCount: activeInvestments.length,
      estimatedDailyRoi: parseFloat(estimatedDailyRoi.toFixed(2)),
      estimatedReferralRoi: parseFloat(estimatedReferralRoi.toFixed(2)),
      estimatedTotalPayout: parseFloat((estimatedDailyRoi + estimatedReferralRoi).toFixed(2))
    };
  }
}

module.exports = new RoiEngineService();
