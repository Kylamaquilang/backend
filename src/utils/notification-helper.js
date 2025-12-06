import { pool } from '../database/db.js';

//  Create notification utility
export const createNotification = async (user_id, message, title = null, type = 'system') => {
  try {
    await pool.query(`
      INSERT INTO notifications (user_id, title, message, type) 
      VALUES (?, ?, ?, ?)
    `, [user_id, title, message, type]);
    
    console.log(` Notification created for user ${user_id}: ${message}`);
  } catch (error) {
    console.error(' Error creating notification:', error);
  }
};

//  Create order status notification with product details
export const createOrderStatusNotification = async (user_id, orderId, status) => {
  try {
    console.log(`🔔 Creating notification for user ${user_id}, order ${orderId}, status: ${status}`);
    
    // Get product details for the order with size information
    const [productInfo] = await pool.query(`
      SELECT p.name, oi.quantity, ps.size as size_name
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      LEFT JOIN product_sizes ps ON oi.size_id = ps.id
      WHERE oi.order_id = ?
      ORDER BY oi.id
    `, [orderId]);
    
    console.log(`🔔 Found ${productInfo.length} products for order ${orderId}`);
    
    // Create product summary with sizes
    let productSummary = '';
    if (productInfo.length > 0) {
      if (productInfo.length === 1) {
        const item = productInfo[0];
        productSummary = item.size_name 
          ? `${item.quantity}x ${item.name} (${item.size_name})`
          : `${item.quantity}x ${item.name}`;
      } else if (productInfo.length <= 3) {
        productSummary = productInfo.map(item => 
          item.size_name 
            ? `${item.quantity}x ${item.name} (${item.size_name})`
            : `${item.quantity}x ${item.name}`
        ).join(', ');
      } else {
        const firstItem = productInfo[0];
        const firstItemText = firstItem.size_name 
          ? `${firstItem.quantity}x ${firstItem.name} (${firstItem.size_name})`
          : `${firstItem.quantity}x ${firstItem.name}`;
        productSummary = `${firstItemText} and ${productInfo.length - 1} more items`;
      }
    }
    
    const statusData = {
      'pending': {
        title: `${productSummary} Order Placed`,
        message: `Your order for ${productSummary} has been placed and is pending confirmation.`
      },
      'processing': {
        title: `${productSummary} Order Update`,
        message: `Your order for ${productSummary} is now being processed.`
      },
      'ready_for_pickup': {
        title: `${productSummary} Ready for Pickup`,
        message: `Your order for ${productSummary} is ready for pickup at the accounting office!`
      },
      'delivered': {
        title: `${productSummary} Order Delivered`,
        message: `Your order for ${productSummary} has been delivered successfully!`
      },
      'cancelled': {
        title: `${productSummary} Order Cancelled`,
        message: `Your order for ${productSummary} has been cancelled.`
      }
    };
    
    const data = statusData[status] || {
      title: `${productSummary} Order Update`,
      message: `Your order for ${productSummary} status has been updated to ${status}.`
    };
    
    // Create notification with related_id for order tracking
    // For ready_for_pickup status, add action data for confirmation button
    const hasAction = status === 'ready_for_pickup';
    const actionData = hasAction ? JSON.stringify({
      actionType: 'confirm_receipt',
      actionText: 'Confirm Receipt',
      orderId: orderId
    }) : null;
    
    const [result] = await pool.query(`
      INSERT INTO notifications (user_id, title, message, type, related_id, created_at) 
      VALUES (?, ?, ?, ?, ?, NOW())
    `, [user_id, data.title, data.message, 'system', orderId]);
    
    console.log(`🔔 Notification created successfully with ID: ${result.insertId}`);
    
    return {
      id: result.insertId,
      title: data.title,
      message: data.message,
      productSummary,
      orderId,
      status,
      type: 'system',
      hasAction: hasAction,
      actionData: actionData
    };
  } catch (error) {
    console.error(' Error creating order status notification:', error);
    // Fallback to simple notification
    await createNotification(user_id, `Your order #${orderId} status has been updated to ${status}.`, ' Order Update', 'system');
    return {
      id: null,
      title: ' Order Update',
      message: `Your order #${orderId} status has been updated to ${status}.`,
      productSummary: '',
      orderId,
      status,
      type: 'system',
      hasAction: false,
      actionData: null
    };
  }
};

// Create payment notification
export const createPaymentNotification = async (user_id, orderId, paymentStatus) => {
  const paymentMessages = {
    'paid': `Payment for order #${orderId} has been received successfully.`,
    'failed': `Payment for order #${orderId} has failed. Please try again.`,
    'pending': `Payment for order #${orderId} is pending confirmation.`
  };
  
  const message = paymentMessages[paymentStatus] || `Payment status for order #${orderId} has been updated.`;
  
  await createNotification(user_id, message);
};

//  Create low stock notification (for admins)
export const createLowStockNotification = async (productName, currentStock) => {
  try {
    // Get all admin users
    const [admins] = await pool.query(`
      SELECT id FROM users WHERE role = 'admin'
    `);
    
    const message = `Low stock alert: ${productName} has only ${currentStock} items remaining.`;
    
    // Create notification for each admin
    for (const admin of admins) {
      await createNotification(admin.id, message);
    }
  } catch (error) {
    console.error(' Error creating low stock notification:', error);
  }
};

//  Create welcome notification
export const createWelcomeNotification = async (user_id, userName) => {
  const message = `Welcome to CPC Store, ${userName}! Thank you for joining us. Start shopping now!`;
  await createNotification(user_id, message);
};

//  Create promotional notification
export const createPromotionalNotification = async (user_id, promoMessage) => {
  await createNotification(user_id, promoMessage);
};

//  Create admin order notification with detailed summary
export const createAdminOrderNotification = async (orderId, total_amount, payment_method) => {
  try {
    // Get order details with customer info and product summary
    const [orderDetails] = await pool.query(`
      SELECT 
        o.id,
        o.total_amount,
        o.payment_method,
        o.payment_status,
        o.status,
        o.created_at,
        u.name as customer_name,
        u.student_id,
        u.email as customer_email
      FROM orders o
      JOIN users u ON o.user_id = u.id
      WHERE o.id = ?
    `, [orderId]);

    if (orderDetails.length === 0) {
      console.error('Order not found for admin notification');
      return;
    }

    const order = orderDetails[0];

    // Get product details for the order
    const [productInfo] = await pool.query(`
      SELECT p.name, oi.quantity, ps.size as size_name, oi.unit_price, oi.total_price
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      LEFT JOIN product_sizes ps ON oi.size_id = ps.id
      WHERE oi.order_id = ?
      ORDER BY oi.id
    `, [orderId]);

    // Create detailed product summary
    let productSummary = '';
    if (productInfo.length > 0) {
      if (productInfo.length === 1) {
        const item = productInfo[0];
        productSummary = item.size_name 
          ? `${item.quantity}x ${item.name} (${item.size_name}) - ₱${Number(item.total_price).toFixed(2)}`
          : `${item.quantity}x ${item.name} - ₱${Number(item.total_price).toFixed(2)}`;
      } else if (productInfo.length <= 3) {
        productSummary = productInfo.map(item => 
          item.size_name 
            ? `${item.quantity}x ${item.name} (${item.size_name}) - ₱${Number(item.total_price).toFixed(2)}`
            : `${item.quantity}x ${item.name} - ₱${Number(item.total_price).toFixed(2)}`
        ).join(', ');
      } else {
        const firstItem = productInfo[0];
        const firstItemText = firstItem.size_name 
          ? `${firstItem.quantity}x ${firstItem.name} (${firstItem.size_name}) - ₱${Number(firstItem.total_price).toFixed(2)}`
          : `${firstItem.quantity}x ${firstItem.name} - ₱${Number(firstItem.total_price).toFixed(2)}`;
        productSummary = `${firstItemText} and ${productInfo.length - 1} more items`;
      }
    }

    // Create notification message for admin (different from user)
    let title = `🛒 ${productSummary} New Order`;
    let message = '';
    
    if (payment_method === 'gcash' && order.payment_status === 'unpaid') {
      message = `New GCash order from ${order.customer_name} (${order.student_id}): ${productSummary}. Total: ₱${total_amount.toFixed(2)}. Payment pending at counter.`;
    } else if (payment_method === 'cash') {
      message = `New cash order from ${order.customer_name} (${order.student_id}): ${productSummary}. Total: ₱${total_amount.toFixed(2)}. Payment at counter.`;
    } else {
      message = `New order from ${order.customer_name} (${order.student_id}): ${productSummary}. Total: ₱${total_amount.toFixed(2)}.`;
    }

    // Get all admin users
    const [admins] = await pool.query(`
      SELECT id FROM users WHERE role = 'admin'
    `);

    // Create notification for each admin
    for (const admin of admins) {
      await pool.query(`
        INSERT INTO notifications (user_id, title, message, type, related_id, created_at) 
        VALUES (?, ?, ?, ?, ?, NOW())
      `, [admin.id, title, message, 'admin_order', orderId]);
    }

    console.log(`✅ Admin order notification created for order #${orderId}`);

    return {
      title,
      message,
      orderId,
      customerName: order.customer_name,
      studentId: order.student_id,
      totalAmount: total_amount,
      paymentMethod: payment_method,
      paymentStatus: order.payment_status,
      productSummary
    };
  } catch (error) {
    console.error('❌ Error creating admin order notification:', error);
    throw error;
  }
};
