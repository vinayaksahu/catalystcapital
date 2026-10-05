const express = require('express');
const router = express.Router();
const roiEngineService = require('../services/roiEngineService');

// Endpoint invoked by Vercel Cron or external schedulers
router.get('/daily-roi', async (req, res) => {
  try {
    // Optional secret verification for Vercel Cron
    const authHeader = req.headers['authorization'];
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ success: false, error: 'Unauthorized cron invocation' });
    }

    console.log('[CRON] Vercel scheduled Daily ROI & Referral Income triggered...');
    const result = await roiEngineService.processDailyRoi(false);
    console.log(`[CRON] Processed ${result.processedInvestments} investments, ROI Paid: $${result.totalRoiDistributed}`);

    res.json({
      success: true,
      invokedAt: new Date().toISOString(),
      ...result
    });
  } catch (err) {
    console.error('[CRON ERROR]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
