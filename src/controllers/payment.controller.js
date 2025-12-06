import { pool } from '../database/db.js';

// Track GCash payment selection (no actual payment processing)
export const selectGCashPayment = async (req, res) => {
  const { orderId, amount, description } = req.body;
  const userId = req.user.id;

  try {
    // Validate input
    if (!orderId || !amount || !description) {
      return res.status(400).json({ 
        error: 'Order ID, amount, and description are required' 
      });
    }

    // Verify order belongs to user
    const [orders] = await pool.query(
      'SELECT * FROM orders WHERE id = ? AND user_id = ?',
      [orderId, userId]
    );

    if (orders.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = orders[0];

    // Check if order is already paid
    if (order.payment_status === 'paid') {
      return res.status(400).json({ error: 'Order is already paid' });
    }

    console.log(`💳 GCash payment selected for order ${orderId} by user ${userId}`);
      
    // Generate a tracking ID for GCash selection
    const gcashTrackingId = `gcash_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
    // Update order with GCash selection - keep payment_status as 'pending' (will be updated when paid at counter)
    // Store transaction_id in notes field since orders table doesn't have payment_intent_id column
    const existingNotes = order.notes || '';
    const newNotes = existingNotes ? `${existingNotes} | GCash Tracking ID: ${gcashTrackingId}` : `GCash Tracking ID: ${gcashTrackingId}`;
    
    await pool.query(
      'UPDATE orders SET payment_method = ?, notes = ? WHERE id = ?',
      ['gcash', newNotes, orderId]
    );

    // Store payment transaction for tracking
      await pool.query(`
        INSERT INTO payment_transactions (
          order_id, 
          transaction_id, 
          amount, 
          payment_method, 
          status, 
          gateway_response
        ) VALUES (?, ?, ?, ?, ?, ?)
      `, [
        orderId,
      gcashTrackingId,
        amount,
        'gcash',
      'pending',
      JSON.stringify({ 
        method: 'gcash_selection', 
        message: 'GCash payment method selected - payment will be completed at counter',
        selected_at: new Date().toISOString(),
        tracking_id: gcashTrackingId
      })
    ]);

    console.log(`✅ GCash payment selection tracked for order ${orderId}`);

    res.json({
      success: true,
      transaction_id: gcashTrackingId,
      payment_status: 'pending',
      payment_method: 'gcash',
      message: 'GCash payment method selected. Order status set to pending.',
      orderId: orderId
    });

  } catch (error) {
    console.error('GCash payment selection error:', error);
    res.status(500).json({ 
      error: 'Failed to process GCash selection',
      details: error.message
    });
  }
};

// Get payment status
export const getPaymentStatus = async (req, res) => {
  const { orderId } = req.params;
  const userId = req.user.id;

  try {
    const [orders] = await pool.query(
      'SELECT payment_status, payment_method, notes FROM orders WHERE id = ? AND user_id = ?',
      [orderId, userId]
    );

    if (orders.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = orders[0];
    
    // Extract transaction_id from notes if present
    let transactionId = null;
    if (order.notes) {
      const match = order.notes.match(/GCash Tracking ID: ([^\s|]+)/);
      if (match) {
        transactionId = match[1];
      }
    }
      
    res.json({
      order_id: orderId,
      payment_status: order.payment_status,
      payment_method: order.payment_method,
      transaction_id: transactionId
    });

  } catch (error) {
    console.error('Get payment status error:', error);
    res.status(500).json({ error: 'Failed to get payment status' });
  }
};

// Cancel payment/order during payment process
export const cancelPayment = async (req, res) => {
  const { orderId } = req.params;
  const userId = req.user.id;

  try {
    // Get order details and verify ownership
    const [orders] = await pool.query(
      'SELECT user_id, status, payment_status, total_amount, payment_method FROM orders WHERE id = ?',
      [orderId]
    );

    if (orders.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (orders[0].user_id !== userId) {
      return res.status(403).json({ error: 'You can only cancel your own orders' });
    }

    const order = orders[0];

    // Check if order can be cancelled (only if not processing or beyond)
    const cancellableStatuses = ['pending'];
    if (!cancellableStatuses.includes(order.status)) {
      return res.status(400).json({ 
        error: 'Order cannot be cancelled',
        message: `Orders with status '${order.status}' cannot be cancelled. Only pending orders can be cancelled.`,
        currentStatus: order.status,
        cancellableStatuses
      });
    }

    // Update order status to cancelled
    await pool.query(
      'UPDATE orders SET status = ?, payment_status = ?, updated_at = NOW() WHERE id = ?',
      ['cancelled', 'cancelled', orderId]
    );

    // Log status change
    await pool.query(`
      INSERT INTO order_status_logs (order_id, old_status, new_status, notes, created_at)
      VALUES (?, ?, ?, ?, NOW())
    `, [orderId, order.status, 'cancelled', 'Cancelled during payment process']);

    // Restore stock for cancelled order
    const { restoreOrderStock } = await import('./order.controller.js');
    await restoreOrderStock(orderId);
    
    // Log sales reversal
    const { logSalesMovement } = await import('./order.controller.js');
    await logSalesMovement(orderId, 'reversal', order.total_amount, order.payment_method, 'Order cancelled during payment');

    // Create notification for user
    const { createOrderStatusNotification, createCancelledOrderNotification } = await import('./order.controller.js');
    await createOrderStatusNotification(userId, orderId, 'cancelled');
    await createCancelledOrderNotification(orderId, userId);

    console.log(`✅ Payment cancelled for order ${orderId} by user ${userId}`);

    res.json({
      success: true,
      message: 'Order cancelled successfully',
      orderId: orderId,
      previousStatus: order.status,
      newStatus: 'cancelled'
    });

  } catch (error) {
    console.error('Cancel payment error:', error);
    res.status(500).json({ 
      error: 'Failed to cancel payment',
      details: error.message
    });
  }
};

// Get GCash payment statistics (for admin tracking)
export const getGCashStats = async (req, res) => {
  try {
    // Get total GCash selections
    const [gcashStats] = await pool.query(`
      SELECT 
        COUNT(*) as total_gcash_selections,
        COUNT(CASE WHEN payment_status = 'unpaid' THEN 1 END) as unpaid_gcash_orders,
        COUNT(CASE WHEN payment_status = 'paid' THEN 1 END) as paid_gcash_orders,
        SUM(CASE WHEN payment_status = 'paid' THEN total_amount ELSE 0 END) as total_gcash_revenue
      FROM orders 
      WHERE payment_method = 'gcash'
    `);

    // Get GCash selections by date
    const [gcashByDate] = await pool.query(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as selections,
        COUNT(CASE WHEN payment_status = 'unpaid' THEN 1 END) as unpaid,
        COUNT(CASE WHEN payment_status = 'paid' THEN 1 END) as paid
      FROM orders 
      WHERE payment_method = 'gcash'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 30
    `);

    res.json({
      success: true,
      stats: gcashStats[0],
      daily_breakdown: gcashByDate
    });

  } catch (error) {
    console.error('Get GCash stats error:', error);
    res.status(500).json({ error: 'Failed to get GCash statistics' });
  }
};
