const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../db/database');
const roiEngineService = require('../services/roiEngineService');
const walletService = require('../services/walletService');
const notificationService = require('../services/notificationService');
const { authenticateToken, requireAdmin, requireSuperAdmin, JWT_SECRET } = require('../middleware/authMiddleware');

router.use(authenticateToken);
router.use(requireAdmin);

/**
 * Helper to determine team scope
 * Superadmin can view all teams or filter by ?teamAdminId=
 * Team Admin is strictly locked to their own team (req.user.id)
 */
function getAdminScope(req) {
  if (req.user.role === 'superadmin') {
    const filterId = req.query.teamAdminId ? parseInt(req.query.teamAdminId, 10) : null;
    return {
      isSuperAdmin: true,
      teamAdminId: filterId && !isNaN(filterId) ? filterId : null
    };
  }
  return {
    isSuperAdmin: false,
    teamAdminId: req.user.id
  };
}

/**
 * Verify user belongs to the caller's team (security isolation)
 */
async function assertUserInTeam(userId, req) {
  const target = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!target) {
    const err = new Error('Target user not found');
    err.status = 404;
    throw err;
  }
  if (req.user.role !== 'superadmin') {
    if (target.team_admin_id !== req.user.id && target.sponsor_id !== req.user.id) {
      const err = new Error('Unauthorized: User does not belong to your team');
      err.status = 403;
      throw err;
    }
  }
  return target;
}

// -------------------------------------------------------------
// Admin / Superadmin Identity & Scope Profile
// -------------------------------------------------------------
router.get('/me', async (req, res) => {
  try {
    const adminUser = await db.get(`
      SELECT id, username, email, full_name, role, referral_code, team_admin_id, team_name, wallet_balance, created_at
      FROM users WHERE id = ?
    `, [req.user.id]);

    const isSuper = adminUser.role === 'superadmin';
    const teamAdmins = isSuper ? await db.all(`
      SELECT id, username, full_name, team_name, referral_code, status
      FROM users WHERE role = 'admin' ORDER BY id ASC
    `) : [];

    res.json({
      success: true,
      admin: adminUser,
      isSuperAdmin: isSuper,
      teamName: adminUser.team_name || (isSuper ? 'Super Root Administration' : adminUser.username),
      referralCode: adminUser.referral_code,
      teamAdmins
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// Super Root Admin: Team Admins Management
// -------------------------------------------------------------
router.get('/team-admins', requireSuperAdmin, async (req, res) => {
  try {
    const teamAdmins = await db.all(`
      SELECT a.id, a.username, a.email, a.full_name, a.team_name, a.referral_code, a.status, a.created_at, a.wallet_balance,
             (SELECT COUNT(*) FROM users WHERE (team_admin_id = a.id OR sponsor_id = a.id) AND role = 'user') as total_members,
             COALESCE((SELECT COUNT(DISTINCT user_id) FROM investments WHERE user_id IN (SELECT id FROM users WHERE team_admin_id = a.id OR sponsor_id = a.id) AND status = 'active'), 0) as active_investors,
             COALESCE((SELECT SUM(amount) FROM investments WHERE user_id IN (SELECT id FROM users WHERE team_admin_id = a.id OR sponsor_id = a.id)), 0) as total_investments,
             COALESCE((SELECT SUM(amount) FROM deposits WHERE user_id IN (SELECT id FROM users WHERE team_admin_id = a.id OR sponsor_id = a.id) AND status = 'completed'), 0) as total_deposits,
             COALESCE((SELECT SUM(amount) FROM withdrawals WHERE user_id IN (SELECT id FROM users WHERE team_admin_id = a.id OR sponsor_id = a.id) AND status = 'approved'), 0) as total_withdrawals
      FROM users a
      WHERE a.role = 'admin'
      ORDER BY a.id ASC
    `);

    res.json({ success: true, teamAdmins });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/team-admins', requireSuperAdmin, async (req, res) => {
  try {
    const { username, email, password, fullName, teamName, referralCode, initialBalance = 0 } = req.body;
    if (!username || !email || !password || !fullName || !teamName) {
      return res.status(400).json({ success: false, error: 'Username, email, password, full name, and team name are required' });
    }

    const cleanUsername = username.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanRef = (referralCode || cleanUsername).trim().toUpperCase();

    const existing = await db.get(
      'SELECT id FROM users WHERE lower(username) = ? OR lower(email) = ? OR upper(referral_code) = ?',
      [cleanUsername.toLowerCase(), cleanEmail, cleanRef]
    );

    if (existing) {
      return res.status(400).json({ success: false, error: 'Username, email or referral code already in use' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const numBalance = Math.max(0, parseFloat(initialBalance) || 0);

    const insert = await db.run(`
      INSERT INTO users (username, email, password_hash, full_name, phone, role, referral_code, team_name, wallet_balance, status)
      VALUES (?, ?, ?, ?, '+10000000000', 'admin', ?, ?, ?, 'active')
    `, [cleanUsername, cleanEmail, passwordHash, fullName.trim(), cleanRef, teamName.trim(), numBalance]);

    const newId = insert.lastInsertRowid;
    await db.run('UPDATE users SET team_admin_id = ? WHERE id = ?', [newId, newId]);

    res.json({
      success: true,
      message: `Team Admin @${cleanUsername} (${teamName}) created successfully`,
      admin: {
        id: newId,
        username: cleanUsername,
        team_name: teamName.trim(),
        referral_code: cleanRef,
        email: cleanEmail
      }
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.put('/team-admins/:id', requireSuperAdmin, async (req, res) => {
  try {
    const adminId = parseInt(req.params.id, 10);
    const target = await db.get("SELECT * FROM users WHERE id = ? AND role = 'admin'", [adminId]);
    if (!target) return res.status(404).json({ success: false, error: 'Team Admin not found' });

    const { fullName, teamName, status, password } = req.body;

    if (fullName) {
      await db.run('UPDATE users SET full_name = ? WHERE id = ?', [fullName.trim(), adminId]);
    }
    if (teamName) {
      await db.run('UPDATE users SET team_name = ? WHERE id = ?', [teamName.trim(), adminId]);
    }
    if (status && ['active', 'suspended'].includes(status)) {
      await db.run('UPDATE users SET status = ? WHERE id = ?', [status, adminId]);
    }
    if (password && password.trim().length >= 6) {
      const passwordHash = await bcrypt.hash(password.trim(), 10);
      await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, adminId]);
    }

    res.json({ success: true, message: `Team Admin @${target.username} updated successfully` });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Impersonate Team Admin (for Super Root Admin)
router.post('/team-admins/:id/impersonate', requireSuperAdmin, async (req, res) => {
  try {
    const adminId = parseInt(req.params.id, 10);
    const targetAdmin = await db.get("SELECT * FROM users WHERE id = ? AND role = 'admin'", [adminId]);
    if (!targetAdmin) return res.status(404).json({ success: false, error: 'Team Admin not found' });

    const impersonationToken = jwt.sign(
      { id: targetAdmin.id, username: targetAdmin.username, role: targetAdmin.role, impersonatedBy: req.user.username },
      JWT_SECRET,
      { expiresIn: '3h' }
    );

    const { password_hash, ...safeAdmin } = targetAdmin;
    res.json({
      success: true,
      token: impersonationToken,
      admin: safeAdmin
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// Scoped Users Management
// -------------------------------------------------------------
router.get('/users', async (req, res) => {
  try {
    const scope = getAdminScope(req);
    let query = `
      SELECT u.id, u.username, u.email, u.full_name, u.phone, u.role, u.referral_code, u.sponsor_id,
             u.team_admin_id, u.team_name,
             u.wallet_balance, u.roi_balance, u.commission_balance, u.usdt_address, u.status, u.created_at,
             s.username as sponsor_username,
             tm.username as team_admin_username,
             tm.team_name as team_admin_team_name,
             COALESCE((SELECT SUM(amount) FROM investments WHERE user_id = u.id AND status = 'active'), 0) as active_invested
      FROM users u
      LEFT JOIN users s ON u.sponsor_id = s.id
      LEFT JOIN users tm ON u.team_admin_id = tm.id
      WHERE u.role = 'user'
    `;
    const params = [];
    if (scope.teamAdminId) {
      query += ` AND (u.team_admin_id = ? OR u.sponsor_id = ?)`;
      params.push(scope.teamAdminId, scope.teamAdminId);
    }
    query += ` ORDER BY u.created_at DESC`;

    const users = await db.all(query, params);
    res.json({ success: true, users, scopedTeamAdminId: scope.teamAdminId, isSuperAdmin: scope.isSuperAdmin });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Adjust balance manually (Scoped to team)
router.post('/adjust-balance', async (req, res) => {
  try {
    const { userId, amount, walletType = 'wallet_balance', action = 'credit', reason = 'Admin adjustment' } = req.body;
    const numAmount = Number(amount);

    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Amount must be a valid number greater than 0' });
    }

    const parsedUserId = parseInt(userId, 10);
    if (isNaN(parsedUserId) || parsedUserId <= 0) {
      return res.status(400).json({ success: false, error: 'Valid userId is required' });
    }

    const allowedWallets = ['wallet_balance', 'roi_balance', 'commission_balance'];
    if (!allowedWallets.includes(walletType)) {
      return res.status(400).json({ success: false, error: 'Invalid walletType. Must be wallet_balance, roi_balance, or commission_balance.' });
    }

    if (action !== 'credit' && action !== 'debit') {
      return res.status(400).json({ success: false, error: 'Invalid action. Must be credit or debit.' });
    }

    // Security verify: caller has authority over user
    const targetUser = await assertUserInTeam(parsedUserId, req);

    const currentBalance = parseFloat(targetUser[walletType]) || 0;
    if (action === 'debit' && currentBalance < numAmount) {
      return res.status(400).json({
        success: false,
        error: `Cannot debit $${numAmount}. User only has $${currentBalance.toFixed(2)} in ${walletType.replace('_', ' ')}.`
      });
    }

    const delta = action === 'debit' ? -numAmount : numAmount;

    await db.run(
      `UPDATE users SET ${walletType} = ${walletType} + ? WHERE id = ? AND (${action === 'debit' ? `${walletType} >= ${numAmount}` : '1=1'})`,
      [delta, parsedUserId]
    );

    await db.run(`
      INSERT INTO transactions (user_id, amount, type, wallet_type, description, status)
      VALUES (?, ?, 'admin_adjustment', ?, ?, 'completed')
    `, [parsedUserId, delta, walletType, `Admin Adjustment: ${action.toUpperCase()} $${numAmount} (${reason})`]);

    await notificationService.createNotification({
      userId: parsedUserId,
      type: 'adjustment',
      title: `Balance ${action === 'debit' ? 'Debited' : 'Credited'} by Admin`,
      message: `${action === 'debit' ? '-' : '+'}$${numAmount} USDT adjusted in your ${walletType.replace('_', ' ')} (${reason}).`,
      amount: delta
    });

    res.json({ success: true, message: `Successfully adjusted balance by ${delta}` });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// Scoped Withdrawals List & Actions
// -------------------------------------------------------------
router.get('/withdrawals', async (req, res) => {
  try {
    const scope = getAdminScope(req);
    let query = `
      SELECT w.*, u.username, u.full_name, u.email, u.team_admin_id, tm.team_name, tm.username as team_admin_username
      FROM withdrawals w
      JOIN users u ON w.user_id = u.id
      LEFT JOIN users tm ON u.team_admin_id = tm.id
    `;
    const params = [];
    if (scope.teamAdminId) {
      query += ` WHERE (u.team_admin_id = ? OR u.sponsor_id = ?)`;
      params.push(scope.teamAdminId, scope.teamAdminId);
    }
    query += ` ORDER BY w.created_at DESC`;

    const withdrawals = await db.all(query, params);
    res.json({ success: true, withdrawals });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/withdrawals/:id/approve', async (req, res) => {
  try {
    const w = await db.get('SELECT * FROM withdrawals WHERE id = ?', [req.params.id]);
    if (!w) return res.status(404).json({ success: false, error: 'Withdrawal not found' });
    await assertUserInTeam(w.user_id, req);

    const { txHash, adminNote } = req.body;
    const result = await walletService.approveWithdrawal(Number(req.params.id), txHash, adminNote);
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

router.post('/withdrawals/:id/reject', async (req, res) => {
  try {
    const w = await db.get('SELECT * FROM withdrawals WHERE id = ?', [req.params.id]);
    if (!w) return res.status(404).json({ success: false, error: 'Withdrawal not found' });
    await assertUserInTeam(w.user_id, req);

    const { reason } = req.body;
    const result = await walletService.rejectWithdrawal(Number(req.params.id), reason);
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// Daily ROI Engine Trigger & Schedule
// -------------------------------------------------------------
router.post('/trigger-daily-roi', async (req, res) => {
  try {
    const { force = false } = req.body;

    if (!force) {
      const setting = await db.get("SELECT value FROM system_settings WHERE key = 'roi_closing_time'");
      const closingTime = setting?.value || '00:00';
      const [closeHour, closeMin] = closingTime.split(':').map(Number);

      const now = new Date();
      const currentMinutesOfDay = now.getHours() * 60 + now.getMinutes();
      const closingMinutesOfDay = closeHour * 60 + closeMin;

      if (currentMinutesOfDay < closingMinutesOfDay) {
        return res.status(400).json({
          success: false,
          error: `Daily ROI cycle is locked until automatic closing time (${closingTime}). Please wait for scheduled execution.`
        });
      }
    }

    const result = await roiEngineService.processDailyRoi(force);
    if (!result.success && result.alreadyExecutedToday) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/pending-roi-summary', async (req, res) => {
  try {
    const forecast = await roiEngineService.getPendingRoiSummary();
    res.json({ success: true, forecast });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// Scoped Platform / Team Stats
// -------------------------------------------------------------
router.get('/stats', async (req, res) => {
  try {
    const scope = getAdminScope(req);
    let userFilter = "role = 'user'";
    let userFilterParams = [];
    let userSubquery = "";

    if (scope.teamAdminId) {
      userFilter = "(team_admin_id = ? OR sponsor_id = ?) AND role = 'user'";
      userFilterParams = [scope.teamAdminId, scope.teamAdminId];
      userSubquery = "WHERE user_id IN (SELECT id FROM users WHERE (team_admin_id = ? OR sponsor_id = ?) AND role = 'user')";
    }

    const totalUsersRow = await db.get(`SELECT COUNT(*) as c FROM users WHERE ${userFilter}`, userFilterParams);
    const totalUsers = totalUsersRow ? parseInt(totalUsersRow.c, 10) : 0;

    const teamParams = scope.teamAdminId ? [scope.teamAdminId, scope.teamAdminId] : [];

    const totalInvestments = await db.get(
      `SELECT COUNT(*) as c, COALESCE(SUM(amount), 0) as vol FROM investments ${userSubquery}`,
      teamParams
    );
    const activeInvestments = await db.get(
      `SELECT COUNT(*) as c, COALESCE(SUM(amount), 0) as vol FROM investments ${userSubquery ? `${userSubquery} AND status = 'active'` : "WHERE status = 'active'"}`,
      teamParams
    );

    const totalDepositsCompleted = await db.get(
      `SELECT COUNT(*) as c, COALESCE(SUM(amount), 0) as vol FROM deposits ${userSubquery ? `${userSubquery} AND status = 'completed'` : "WHERE status = 'completed'"}`,
      teamParams
    );
    const pendingDeposits = await db.get(
      `SELECT COUNT(*) as c, COALESCE(SUM(amount), 0) as vol FROM deposits ${userSubquery ? `${userSubquery} AND status = 'pending'` : "WHERE status = 'pending'"}`,
      teamParams
    );

    const roiPaidRow = await db.get(
      `SELECT COALESCE(SUM(amount), 0) as total FROM transactions ${userSubquery ? `${userSubquery} AND type = 'daily_roi' AND status = 'completed'` : "WHERE type = 'daily_roi' AND status = 'completed'"}`,
      teamParams
    );
    const referralRoiPaidRow = await db.get(
      `SELECT COALESCE(SUM(amount), 0) as total FROM transactions ${userSubquery ? `${userSubquery} AND type = 'referral_roi' AND status = 'completed'` : "WHERE type = 'referral_roi' AND status = 'completed'"}`,
      teamParams
    );
    const teamCommissionPaidRow = await db.get(
      `SELECT COALESCE(SUM(amount), 0) as total FROM transactions ${userSubquery ? `${userSubquery} AND type = 'team_commission' AND status = 'completed'` : "WHERE type = 'team_commission' AND status = 'completed'"}`,
      teamParams
    );

    const roiPaid = roiPaidRow ? roiPaidRow.total : 0;
    const referralRoiPaid = referralRoiPaidRow ? referralRoiPaidRow.total : 0;
    const teamCommissionPaid = teamCommissionPaidRow ? teamCommissionPaidRow.total : 0;

    const pendingWithdrawals = await db.get(
      `SELECT COUNT(*) as c, COALESCE(SUM(amount), 0) as vol FROM withdrawals ${userSubquery ? `${userSubquery} AND status = 'pending'` : "WHERE status = 'pending'"}`,
      teamParams
    );
    const approvedWithdrawals = await db.get(
      `SELECT COUNT(*) as c, COALESCE(SUM(amount), 0) as vol FROM withdrawals ${userSubquery ? `${userSubquery} AND status = 'approved'` : "WHERE status = 'approved'"}`,
      teamParams
    );

    const openTicketsRow = await db.get(
      `SELECT COUNT(*) as c FROM support_tickets ${userSubquery ? `${userSubquery} AND status = 'open'` : "WHERE status = 'open'"}`,
      teamParams
    );

    // Fetch ROI Closing Time & Last Execution
    const roiClosingTimeRow = await db.get("SELECT value FROM system_settings WHERE key = 'roi_closing_time'");
    const lastRoiCycleDateRow = await db.get("SELECT value FROM system_settings WHERE key = 'last_roi_cycle_date'");
    const lastRoiCycleAtRow = await db.get("SELECT value FROM system_settings WHERE key = 'last_roi_cycle_at'");
    const todayStr = new Date().toISOString().split('T')[0];
    const alreadyExecutedToday = lastRoiCycleDateRow?.value === todayStr;

    const totalInvestmentVol = totalInvestments ? totalInvestments.vol : 0;
    const totalDepositVol = totalDepositsCompleted ? totalDepositsCompleted.vol : 0;
    const totalBusiness = Math.max(totalInvestmentVol, totalDepositVol);

    res.json({
      success: true,
      isSuperAdmin: scope.isSuperAdmin,
      scopedTeamAdminId: scope.teamAdminId,
      stats: {
        totalUsers,
        totalBusiness,
        totalDepositsVolume: totalDepositVol,
        totalDepositsCount: totalDepositsCompleted ? parseInt(totalDepositsCompleted.c, 10) : 0,
        pendingDepositsCount: pendingDeposits ? parseInt(pendingDeposits.c, 10) : 0,
        pendingDepositsVolume: pendingDeposits ? pendingDeposits.vol : 0,
        totalInvestments: totalInvestments ? parseInt(totalInvestments.c, 10) : 0,
        totalInvestmentVolume: totalInvestmentVol,
        activeInvestments: activeInvestments ? parseInt(activeInvestments.c, 10) : 0,
        activeInvestmentVolume: activeInvestments ? activeInvestments.vol : 0,
        totalRoiDistributed: roiPaid,
        totalReferralRoiDistributed: referralRoiPaid,
        totalTeamCommissionDistributed: teamCommissionPaid,
        totalPayouts: roiPaid + referralRoiPaid + teamCommissionPaid,
        pendingWithdrawalsCount: pendingWithdrawals ? parseInt(pendingWithdrawals.c, 10) : 0,
        pendingWithdrawalsVolume: pendingWithdrawals ? pendingWithdrawals.vol : 0,
        approvedWithdrawalsCount: approvedWithdrawals ? parseInt(approvedWithdrawals.c, 10) : 0,
        approvedWithdrawalsVolume: approvedWithdrawals ? approvedWithdrawals.vol : 0,
        openTicketsCount: openTicketsRow ? parseInt(openTicketsRow.c, 10) : 0,
        roiClosingTime: roiClosingTimeRow ? roiClosingTimeRow.value : '00:00',
        lastRoiCycleDate: lastRoiCycleDateRow ? lastRoiCycleDateRow.value : null,
        lastRoiExecution: lastRoiCycleAtRow ? lastRoiCycleAtRow.value : null,
        alreadyExecutedToday
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Impersonate any user
router.post('/impersonate/:id', async (req, res) => {
  try {
    const targetUser = await assertUserInTeam(req.params.id, req);

    if (targetUser.role === 'admin' || targetUser.role === 'superadmin') {
      return res.status(400).json({ success: false, error: 'Cannot open portal for administrator account' });
    }

    const impersonationToken = jwt.sign(
      { id: targetUser.id, username: targetUser.username, role: targetUser.role, impersonatedBy: req.user.username },
      JWT_SECRET,
      { expiresIn: '2h' }
    );

    const { password_hash, ...safeUser } = targetUser;
    res.json({
      success: true,
      token: impersonationToken,
      user: safeUser
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// View specific user's comprehensive portfolio details
router.get('/users/:id/details', async (req, res) => {
  try {
    const user = await db.get(`
      SELECT u.*, s.username as sponsor_username, s.full_name as sponsor_name
      FROM users u
      LEFT JOIN users s ON u.sponsor_id = s.id
      WHERE u.id = ?
    `, [req.params.id]);

    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    await assertUserInTeam(user.id, req);

    const investments = await db.all(`
      SELECT i.*, p.name as plan_name
      FROM investments i
      JOIN plans p ON i.plan_id = p.id
      WHERE i.user_id = ?
      ORDER BY i.created_at DESC
    `, [req.params.id]);

    const deposits = await db.all('SELECT * FROM deposits WHERE user_id = ? ORDER BY created_at DESC', [req.params.id]);
    const withdrawals = await db.all('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC', [req.params.id]);
    const directReferrals = await db.all('SELECT id, username, full_name, email, wallet_balance, status, created_at FROM users WHERE sponsor_id = ?', [req.params.id]);

    res.json({
      success: true,
      user,
      investments,
      deposits,
      withdrawals,
      directReferrals
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// Manage User Status (active, suspended)
router.post('/users/:id/status', async (req, res) => {
  try {
    await assertUserInTeam(req.params.id, req);
    const { status } = req.body;
    if (!['active', 'suspended', 'inactive'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }
    await db.run('UPDATE users SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ success: true, message: `User status changed to ${status}` });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// Admin Update User BEP-20 Wallet Address
router.post('/users/:id/wallet-address', async (req, res) => {
  try {
    await assertUserInTeam(req.params.id, req);
    const { walletAddress } = req.body;
    if (!walletAddress || !walletAddress.trim()) {
      return res.status(400).json({ success: false, error: 'Valid BEP-20 wallet address is required' });
    }
    const cleanAddr = walletAddress.trim();
    await db.run('UPDATE users SET usdt_address = ? WHERE id = ?', [cleanAddr, req.params.id]);

    await notificationService.createNotification({
      userId: req.params.id,
      type: 'adjustment',
      title: 'BEP-20 Wallet Address Updated',
      message: `Your BEP-20 wallet address has been updated to ${cleanAddr} by Administrator.`,
      referenceId: cleanAddr
    });

    res.json({ success: true, message: 'User wallet address updated successfully', usdt_address: cleanAddr });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// Scoped Deposits List & Approval / Rejection
// -------------------------------------------------------------
router.get('/deposits', async (req, res) => {
  try {
    const scope = getAdminScope(req);
    let query = `
      SELECT d.*, u.username, u.full_name, u.email, u.team_admin_id, tm.team_name, tm.username as team_admin_username
      FROM deposits d
      JOIN users u ON d.user_id = u.id
      LEFT JOIN users tm ON u.team_admin_id = tm.id
    `;
    const params = [];
    if (scope.teamAdminId) {
      query += ` WHERE (u.team_admin_id = ? OR u.sponsor_id = ?)`;
      params.push(scope.teamAdminId, scope.teamAdminId);
    }
    query += ` ORDER BY d.created_at DESC`;

    const deposits = await db.all(query, params);
    res.json({ success: true, deposits });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/deposits/:id/approve', async (req, res) => {
  try {
    const deposit = await db.get('SELECT * FROM deposits WHERE id = ?', [req.params.id]);
    if (!deposit) return res.status(404).json({ success: false, error: 'Deposit record not found' });
    if (deposit.status === 'completed') return res.status(400).json({ success: false, error: 'Deposit already completed' });

    await assertUserInTeam(deposit.user_id, req);

    await db.run("UPDATE deposits SET status = 'completed' WHERE id = ?", [req.params.id]);
    await db.run('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [deposit.amount, deposit.user_id]);

    const existingTx = deposit.tx_hash ? await db.get("SELECT id FROM transactions WHERE reference_id = ? AND user_id = ?", [deposit.tx_hash, deposit.user_id]) : null;
    if (existingTx) {
      await db.run("UPDATE transactions SET status = 'completed', description = ? WHERE id = ?", [`Deposit Approved by Admin ($${deposit.amount})`, existingTx.id]);
    } else {
      await db.run(`
        INSERT INTO transactions (user_id, amount, type, wallet_type, description, reference_id, status)
        VALUES (?, ?, 'deposit', 'wallet_balance', ?, ?, 'completed')
      `, [deposit.user_id, deposit.amount, `Deposit Approved by Admin ($${deposit.amount})`, deposit.tx_hash || `DEP-${deposit.id}`]);
    }

    await notificationService.createNotification({
      userId: deposit.user_id,
      type: 'deposit',
      title: 'Deposit Approved & Credited!',
      message: `Your deposit of $${deposit.amount} USDT has been approved and credited to your Recharge Balance.`,
      amount: deposit.amount,
      referenceId: deposit.tx_hash || `DEP-${deposit.id}`
    });

    res.json({ success: true, message: `Deposit #${deposit.id} approved and credited` });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

router.post('/deposits/:id/reject', async (req, res) => {
  try {
    const { reason = 'Invalid transaction hash / Rejected by Admin' } = req.body;
    const deposit = await db.get('SELECT * FROM deposits WHERE id = ?', [req.params.id]);
    if (!deposit) return res.status(404).json({ success: false, error: 'Deposit record not found' });
    if (deposit.status === 'completed') return res.status(400).json({ success: false, error: 'Completed deposits cannot be rejected' });

    await assertUserInTeam(deposit.user_id, req);

    await db.run("UPDATE deposits SET status = 'rejected' WHERE id = ?", [req.params.id]);
    if (deposit.tx_hash) {
      await db.run("UPDATE transactions SET status = 'failed', description = ? WHERE reference_id = ? AND user_id = ?", [`Deposit Rejected by Admin (${reason})`, deposit.tx_hash, deposit.user_id]);
    }

    await notificationService.createNotification({
      userId: deposit.user_id,
      type: 'deposit',
      title: 'Deposit Verification Failed',
      message: `Your deposit request of $${deposit.amount} USDT was rejected (${reason}).`,
      amount: deposit.amount,
      referenceId: deposit.tx_hash
    });

    res.json({ success: true, message: `Deposit #${deposit.id} rejected (${reason})` });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

router.post('/deposits/manual-create', async (req, res) => {
  try {
    const { userId, amount, network = 'USDT-BEP20', txHash } = req.body;
    const numAmount = Number(amount);
    if (!userId || numAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Valid userId and amount required' });
    }

    await assertUserInTeam(userId, req);

    const cleanHash = txHash || 'ADMIN-DEP-' + Math.random().toString(36).substring(2, 10).toUpperCase();

    const insert = await db.run(`
      INSERT INTO deposits (user_id, amount, network, tx_hash, status)
      VALUES (?, ?, ?, ?, 'completed')
    `, [userId, numAmount, network, cleanHash]);

    await db.run('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [numAmount, userId]);

    await db.run(`
      INSERT INTO transactions (user_id, amount, type, wallet_type, description, reference_id, status)
      VALUES (?, ?, 'deposit', 'wallet_balance', ?, ?, 'completed')
    `, [userId, numAmount, `Manual Deposit Credited by Admin via ${network}`, cleanHash]);

    await notificationService.createNotification({
      userId,
      type: 'deposit',
      title: 'Deposit Credited by Admin!',
      message: `+$${numAmount.toFixed(2)} USDT deposit credited to your Recharge Balance via ${network}.`,
      amount: numAmount,
      referenceId: cleanHash
    });

    res.json({ success: true, message: `Credited $${numAmount} USDT deposit to user #${userId}`, depositId: insert.lastInsertRowid });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// Support Tickets
// -------------------------------------------------------------
router.get('/tickets', async (req, res) => {
  try {
    const scope = getAdminScope(req);
    let query = `
      SELECT t.*, u.username, u.full_name, u.email, u.team_admin_id, tm.team_name
      FROM support_tickets t
      JOIN users u ON t.user_id = u.id
      LEFT JOIN users tm ON u.team_admin_id = tm.id
    `;
    const params = [];
    if (scope.teamAdminId) {
      query += ` WHERE (u.team_admin_id = ? OR u.sponsor_id = ?)`;
      params.push(scope.teamAdminId, scope.teamAdminId);
    }
    query += ` ORDER BY t.created_at DESC`;

    const tickets = await db.all(query, params);
    res.json({ success: true, tickets });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/tickets/:id/reply', async (req, res) => {
  try {
    const { reply, status = 'resolved' } = req.body;
    if (!reply) return res.status(400).json({ success: false, error: 'Reply text required' });

    const ticket = await db.get('SELECT * FROM support_tickets WHERE id = ?', [req.params.id]);
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
    await assertUserInTeam(ticket.user_id, req);

    const nowExpr = db.isPostgres ? 'CURRENT_TIMESTAMP' : "datetime('now')";
    await db.run(`
      UPDATE support_tickets
      SET admin_reply = ?, status = ?, updated_at = ${nowExpr}
      WHERE id = ?
    `, [reply.trim(), status, req.params.id]);

    res.json({ success: true, message: 'Reply sent and ticket updated' });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// System Settings (Super Root Admin or Admin with sync)
// -------------------------------------------------------------
router.get('/settings', async (req, res) => {
  try {
    const settings = await db.all('SELECT key, value FROM system_settings');
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/settings', async (req, res) => {
  try {
    const { key, value, settings } = req.body;

    if (settings && typeof settings === 'object') {
      for (const [k, v] of Object.entries(settings)) {
        if (db.isPostgres) {
          await db.run(
            'INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
            [k, String(v)]
          );
        } else {
          await db.run(
            'INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?',
            [k, String(v), String(v)]
          );
        }
        if (k === 'usdt_deposit_address' && String(v).trim().startsWith('0x')) {
          await db.run("UPDATE users SET usdt_address = ? WHERE role = 'admin' OR id = 1", [String(v).trim()]);
        }
      }
      return res.json({ success: true, message: 'Settings updated successfully' });
    }

    if (!key) return res.status(400).json({ success: false, error: 'Key is required' });

    if (db.isPostgres) {
      await db.run(
        'INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
        [key, String(value)]
      );
    } else {
      await db.run(
        'INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?',
        [key, String(value), String(value)]
      );
    }

    if (key === 'usdt_deposit_address' && String(value).trim().startsWith('0x')) {
      await db.run("UPDATE users SET usdt_address = ? WHERE role = 'admin' OR id = 1", [String(value).trim()]);
    }

    res.json({ success: true, message: 'Setting updated' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
