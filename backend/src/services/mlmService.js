const { db } = require('../db/database');
const notificationService = require('./notificationService');

class MlmService {
  /**
   * Retrieves up to 3 levels of upline sponsors for a given user.
   */
  async getUplineChain(userId, maxLevels = 3) {
    const chain = [];
    let currentUserId = userId;

    for (let level = 1; level <= maxLevels; level++) {
      const user = await db.get('SELECT id, sponsor_id FROM users WHERE id = ?', [currentUserId]);
      if (!user || !user.sponsor_id) break;

      const sponsor = await db.get('SELECT id, username, email, full_name, status, wallet_balance, roi_balance, commission_balance FROM users WHERE id = ?', [user.sponsor_id]);
      if (!sponsor) break;

      chain.push({ level, user: sponsor });
      currentUserId = sponsor.id;
    }

    return chain;
  }

  /**
   * Distributes one-time Team Commission on plan activation:
   * Level 1: 6%
   * Level 2: 2%
   * Level 3: 1%
   */
  async distributeTeamCommission(investorId, amount, investmentId) {
    const investor = await db.get('SELECT id, username, full_name FROM users WHERE id = ?', [investorId]);

    // Dynamic rates from admin settings, fallback to defaults
    let rates = { 1: 0.06, 2: 0.02, 3: 0.01 };
    try {
      const setting = await db.get("SELECT value FROM system_settings WHERE key = 'team_commission_levels'");
      if (setting && setting.value) {
        const parsed = JSON.parse(setting.value);
        if (Array.isArray(parsed) && parsed.length > 0) {
          rates = {};
          parsed.forEach(item => { rates[item.level] = item.rate / 100; });
        }
      }
    } catch(e) { /* use defaults */ }

    const maxLevel = Math.max(...Object.keys(rates).map(Number), 3);
    const uplines = await this.getUplineChain(investorId, maxLevel);

    const distributions = [];

    for (const { level, user } of uplines) {
      if (user.status !== 'active') continue;

      const rate = rates[level] || 0;
      const commission = parseFloat((amount * rate).toFixed(4));

      if (commission > 0) {
        // Credit sponsor's commission balance
        await db.run('UPDATE users SET commission_balance = commission_balance + ? WHERE id = ?', [commission, user.id]);

        // Record transaction
        await db.run(`
          INSERT INTO transactions (user_id, amount, type, wallet_type, description, reference_id, from_user_id, level, status)
          VALUES (?, ?, 'team_commission', 'commission_balance', ?, ?, ?, ?, 'completed')
        `, [
          user.id,
          commission,
          `Level ${level} Team Commission (${(rate * 100).toFixed(0)}%) from ${investor.username} ($${amount} investment)`,
          `INV-${investmentId}`,
          investor.id,
          level
        ]);

        // Team Commission Notification
        await notificationService.createNotification({
          userId: user.id,
          type: 'commission',
          title: `Level ${level} Team Commission!`,
          message: `+$${commission.toFixed(2)} USDT (${(rate * 100).toFixed(0)}%) received from ${investor.username}'s $${amount} package activation.`,
          amount: commission,
          referenceId: `INV-${investmentId}`
        });

        distributions.push({
          level,
          uplineId: user.id,
          uplineName: user.username,
          percentage: rate * 100,
          amount: commission
        });
      }
    }

    return distributions;
  }

  /**
   * Distributes Referral Income (ROI of ROI):
   * Whenever a user receives Daily ROI:
   * Level 1: 10%
   * Level 2: 4%
   * Level 3: 2%
   */
  async distributeReferralRoi(earnerId, dailyRoiAmount, investmentId) {
    const earner = await db.get('SELECT id, username FROM users WHERE id = ?', [earnerId]);

    // Dynamic rates from admin settings, fallback to defaults
    let rates = { 1: 0.10, 2: 0.04, 3: 0.02 };
    try {
      const setting = await db.get("SELECT value FROM system_settings WHERE key = 'team_roi_levels'");
      if (setting && setting.value) {
        const parsed = JSON.parse(setting.value);
        if (Array.isArray(parsed) && parsed.length > 0) {
          rates = {};
          parsed.forEach(item => { rates[item.level] = item.rate / 100; });
        }
      }
    } catch(e) { /* use defaults */ }

    const maxLevel = Math.max(...Object.keys(rates).map(Number), 3);
    const uplines = await this.getUplineChain(earnerId, maxLevel);

    const distributions = [];

    for (const { level, user } of uplines) {
      if (user.status !== 'active') continue;

      const rate = rates[level] || 0;
      const commission = parseFloat((dailyRoiAmount * rate).toFixed(4));

      if (commission > 0) {
        // Credit sponsor's commission balance
        await db.run('UPDATE users SET commission_balance = commission_balance + ? WHERE id = ?', [commission, user.id]);

        // Record transaction
        await db.run(`
          INSERT INTO transactions (user_id, amount, type, wallet_type, description, reference_id, from_user_id, level, status)
          VALUES (?, ?, 'referral_roi', 'commission_balance', ?, ?, ?, ?, 'completed')
        `, [
          user.id,
          commission,
          `Level ${level} Referral ROI (${(rate * 100).toFixed(0)}%) from ${earner.username}'s Daily ROI ($${dailyRoiAmount})`,
          `ROI-INV-${investmentId}`,
          earner.id,
          level
        ]);

        // Referral ROI Notification
        await notificationService.createNotification({
          userId: user.id,
          type: 'referral_roi',
          title: `Level ${level} Referral ROI!`,
          message: `+$${commission.toFixed(2)} USDT (${(rate * 100).toFixed(0)}%) received from ${earner.username}'s daily ROI ($${dailyRoiAmount.toFixed(2)}).`,
          amount: commission,
          referenceId: `ROI-INV-${investmentId}`
        });

        distributions.push({
          level,
          uplineId: user.id,
          uplineName: user.username,
          percentage: rate * 100,
          amount: commission
        });
      }
    }

    return distributions;
  }

  /**
   * Returns downline summary statistics (counts and volumes per level 1, 2, 3)
   */
  async getDownlineStats(userId) {
    // Level 1
    const l1Users = await db.all('SELECT id, username, full_name, email, phone, created_at, status FROM users WHERE sponsor_id = ?', [userId]);
    const l1Ids = l1Users.map(u => u.id);

    // Level 2
    let l2Users = [];
    if (l1Ids.length > 0) {
      const placeholders = l1Ids.map(() => '?').join(',');
      l2Users = await db.all(`SELECT id, username, full_name, email, phone, created_at, status, sponsor_id FROM users WHERE sponsor_id IN (${placeholders})`, l1Ids);
    }
    const l2Ids = l2Users.map(u => u.id);

    // Level 3
    let l3Users = [];
    if (l2Ids.length > 0) {
      const placeholders = l2Ids.map(() => '?').join(',');
      l3Users = await db.all(`SELECT id, username, full_name, email, phone, created_at, status, sponsor_id FROM users WHERE sponsor_id IN (${placeholders})`, l2Ids);
    }
    const l3Ids = l3Users.map(u => u.id);

    const enrichUsers = async (users) => {
      if (!users || users.length === 0) return { users: [], count: 0, effective: 0, volume: 0, commission: 0 };
      const ids = users.map(u => u.id);
      const placeholders = ids.map(() => '?').join(',');

      // Get active investment per user
      const invRows = await db.all(`
        SELECT user_id, COALESCE(SUM(amount), 0) as active_amount 
        FROM investments 
        WHERE user_id IN (${placeholders}) AND status = 'active'
        GROUP BY user_id
      `, ids);
      const invMap = {};
      invRows.forEach(r => { invMap[r.user_id] = parseFloat(r.active_amount) || 0; });

      // Get commissions paid to userId from these users
      const commRows = await db.all(`
        SELECT from_user_id, COALESCE(SUM(amount), 0) as total_comm 
        FROM transactions 
        WHERE user_id = ? AND from_user_id IN (${placeholders})
        GROUP BY from_user_id
      `, [userId, ...ids]);
      const commMap = {};
      commRows.forEach(r => { commMap[r.from_user_id] = parseFloat(r.total_comm) || 0; });

      let volume = 0;
      let effective = 0;
      let totalComm = 0;

      const enriched = users.map(u => {
        const activeInv = invMap[u.id] || 0;
        const comm = commMap[u.id] || 0;
        volume += activeInv;
        if (activeInv > 0) effective++;
        totalComm += comm;
        return {
          ...u,
          active_investment: activeInv,
          commission_earned: comm
        };
      });

      return {
        users: enriched,
        count: users.length,
        effective,
        volume,
        commission: totalComm
      };
    };

    const [lvl1, lvl2, lvl3] = await Promise.all([
      enrichUsers(l1Users),
      enrichUsers(l2Users),
      enrichUsers(l3Users)
    ]);

    const totalTeam = lvl1.count + lvl2.count + lvl3.count;
    const validUsers = lvl1.effective + lvl2.effective + lvl3.effective;
    const totalRecharge = lvl1.volume + lvl2.volume + lvl3.volume;

    const allDownline = [...lvl1.users, ...lvl2.users, ...lvl3.users];
    const todayStr = new Date().toISOString().slice(0, 10);

    const peopleToday = allDownline.filter(u => {
      if (!u.created_at) return false;
      const d = new Date(u.created_at).toISOString().slice(0, 10);
      return d === todayStr;
    }).length;

    const validToday = allDownline.filter(u => {
      if (!u.created_at) return false;
      const d = new Date(u.created_at).toISOString().slice(0, 10);
      return d === todayStr && u.active_investment > 0;
    }).length;

    // Team withdrawals
    let totalWithdrawals = 0;
    const allIds = [...l1Ids, ...l2Ids, ...l3Ids];
    if (allIds.length > 0) {
      const placeholders = allIds.map(() => '?').join(',');
      const wRow = await db.get(`
        SELECT COALESCE(SUM(amount), 0) as total 
        FROM withdrawals 
        WHERE user_id IN (${placeholders}) AND status = 'approved'
      `, allIds);
      if (wRow && wRow.total) totalWithdrawals = parseFloat(wRow.total);
    }

    return {
      totalTeam,
      validUsers,
      totalRecharge,
      minTransactionAmount: 11.0,
      peopleToday,
      validToday,
      totalWithdrawals,
      levels: {
        level1: lvl1,
        level2: lvl2,
        level3: lvl3
      }
    };
  }

  /**
   * Generates a recursive hierarchical tree node for visualization
   */
  async getUserTreeNode(userId, depth = 3) {
    const user = await db.get(`
      SELECT u.id, u.username, u.full_name, u.referral_code, u.status, u.created_at,
             COALESCE((SELECT SUM(amount) FROM investments WHERE user_id = u.id AND status = 'active'), 0) as active_investment
      FROM users u WHERE u.id = ?
    `, [userId]);

    if (!user) return null;

    if (depth <= 0) {
      return { ...user, children: [] };
    }

    const children = await db.all('SELECT id FROM users WHERE sponsor_id = ?', [userId]);
    const childNodes = await Promise.all(
      children.map(c => this.getUserTreeNode(c.id, depth - 1))
    );

    return {
      ...user,
      children: childNodes.filter(Boolean)
    };
  }
}

module.exports = new MlmService();
