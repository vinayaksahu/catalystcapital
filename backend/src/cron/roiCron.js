const cron = require('node-cron');
const roiEngineService = require('../services/roiEngineService');

function startRoiCron() {
  // Run daily at midnight (00:00:00) server time
  cron.schedule('0 0 * * *', () => {
    console.log('[CRON] Running scheduled Daily ROI & Referral Income cycle...');
    try {
      const result = roiEngineService.processDailyRoi(false);
      console.log(`[CRON] Completed: Processed ${result.processedInvestments} investments, Distributed ROI: $${result.totalRoiDistributed}, Referral ROI: $${result.totalReferralRoiDistributed}`);
    } catch (err) {
      console.error('[CRON ERROR] Failed to process daily ROI:', err.message);
    }
  });

  console.log('[CRON] Daily ROI scheduler initialized (00:00 midnight daily)');
}

module.exports = { startRoiCron };
