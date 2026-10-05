const { db } = require('../db/database');
const mlmService = require('./mlmService');

class RoiEngineService {
  /**
   * Process daily ROI for all active investments and distribute ROI of ROI to upline
   * @param {boolean} force - if true, bypasses 24hr/same-day check (useful for manual runs/testing)
   */
  processDailyRoi(force = false) {
    const today = new Date().toISOString().split('T')[0];

    // Find all active investments that still have days remaining
    const activeInvestments = db.prepare(`
      SELECT i.*, p.name as plan_name, u.username, u.status as user_status
      FROM investments i
      JOIN plans p ON i.plan_id = p.id
      JOIN users u ON i.user_id = u.id
      WHERE i.status = 'active'
        AND i.days_credited < i.total_days
        AND u.status = 'active'
    `).all();

    let processedCount = 0;
    let totalRoiDistributed = 0;
    let totalReferralRoiDistributed = 0;
    const details = [];

    for (const inv of activeInvestments) {
      // If not forced, prevent double processing on the same calendar day
      if (!force && inv.last_roi_at) {
        const lastDate = inv.last_roi_at.split(' ')[0];
        if (lastDate === today) {
          continue;
        }
      }

      const dailyRoi = inv.daily_roi;
      const nextDaysCredited = inv.days_credited + 1;
      const isCompleted = nextDaysCredited >= inv.total_days;
      const newStatus = isCompleted ? 'completed' : 'active';
      const completedAt = isCompleted ? "datetime('now')" : null;

      // 1. Update investment record
      db.prepare(`
        UPDATE investments
        SET days_credited = days_credited + 1,
            total_earned = total_earned + ?,
            last_roi_at = datetime('now'),
            status = ?,
            completed_at = ${isCompleted ? "datetime('now')" : "NULL"}
        WHERE id = ?
      `).run(dailyRoi, newStatus, inv.id);

      // 2. Credit user's ROI wallet
      db.prepare('UPDATE users SET roi_balance = roi_balance + ? WHERE id = ?').run(dailyRoi, inv.user_id);

      // 3. Log user's daily ROI transaction
      db.prepare(`
        INSERT INTO transactions (user_id, amount, type, wallet_type, description, reference_id, status)
        VALUES (?, ?, 'daily_roi', 'roi_balance', ?, ?, 'completed')
      `).run(
        inv.user_id,
        dailyRoi,
        `Daily ROI Payout (Day ${nextDaysCredited}/${inv.total_days}) for ${inv.plan_name} ($${inv.amount})`,
        `ROI-INV-${inv.id}`
      );

      totalRoiDistributed += dailyRoi;
      processedCount++;

      // 4. Distribute Referral Income (ROI of ROI)
      // Level 1: 10%, Level 2: 4%, Level 3: 2%
      const referralDistributions = mlmService.distributeReferralRoi(inv.user_id, dailyRoi, inv.id);
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
   * Dry-run estimate of the next daily cycle
   */
  getPendingRoiSummary() {
    const activeInvestments = db.prepare(`
      SELECT i.*, p.name as plan_name, u.username
      FROM investments i
      JOIN plans p ON i.plan_id = p.id
      JOIN users u ON i.user_id = u.id
      WHERE i.status = 'active'
        AND i.days_credited < i.total_days
        AND u.status = 'active'
    `).all();

    let estimatedDailyRoi = 0;
    let estimatedReferralRoi = 0;

    for (const inv of activeInvestments) {
      estimatedDailyRoi += inv.daily_roi;
      // Max potential referral ROI (10% + 4% + 2% = 16%)
      const uplines = mlmService.getUplineChain(inv.user_id, 3);
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
