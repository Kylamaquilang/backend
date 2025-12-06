// Socket.io helper utilities for emitting real-time events
import { createNotification } from './notification-helper.js';

/**
 * Emit notification to a specific user
 * @param {Object} io - Socket.io instance
 * @param {string} userId - User ID to send notification to
 * @param {Object} notificationData - Notification data
 */
export const emitUserNotification = (io, userId, notificationData) => {
  if (io) {
    io.to(`user-${userId}`).emit('new-notification', {
      userId,
      ...notificationData,
      timestamp: new Date().toISOString()
    });
    console.log(` Real-time notification sent to user ${userId}: ${notificationData.title}`);
  }
};

/**
 * Emit notification to admin room
 * @param {Object} io - Socket.io instance
 * @param {Object} notificationData - Notification data
 */
export const emitAdminNotification = (io, notificationData) => {
  if (io) {
    io.to('admin-room').emit('admin-notification', {
      ...notificationData,
      timestamp: new Date().toISOString()
    });
    console.log(` Real-time admin notification sent: ${notificationData.title}`);
  }
};

/**
 * Emit cart update to user
 * @param {Object} io - Socket.io instance
 * @param {string} userId - User ID
 * @param {Object} cartData - Cart data
 */
export const emitCartUpdate = (io, userId, cartData) => {
  if (io) {
    io.to(`user-${userId}`).emit('cart-updated', {
      userId,
      ...cartData,
      timestamp: new Date().toISOString()
    });
    console.log(`🛒 Real-time cart update sent to user ${userId}`);
  }
};

/**
 * Emit order status update
 * @param {Object} io - Socket.io instance
 * @param {string} userId - User ID
 * @param {Object} orderData - Order data
 */
export const emitOrderUpdate = (io, userId, orderData) => {
  if (io) {
    // Send to user
    io.to(`user-${userId}`).emit('order-status-updated', {
      userId,
      ...orderData,
      timestamp: new Date().toISOString()
    });
    
    // Send to admin room
    io.to('admin-room').emit('admin-order-updated', {
      userId,
      ...orderData,
      timestamp: new Date().toISOString()
    });
    
    console.log(`📦 Real-time order update sent for order ${orderData.orderId}`);
  }
};

/**
 * Create notification and emit it in real-time
 * @param {Object} io - Socket.io instance
 * @param {string} userId - User ID
 * @param {string} message - Notification message
 * @param {string} title - Notification title
 * @param {string} type - Notification type
 */
export const createAndEmitNotification = async (io, userId, message, title = null, type = 'system') => {
  try {
    // Create notification in database
    await createNotification(userId, message, title, type);
    
    // Emit real-time notification
    emitUserNotification(io, userId, {
      title: title || 'New Notification',
      message,
      type,
      read: false
    });
    
    // If it's an admin notification, also emit to admin room
    if (type === 'admin_order' || type === 'system') {
      emitAdminNotification(io, {
        title: title || 'New Notification',
        message,
        type,
        userId
      });
    }
  } catch (error) {
    console.error(' Error creating and emitting notification:', error);
  }
};

/**
 * Emit low stock alert to admin
 * @param {Object} io - Socket.io instance
 * @param {Object} productData - Product data
 */
export const emitLowStockAlert = (io, productData) => {
  if (io) {
    io.to('admin-room').emit('low-stock-alert', {
      ...productData,
      timestamp: new Date().toISOString()
    });
    console.log(` Low stock alert sent for product ${productData.name}`);
  }
};

/**
 * Emit new order notification to admin
 * @param {Object} io - Socket.io instance
 * @param {Object} orderData - Order data
 */
export const emitNewOrderAlert = (io, orderData) => {
  if (io) {
    io.to('admin-room').emit('new-order-alert', {
      ...orderData,
      timestamp: new Date().toISOString()
    });
    console.log(` New order alert sent for order ${orderData.orderId}`);
  }
};

/**
 * Emit inventory update to admin
 * @param {Object} io - Socket.io instance
 * @param {Object} inventoryData - Inventory update data
 */
export const emitInventoryUpdate = (io, inventoryData) => {
  if (io) {
    io.to('admin-room').emit('inventory-updated', {
      ...inventoryData,
      timestamp: new Date().toISOString()
    });
    console.log(`📦 Real-time inventory update sent for product ${inventoryData.productId}`);
  }
};

/**
 * Emit new order to admin room
 * @param {Object} io - Socket.io instance
 * @param {Object} orderData - Order data
 */
export const emitNewOrder = (io, orderData) => {
  if (io) {
    io.to('admin-room').emit('new-order', {
      ...orderData,
      timestamp: new Date().toISOString()
    });
    console.log(`🛒 Real-time new order sent for order ${orderData.orderId}`);
  }
};

/**
 * Emit data refresh signal to all users
 * @param {Object} io - Socket.io instance
 * @param {string} dataType - Type of data that was updated
 * @param {Object} data - Updated data
 */
export const emitDataRefresh = (io, dataType, data) => {
  if (io) {
    // Emit to all connected users
    io.emit('data-refresh', {
      dataType,
      data,
      timestamp: new Date().toISOString()
    });
    console.log(`🔄 Data refresh signal sent for ${dataType}`);
  }
};

/**
 * Emit admin data refresh signal
 * @param {Object} io - Socket.io instance
 * @param {string} dataType - Type of data that was updated
 * @param {Object} data - Updated data
 */
export const emitAdminDataRefresh = (io, dataType, data) => {
  if (io) {
    io.to('admin-room').emit('admin-data-refresh', {
      dataType,
      data,
      timestamp: new Date().toISOString()
    });
    console.log(`🔄 Admin data refresh signal sent for ${dataType}`);
  }
};

/**
 * Emit user-specific data refresh
 * @param {Object} io - Socket.io instance
 * @param {string} userId - User ID
 * @param {string} dataType - Type of data that was updated
 * @param {Object} data - Updated data
 */
export const emitUserDataRefresh = (io, userId, dataType, data = {}) => {
  if (io) {
    io.to(`user-${userId}`).emit('user-data-refresh', {
      dataType,
      data,
      timestamp: new Date().toISOString()
    });
    console.log(`🔄 User data refresh signal sent to user ${userId} for ${dataType}`);
  }
};

