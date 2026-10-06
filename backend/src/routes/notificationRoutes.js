const express = require('express');
const router = express.Router();
const notificationService = require('../services/notificationService');
const { authenticateToken } = require('../middleware/authMiddleware');

router.use(authenticateToken);

// GET /api/notifications - List notifications for logged in user
router.get('/', async (req, res) => {
  try {
    const limit = req.query.limit || 50;
    const notifications = await notificationService.getUserNotifications(req.user.id, limit);
    const unreadCount = await notificationService.getUnreadCount(req.user.id);
    res.json({
      success: true,
      notifications,
      unreadCount
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/notifications/unread-count - Fast badge poll
router.get('/unread-count', async (req, res) => {
  try {
    const count = await notificationService.getUnreadCount(req.user.id);
    res.json({ success: true, unreadCount: count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/notifications/mark-all-read - Clear badge
router.post('/mark-all-read', async (req, res) => {
  try {
    await notificationService.markAllAsRead(req.user.id);
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/notifications/:id/read - Mark single as read
router.post('/:id/read', async (req, res) => {
  try {
    await notificationService.markAsRead(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
