const { db } = require('../db/database');

class MlmService {
  /**
   * Retrieves up to 3 levels of upline sponsors for a given user.
   * @param {number} userId 
   * @returns {Array<{ level: number, user: object }>}
   */
  getUplineChain(userId, maxLevels = 3) {
    const chain = [];
    let currentUserId = userId;

    for (let level = 1; level <= maxLevels; level++) {
      const user = db.prepare('SELECT id, sponsor_id FROM users WHERE id = ?').get(currentUserId);
      if (!user || !user.sponsor_id) break;

      const sponsor = db.prepare('SELECT id, username, email, full_name, status, wallet_balance, roi_balance, commission_balance FROM users WHERE id = ?').get(user.sponsor_id);
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
   * @param {number} investorId
   * @param {number} amount
   * @param {number} investmentId
   */
  distributeTeamCommission(investorId, amount, investmentId) {
    const uplines = this.getUplineChain(investorId, 3);
    const investor = db.prepare('SELECT id, username, full_name FROM users WHERE id = ?').get(investorId);

    const rates = {
      1: 0.06, // 6%
      2: 0.02, // 2%
      3: 0.01  // 1%
    };

    const distributions = [];

    for (const { level, user } of uplines) {
      if (user.status !== 'active') continue;

      const rate = rates[level] || 0;
      const commission = parseFloat((amount * rate).toFixed(4));

      if (commission > 0) {
        // Credit sponsor's commission balance
        db.prepare('UPDATE users SET commission_balance = commission_balance + ? WHERE id = ?').run(commission, user.id);

        // Record transaction
        db.prepare(`
          INSERT INTO transactions (user_id, amount, type, wallet_type, description, reference_id, from_user_id, level, status)
          VALUES (?, ?, 'team_commission', 'commission_balance', ?, ?, ?, ?, 'completed')
        `).run(
          user.id,
          commission,
          `Level ${level} Team Commission (${(rate * 100).toFixed(0)}%) from ${investor.username} ($${amount} investment)`,
          `INV-${investmentId}`,
          investor.id,
          level
        );

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
   * @param {number} earnerId
   * @param {number} dailyRoiAmount
   * @param {number} investmentId
   */
  distributeReferralRoi(earnerId, dailyRoiAmount, investmentId) {
    const uplines = this.getUplineChain(earnerId, 3);
    const earner = db.prepare('SELECT id, username FROM users WHERE id = ?').get(earnerId);

    const rates = {
      1: 0.10, // 10%
      2: 0.04, // 4%
      3: 0.02  // 2%
    };

    const distributions = [];

    for (const { level, user } of uplines) {
      if (user.status !== 'active') continue;

      const rate = rates[level] || 0;
      const commission = parseFloat((dailyRoiAmount * rate).toFixed(4));

      if (commission > 0) {
        // Credit sponsor's commission balance
        db.prepare('UPDATE users SET commission_balance = commission_balance + ? WHERE id = ?').run(commission, user.id);

        // Record transaction
        db.prepare(`
          INSERT INTO transactions (user_id, amount, type, wallet_type, description, reference_id, from_user_id, level, status)
          VALUES (?, ?, 'referral_roi', 'commission_balance', ?, ?, ?, ?, 'completed')
        `).run(
          user.id,
          commission,
          `Level ${level} Referral ROI (${(rate * 100).toFixed(0)}%) from ${earner.username}'s Daily ROI ($${dailyRoiAmount})`,
          `ROI-INV-${investmentId}`,
          earner.id,
          level
        );

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
   * @param {number} userId
   */
  getDownlineStats(userId) {
    // Level 1
    const l1Users = db.prepare('SELECT id, username, full_name, email, phone, created_at, status FROM users WHERE sponsor_id = ?').all(userId);
    const l1Ids = l1Users.map(u => u.id);

    // Level 2
    let l2Users = [];
    if (l1Ids.length > 0) {
      const placeholders = l1Ids.map(() => '?').join(',');
      l2Users = db.prepare(`SELECT id, username, full_name, email, phone, created_at, status, sponsor_id FROM users WHERE sponsor_id IN (${placeholders})`).all(...l1Ids);
    }
    const l2Ids = l2Users.map(u => u.id);

    // Level 3
    let l3Users = [];
    if (l2Ids.length > 0) {
      const placeholders = l2Ids.map(() => '?').join(',');
      l3Users = db.prepare(`SELECT id, username, full_name, email, phone, created_at, status, sponsor_id FROM users WHERE sponsor_id IN (${placeholders})`).all(...l2Ids);
    }
    const l3Ids = l3Users.map(u => u.id);

    const getVolume = (ids) => {
      if (ids.length === 0) return 0;
      const placeholders = ids.map(() => '?').join(',');
      const res = db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM investments WHERE user_id IN (${placeholders}) AND status = 'active'`).get(...ids);
      return res.total || 0;
    };

    return {
      totalTeam: l1Users.length + l2Users.length + l3Users.length,
      levels: {
        level1: {
          count: l1Users.length,
          volume: getVolume(l1Ids),
          users: l1Users
        },
        level2: {
          count: l2Users.length,
          volume: getVolume(l2Ids),
          users: l2Users
        },
        level3: {
          count: l3Users.length,
          volume: getVolume(l3Ids),
          users: l3Users
        }
      }
    };
  }

  /**
   * Generates a recursive hierarchical tree node for visualization
   */
  getUserTreeNode(userId, depth = 3) {
    const user = db.prepare(`
      SELECT u.id, u.username, u.full_name, u.referral_code, u.status, u.created_at,
             COALESCE((SELECT SUM(amount) FROM investments WHERE user_id = u.id AND status = 'active'), 0) as active_investment
      FROM users u WHERE u.id = ?
    `).get(userId);

    if (!user) return null;

    if (depth <= 0) {
      return { ...user, children: [] };
    }

    const children = db.prepare('SELECT id FROM users WHERE sponsor_id = ?').all(userId);
    const childNodes = children.map(c => this.getUserTreeNode(c.id, depth - 1)).filter(Boolean);

    return {
      ...user,
      children: childNodes
    };
  }
}

module.exports = new MlmService();
