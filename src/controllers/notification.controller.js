import { pool } from '../database/db.js';
import { emitUserNotification, emitAdminNotification } from '../utils/socket-helper.js';

// ✅ Get unread notification count
export const getUnreadCount = async (req, res) => {
  const user_id = req.user.id;

  try {
    const [result] = await pool.query(`
      SELECT COUNT(*) as count 
      FROM notifications 
      WHERE user_id = ? AND (is_read = 0 OR is_read IS NULL)
    `, [user_id]);

    res.json({
      success: true,
      count: result[0].count
    });
  } catch (err) {
    console.error('Get unread count error:', err);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to get notification count'
    });
  }
};

// ✅ Get all notifications for user
export const getNotifications = async (req, res) => {
  try {
    if (!req.user) {
      console.error('❌ getNotifications - req.user is undefined');
      return res.status(401).json({ 
        success: false,
        message: 'Unauthorized - user missing' 
      });
    }

    const user_id = req.user.id;
    const { page = 1, limit = 10 } = req.query;

    const offset = (page - 1) * limit;
    
    const [notifications] = await pool.query(`
      SELECT id, title, message, type, is_read, created_at
      FROM notifications 
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `, [user_id, parseInt(limit), offset]);

    const [totalResult] = await pool.query(`
      SELECT COUNT(*) as total 
      FROM notifications 
      WHERE user_id = ?
    `, [user_id]);

    res.json({
      success: true,
      notifications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalResult[0].total,
        totalPages: Math.ceil(totalResult[0].total / limit)
      }
    });
  } catch (err) {
    console.error('Get notifications error:', err);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to get notifications'
    });
  }
};

// ✅ Get recent notifications for dropdown
export const getRecentNotifications = async (req, res) => {
  try {
    if (!req.user) {
      console.error('❌ getRecentNotifications - req.user is undefined');
      return res.status(401).json({ 
        success: false,
        message: 'Unauthorized - user missing' 
      });
    }

    const user_id = req.user.id;
    const { limit = 5 } = req.query;
    
    const [notifications] = await pool.query(`
      SELECT id, title, message, type, is_read, created_at
      FROM notifications 
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `, [user_id, parseInt(limit)]);

    res.json({
      success: true,
      notifications
    });
  } catch (err) {
    console.error('Get recent notifications error:', err);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to get recent notifications'
    });
  }
};

// ✅ Mark notification as read
export const markAsRead = async (req, res) => {
  const user_id = req.user.id;
  const user_role = req.user.role;
  const { id } = req.params;

  try {
    let result;
    
    if (user_role === 'admin') {
      // Admin can mark any notification as read
      [result] = await pool.query(`
        UPDATE notifications 
        SET is_read = 1 
        WHERE id = ?
      `, [id]);
    } else {
      // Regular users can only mark their own notifications as read
      [result] = await pool.query(`
        UPDATE notifications 
        SET is_read = 1 
        WHERE id = ? AND user_id = ?
      `, [id, user_id]);
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        error: 'Notification not found',
        message: 'Notification not found or does not belong to you'
      });
    }

    res.json({
      success: true,
      message: 'Notification marked as read'
    });
  } catch (err) {
    console.error('Mark as read error:', err);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to mark notification as read'
    });
  }
};

// ✅ Mark all notifications as read
export const markAllAsRead = async (req, res) => {
  const user_id = req.user.id;
  const user_role = req.user.role;

  try {
    if (user_role === 'admin') {
      // Admin can mark all admin notifications as read
      await pool.query(`
        UPDATE notifications n
        JOIN users u ON n.user_id = u.id
        SET n.is_read = 1 
        WHERE u.role = 'admin'
      `);
    } else {
      // Regular users can only mark their own notifications as read
      await pool.query(`
        UPDATE notifications 
        SET is_read = 1 
        WHERE user_id = ?
      `, [user_id]);
    }

    res.json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (err) {
    console.error('Mark all as read error:', err);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to mark all notifications as read'
    });
  }
};

// ✅ Delete notification
export const deleteNotification = async (req, res) => {
  const user_id = req.user.id;
  const { id } = req.params;

  try {
    const [result] = await pool.query(`
      DELETE FROM notifications 
      WHERE id = ? AND user_id = ?
    `, [id, user_id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        error: 'Notification not found',
        message: 'Notification not found or does not belong to you'
      });
    }

    res.json({
      success: true,
      message: 'Notification deleted successfully'
    });
  } catch (err) {
    console.error('Delete notification error:', err);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to delete notification'
    });
  }
};

// ✅ Delete all notifications for user
export const deleteAllNotifications = async (req, res) => {
  const user_id = req.user.id;

  try {
    const [result] = await pool.query(`
      DELETE FROM notifications 
      WHERE user_id = ?
    `, [user_id]);

    res.json({
      success: true,
      message: 'All notifications deleted successfully',
      deletedCount: result.affectedRows
    });
  } catch (err) {
    console.error('Delete all notifications error:', err);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to delete all notifications'
    });
  }
};

// ✅ Get admin notifications (all notifications for admin users)
export const getAdminNotifications = async (req, res) => {
  try {
    const [notifications] = await pool.query(`
      SELECT n.id, n.title, n.message, n.type, n.is_read, n.related_id, n.created_at
      FROM notifications n
      JOIN users u ON n.user_id = u.id
      WHERE u.role = 'admin' 
      ORDER BY n.created_at DESC
    `);

    res.json({
      success: true,
      notifications
    });
  } catch (err) {
    console.error('Get admin notifications error:', err);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to get admin notifications'
    });
  }
};

// ✅ Create notification (for system use)
export const createNotification = async (req, res) => {
  const { user_id, message, title, type } = req.body;
  const io = req.app.get('io'); // Get Socket.io instance

  if (!user_id || !message) {
    return res.status(400).json({
      error: 'Missing required fields',
      message: 'User ID and message are required'
    });
  }

  try {
    const [result] = await pool.query(`
      INSERT INTO notifications (user_id, title, message, type) 
      VALUES (?, ?, ?, ?)
    `, [user_id, title || 'New Notification', message, type || 'system']);

    const notificationId = result.insertId;

    // Emit real-time notification
    if (io) {
      emitUserNotification(io, user_id, {
        id: notificationId,
        title: title || 'New Notification',
        message,
        type: type || 'system',
        read: false
      });

      // If it's an admin notification, also emit to admin room
      if (type === 'admin_order' || type === 'system') {
        emitAdminNotification(io, {
          id: notificationId,
          title: title || 'New Notification',
          message,
          type: type || 'system',
          userId: user_id
        });
      }
    }

    res.status(201).json({
      success: true,
      message: 'Notification created successfully',
      notificationId
    });
  } catch (err) {
    console.error('Create notification error:', err);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to create notification'
    });
  }
};
