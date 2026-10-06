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
}

module.exports = new NotificationService();
