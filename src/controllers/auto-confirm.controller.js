import { pool } from '../database/db.js'
import { emitUserNotification, emitOrderUpdate, emitUserDataRefresh } from '../utils/socket-helper.js'
import { sendOrderReceiptEmail } from '../utils/emailService.js'

// Auto-confirm orders that have been claimed for 3+ days
export const autoConfirmClaimedOrders = async (io = null) => {
  try {
    console.log('🔄 Starting auto-confirmation check for claimed orders...');
    
    // Find orders that have been claimed for 3+ days
    const [claimedOrders] = await pool.query(`
      SELECT o.id, o.user_id, o.total_amount, o.payment_method, o.created_at, o.updated_at,
             u.name, u.email, u.degree, u.section
      FROM orders o
      JOIN users u ON o.user_id = u.id
      WHERE o.status = 'claimed' 
      AND o.updated_at <= DATE_SUB(NOW(), INTERVAL 3 DAY)
    `);

    console.log(`📋 Found ${claimedOrders.length} orders to auto-confirm`);

    if (claimedOrders.length === 0) {
      console.log('✅ No orders need auto-confirmation');
      return;
    }

    for (const order of claimedOrders) {
      try {
        console.log(`🔄 Auto-confirming order #${order.id} for user ${order.name}`);
        
        // Update order status to completed
        await pool.query(
          'UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?',
          ['completed', order.id]
        );

        // Log status change
        await pool.query(`
          INSERT INTO order_status_logs (order_id, old_status, new_status, notes, created_at)
          VALUES (?, ?, ?, ?, NOW())
        `, [order.id, 'claimed', 'completed', 'Auto-confirmed after 3 days']);

        // Get order items for notification and email
        const [orderItems] = await pool.query(`
          SELECT oi.product_id, oi.quantity, oi.product_name, oi.unit_price, oi.total_price
          FROM order_items oi
          WHERE oi.order_id = ?
        `, [order.id]);
        
        // Map product_name for items
        const itemsWithProductName = orderItems.map(item => ({
          ...item,
          product_name: item.product_name || 'Unknown Product'
        }));

        // Create product summary for notifications
        let productSummary = '';
        if (orderItems.length > 0) {
          if (orderItems.length === 1) {
            productSummary = `${orderItems[0].quantity}x ${orderItems[0].product_name}`;
          } else {
            productSummary = `${orderItems.length} items`;
          }
        }

        // Create notification for user
        const [notificationResult] = await pool.query(`
          INSERT INTO notifications (user_id, title, message, type, created_at)
          VALUES (?, ?, ?, ?, NOW())
        `, [
          order.user_id,
          '🎉 Order Auto-Confirmed!',
          `Your order for ${productSummary} has been automatically confirmed after 3 days. A receipt has been sent to your email.`,
          'system'
        ]);

        // Emit real-time notification to user
        if (io) {
          emitUserNotification(io, order.user_id, {
            id: notificationResult.insertId,
            title: '🎉 Order Auto-Confirmed!',
            message: `Your order for ${productSummary} has been automatically confirmed after 3 days. A receipt has been sent to your email.`,
            type: 'system',
            orderId: order.id,
            status: 'completed',
            read: false,
            timestamp: new Date().toISOString(),
            priority: 'high'
          });

          // Emit real-time order update
          emitOrderUpdate(io, order.user_id, {
            orderId: order.id,
            status: 'completed',
            previousStatus: 'claimed',
            timestamp: new Date().toISOString()
          });
          
          // Emit user data refresh
          emitUserDataRefresh(io, order.user_id, 'orders', { 
            action: 'updated', 
            orderId: order.id, 
            status: 'completed' 
          });
        }

        // Send email receipt to customer
        try {
          const orderData = {
            orderId: order.id,
            items: itemsWithProductName,
            totalAmount: order.total_amount,
            paymentMethod: order.payment_method,
            createdAt: order.created_at,
            status: 'completed',
            userName: order.name,
            degree: order.degree,
            section: order.section
          };

          const emailResult = await sendOrderReceiptEmail(order.email, order.name, orderData);
          if (emailResult.success) {
            console.log(`📧 Email receipt sent to ${order.email} for order #${order.id}`);
          } else {
            console.log(`📧 Email receipt not sent for order #${order.id}: ${emailResult.message}`);
          }
        } catch (emailError) {
          console.error(`❌ Error sending email receipt for order #${order.id}:`, emailError);
        }

        // Notify admins about auto-confirmation
        const [adminUsers] = await pool.query(`
          SELECT id FROM users WHERE role = 'admin'
        `);
        
        for (const admin of adminUsers) {
          await pool.query(`
            INSERT INTO notifications (user_id, title, message, type, related_id, created_at)
            VALUES (?, ?, ?, ?, ?, NOW())
          `, [
            admin.id,
            '🤖 Order Auto-Confirmed',
            `Order #${order.id} for ${order.name} (${productSummary}) was automatically confirmed after 3 days.`,
            'admin_order',
            order.id
          ]);
        }

        console.log(`✅ Order #${order.id} auto-confirmed successfully`);

      } catch (orderError) {
        console.error(`❌ Error auto-confirming order #${order.id}:`, orderError);
        // Continue with other orders even if one fails
      }
    }

    console.log(`🎉 Auto-confirmation process completed. Processed ${claimedOrders.length} orders.`);

  } catch (error) {
    console.error('❌ Error in auto-confirmation process:', error);
  }
};

// Get statistics about orders that will be auto-confirmed soon
export const getAutoConfirmStats = async () => {
  try {
    const [stats] = await pool.query(`
      SELECT 
        COUNT(*) as total_claimed_orders,
        COUNT(CASE WHEN updated_at <= DATE_SUB(NOW(), INTERVAL 3 DAY) THEN 1 END) as ready_for_auto_confirm,
        COUNT(CASE WHEN updated_at <= DATE_SUB(NOW(), INTERVAL 2 DAY) AND updated_at > DATE_SUB(NOW(), INTERVAL 3 DAY) THEN 1 END) as will_be_ready_tomorrow,
        COUNT(CASE WHEN updated_at <= DATE_SUB(NOW(), INTERVAL 1 DAY) AND updated_at > DATE_SUB(NOW(), INTERVAL 2 DAY) THEN 1 END) as will_be_ready_in_2_days
      FROM orders 
      WHERE status = 'claimed'
    `);

    return stats[0];
  } catch (error) {
    console.error('Error getting auto-confirm stats:', error);
    return null;
  }
};
