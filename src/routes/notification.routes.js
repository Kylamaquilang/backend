import express from 'express';
import {
  getUnreadCount,
  getNotifications,
  getRecentNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,
  createNotification,
  getAdminNotifications
} from '../controllers/notification.controller.js';
import { verifyToken, isAdmin } from '../middleware/auth.middleware.js';

const router = express.Router();

// Get unread notification count (for navbar badge)
router.get('/unread-count', verifyToken, getUnreadCount);

// Get all notifications for user
router.get('/', verifyToken, getNotifications);

// Get recent notifications for dropdown
router.get('/recent', verifyToken, getRecentNotifications);

// Get admin notifications (admin only)
router.get('/admin', verifyToken, isAdmin, getAdminNotifications);

// Mark notification as read
router.put('/:id/read', verifyToken, markAsRead);

// Mark all notifications as read
router.put('/mark-all-read', verifyToken, markAllAsRead);

// Delete all notifications for user (must come before /:id route)
router.delete('/delete-all', verifyToken, deleteAllNotifications);

// Delete notification
router.delete('/:id', verifyToken, deleteNotification);

// Create notification (for system use)
router.post('/', verifyToken, createNotification);

export default router;
