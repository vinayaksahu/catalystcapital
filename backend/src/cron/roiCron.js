const cron = require('node-cron');
const roiEngineService = require('../services/roiEngineService');
const { db } = require('../db/database');

let currentCronJob = null;
let currentCronExpression = '0 0 * * *';

async function getScheduledTime() {
  try {
    const setting = await db.get("SELECT value FROM system_settings WHERE key = 'roi_closing_time'");
    if (setting && setting.value) {
      const [hours, minutes] = setting.value.split(':').map(Number);
      if (!isNaN(hours) && !isNaN(minutes)) {
        return `${minutes} ${hours} * * *`;
      }
    }
  } catch(e) { /* use default */ }
  return '0 0 * * *'; // Default midnight
}

function scheduleCron(cronExpression) {
  if (currentCronJob) {
    currentCronJob.stop();
  }
  currentCronExpression = cronExpression;
  currentCronJob = cron.schedule(cronExpression, async () => {
    console.log('[CRON] Running scheduled Daily ROI & Referral Income cycle...');
    try {
      const result = await roiEngineService.processDailyRoi(false);
      console.log(`[CRON] Completed: Processed ${result.processedInvestments} investments, Distributed ROI: $${result.totalRoiDistributed}, Referral ROI: $${result.totalReferralRoiDistributed}`);
    } catch (err) {
      console.error('[CRON ERROR] Failed to process daily ROI:', err.message);
    }
  });
  console.log(`[CRON] Daily ROI scheduler set to: ${cronExpression}`);
}

async function startRoiCron() {
  const cronExpr = await getScheduledTime();
  scheduleCron(cronExpr);

  // Check for time changes every 5 minutes
  setInterval(async () => {
    const newExpr = await getScheduledTime();
    if (newExpr !== currentCronExpression) {
      console.log(`[CRON] ROI closing time changed from ${currentCronExpression} to ${newExpr}, rescheduling...`);
      scheduleCron(newExpr);
    }
  }, 5 * 60 * 1000);
}

module.exports = { startRoiCron };
