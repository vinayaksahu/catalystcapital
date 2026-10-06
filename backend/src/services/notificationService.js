const { db } = require('../db/database');

class NotificationService {
  /**
   * Create a notification record for a specific user
   * @param {Object} param0
   * @param {number} param0.userId - recipient user ID
   * @param {string} param0.type - 'referral', 'roi', 'commission', 'deposit', 'withdrawal', 'system'
   * @param {string} param0.title - short headline
   * @param {string} param0.message - detail message
   * @param {number|null} [param0.amount] - optional amount in USDT
   * @param {string|null} [param0.referenceId] - optional tx or ref ID
   */
  async createNotification({ userId, type, title, message, amount = null, referenceId = null }) {
    try {
      if (!userId || !title) return null;
      const res = await db.run(`
        INSERT INTO notifications (user_id, type, title, message, amount, reference_id, is_read)
        VALUES (?, ?, ?, ?, ?, ?, 0)
      `, [userId, type || 'system', title, message || '', amount !== null ? Number(amount) : null, referenceId || null]);
      return res;
    } catch (err) {
      console.error('Error creating notification:', err.message);
      return null;
    }
  }

  /**
   * Fetch paginated notifications for a user
   */
  async getUserNotifications(userId, limit = 50) {
    return await db.all(`
      SELECT * FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `, [userId, Number(limit)]);
  }

  /**
   * Get unread notification count
   */
  async getUnreadCount(userId) {
    const row = await db.get(`
      SELECT COUNT(*) as count FROM notifications
      WHERE user_id = ? AND is_read = 0
    `, [userId]);
    return row ? parseInt(row.count, 10) : 0;
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId) {
    return await db.run(`
      UPDATE notifications SET is_read = 1
      WHERE user_id = ? AND is_read = 0
    `, [userId]);
  }

  /**
   * Mark a single notification as read
   */
  async markAsRead(notificationId, userId) {
    return await db.run(`
      UPDATE notifications SET is_read = 1
      WHERE id = ? AND user_id = ?
    `, [notificationId, userId]);
  }

  /**
   * Send notification to appropriate admin accounts with STRICT team isolation.
   * - If user belongs to a specific Sub-Admin team (e.g. Team A id 16), ONLY that Sub-Admin
   *   (and primary Headquarters / Superadmin) receive the notification.
   * - Parallel Sub-Admins (e.g. Team B id 17, Team C id 18) NEVER receive it!
   * - If user belongs to Headquarters (@admin id 1 / null / 0), ONLY Headquarters (@admin id 1)
   *   and superrootadmin receive it. NO Sub-Admins receive it!
   */
  async notifyAdmins({ type, title, message, amount = null, referenceId = null, targetUserId = null, teamAdminId = null }) {
    try {
      let resolvedTeamAdminId = teamAdminId;

      // 1. Resolve from targetUserId if needed
      if (!resolvedTeamAdminId && targetUserId) {
        const u = await db.get("SELECT team_admin_id FROM users WHERE id = ?", [targetUserId]);
        if (u && u.team_admin_id) {
          resolvedTeamAdminId = u.team_admin_id;
        }
      }

      // 2. Fallback: Parse from referenceId if targetUserId was not passed
      if (!resolvedTeamAdminId && referenceId) {
        const ref = String(referenceId).trim();
        if (ref.startsWith('DEP-')) {
          const depId = ref.replace('DEP-', '');
          const dep = await db.get("SELECT u.team_admin_id FROM deposits d JOIN users u ON d.user_id = u.id WHERE d.id = ?", [depId]);
          if (dep) resolvedTeamAdminId = dep.team_admin_id;
        } else if (ref.startsWith('WTH-')) {
          const wthId = ref.replace('WTH-', '');
          const wth = await db.get("SELECT u.team_admin_id FROM withdrawals w JOIN users u ON w.user_id = u.id WHERE w.id = ?", [wthId]);
          if (wth) resolvedTeamAdminId = wth.team_admin_id;
        } else if (ref.startsWith('INV-')) {
          const invId = ref.replace('INV-', '');
          const inv = await db.get("SELECT u.team_admin_id FROM investments i JOIN users u ON i.user_id = u.id WHERE i.id = ?", [invId]);
          if (inv) resolvedTeamAdminId = inv.team_admin_id;
        } else if (ref.startsWith('TKT-')) {
          const tktId = ref.replace('TKT-', '');
          const tkt = await db.get("SELECT u.team_admin_id FROM support_tickets st JOIN users u ON st.user_id = u.id WHERE st.id = ?", [tktId]);
          if (tkt) resolvedTeamAdminId = tkt.team_admin_id;
        } else {
          // Check if referenceId is a member referral_code (e.g. CC41961)
          const regUser = await db.get("SELECT team_admin_id FROM users WHERE referral_code = ?", [ref]);
          if (regUser) resolvedTeamAdminId = regUser.team_admin_id;
        }
      }

      const recipientIds = new Set();

      // Headquarters & Superadmins always receive alerts for platform oversight
      const superAdmins = await db.all("SELECT id FROM users WHERE role = 'superadmin' OR id = 1");
      if (superAdmins && superAdmins.length > 0) {
        for (const sa of superAdmins) {
          recipientIds.add(sa.id);
        }
      }

      // If user belongs to a specific Sub-Admin team (id > 1):
      // Add ONLY THAT sub-admin!
      if (resolvedTeamAdminId && Number(resolvedTeamAdminId) > 1) {
        const subAdmin = await db.get("SELECT id FROM users WHERE id = ? AND role = 'admin'", [resolvedTeamAdminId]);
        if (subAdmin) {
          recipientIds.add(subAdmin.id);
        }
      }

      // Parallel Sub-Admins are strictly excluded because recipientIds only contains:
      // - The specific team admin (if any)
      // - Superadmins / Headquarters (id 1)

      for (const recId of recipientIds) {
        await this.createNotification({
          userId: recId,
          type: type || 'admin_alert',
          title,
          message,
          amount,
          referenceId
        });
      }
    } catch (err) {
      console.error('Error sending notification to admins:', err.message);
    }
  }

  /**
   * Clean up historical cross-team notifications mistakenly delivered to parallel sub-admins
   */
  async cleanupCrossTeamNotifications() {
    try {
      // Find all notifications assigned to sub-admins (role = 'admin' and id != 1)
      const subAdminNotes = await db.all(`
        SELECT n.id, n.user_id, n.reference_id, n.message
        FROM notifications n
        JOIN users u ON n.user_id = u.id
        WHERE u.role = 'admin' AND u.id != 1
      `);

      for (const note of subAdminNotes) {
        const subAdminId = note.user_id;
        let shouldDelete = false;

        if (note.reference_id) {
          const ref = String(note.reference_id).trim();
          if (ref.startsWith('DEP-')) {
            const depId = ref.replace('DEP-', '');
            const dep = await db.get("SELECT u.team_admin_id FROM deposits d JOIN users u ON d.user_id = u.id WHERE d.id = ?", [depId]);
            if (!dep || dep.team_admin_id !== subAdminId) shouldDelete = true;
          } else if (ref.startsWith('WTH-')) {
            const wthId = ref.replace('WTH-', '');
            const wth = await db.get("SELECT u.team_admin_id FROM withdrawals w JOIN users u ON w.user_id = u.id WHERE w.id = ?", [wthId]);
            if (!wth || wth.team_admin_id !== subAdminId) shouldDelete = true;
          } else if (ref.startsWith('INV-')) {
            const invId = ref.replace('INV-', '');
            const inv = await db.get("SELECT u.team_admin_id FROM investments i JOIN users u ON i.user_id = u.id WHERE i.id = ?", [invId]);
            if (!inv || inv.team_admin_id !== subAdminId) shouldDelete = true;
          } else if (ref.startsWith('TKT-')) {
            const tktId = ref.replace('TKT-', '');
            const tkt = await db.get("SELECT u.team_admin_id FROM support_tickets st JOIN users u ON st.user_id = u.id WHERE st.id = ?", [tktId]);
            if (!tkt || tkt.team_admin_id !== subAdminId) shouldDelete = true;
          } else {
            // Check member referral_code (CCxxxxx)
            const u = await db.get("SELECT team_admin_id FROM users WHERE referral_code = ?", [ref]);
            if (!u || u.team_admin_id !== subAdminId) shouldDelete = true;
          }
        } else if (note.message) {
          // If message contains @username, check if that username belongs to this sub-admin
          const match = note.message.match(/@([a-zA-Z0-9_]+)/);
          if (match && match[1]) {
            const targetUsername = match[1];
            const u = await db.get("SELECT team_admin_id FROM users WHERE username = ?", [targetUsername]);
            if (!u || u.team_admin_id !== subAdminId) shouldDelete = true;
          }
        }

        if (shouldDelete) {
          await db.run("DELETE FROM notifications WHERE id = ?", [note.id]);
        }
      }
    } catch (err) {
      console.warn('Cross-team notification cleanup warning:', err.message);
    }
  }
}

module.exports = new NotificationService();
