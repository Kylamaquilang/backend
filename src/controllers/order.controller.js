import { pool } from '../database/db.js'
import { createOrderStatusNotification } from '../utils/notification-helper.js'
import { emitOrderUpdate, emitNewOrderAlert, createAndEmitNotification, emitUserNotification, emitAdminDataRefresh, emitUserDataRefresh } from '../utils/socket-helper.js'
import { sendDeliveredOrderEmail, sendOrderReceiptEmail } from '../utils/emailService.js'

// Helper function to create delivered order notification for admin confirmation
const createDeliveredOrderNotification = async (orderId, userId) => {
  try {
    // Get all admin users
    const [adminUsers] = await pool.query(`
      SELECT id, name FROM users WHERE role = 'admin'
    `);
    
    // Get customer info and product summary for the order
    const [orderInfo] = await pool.query(`
      SELECT u.name as customer_name,
             GROUP_CONCAT(CONCAT(oi.quantity, 'x ', p.name, 
               CASE WHEN ps.size IS NOT NULL THEN CONCAT(' (', ps.size, ')') ELSE '' END
             ) SEPARATOR ', ') as product_summary
      FROM orders o
      JOIN users u ON o.user_id = u.id
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      LEFT JOIN product_sizes ps ON oi.size_id = ps.id
      WHERE o.id = ?
      GROUP BY o.id, u.name
    `, [orderId]);
    
    const customerName = orderInfo[0]?.customer_name || 'Customer';
    const productSummary = orderInfo[0]?.product_summary || 'items';
    
    // Create notification for each admin user
    for (const admin of adminUsers) {
      await pool.query(`
        INSERT INTO notifications (user_id, title, message, type, related_id, created_at)
        VALUES (?, ?, ?, ?, ?, NOW())
      `, [
        admin.id,
        `📦 ${productSummary} Order Delivered - Confirmation Needed`,
        `Order for ${productSummary} from ${customerName} has been delivered. Please confirm receipt.`,
        'delivered_confirmation',
        orderId
      ]);
    }
    
  } catch (error) {
    console.error('Error creating delivered order notification:', error);
  }
}

// Helper function to create cancelled order notification for admin
const createCancelledOrderNotification = async (orderId, userId) => {
  try {
    // Get all admin users
    const [adminUsers] = await pool.query(`
      SELECT id, name FROM users WHERE role = 'admin'
    `);
    
    // Get customer info and product summary for the order
    const [orderInfo] = await pool.query(`
      SELECT u.name as customer_name,
             GROUP_CONCAT(CONCAT(oi.quantity, 'x ', p.name, 
               CASE WHEN ps.size IS NOT NULL THEN CONCAT(' (', ps.size, ')') ELSE '' END
             ) SEPARATOR ', ') as product_summary
      FROM orders o
      JOIN users u ON o.user_id = u.id
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      LEFT JOIN product_sizes ps ON oi.size_id = ps.id
      WHERE o.id = ?
      GROUP BY o.id, u.name
    `, [orderId]);
    
    const customerName = orderInfo[0]?.customer_name || 'Customer';
    const productSummary = orderInfo[0]?.product_summary || 'items';
    
    // Create notification for each admin user
    for (const admin of adminUsers) {
      await pool.query(`
        INSERT INTO notifications (user_id, title, message, type, related_id, created_at)
        VALUES (?, ?, ?, ?, ?, NOW())
      `, [
        admin.id,
        `❌ ${productSummary} Order Cancelled`,
        `Order for ${productSummary} from ${customerName} has been cancelled.`,
        'order_cancelled',
        orderId
      ]);
    }
    
    console.log(`✅ Cancelled order notifications created for order #${orderId}`);
  } catch (error) {
    console.error('❌ Error creating cancelled order notification:', error);
  }
}

// 📄 User gets their order details (for thank you page)
export const getUserOrderDetails = async (req, res) => {
  const user_id = req.user.id
  const order_id = req.params.id

  try {
    // Get order details
    const [orders] = await pool.query(`
      SELECT id, total_amount, payment_method, pay_at_counter, status, payment_status, created_at
      FROM orders 
      WHERE id = ? AND user_id = ?
    `, [order_id, user_id])

    if (orders.length === 0) {
      return res.status(404).json({ error: 'Order not found' })
    }

    const order = orders[0]

    // Get order items
    const [items] = await pool.query(`
      SELECT product_name, quantity, unit_price, unit_cost, total_price
      FROM order_items 
      WHERE order_id = ?
    `, [order_id])

    res.json({
      ...order,
      items: items
    })

  } catch (error) {
    console.error('Error fetching user order details:', error)
    res.status(500).json({ error: 'Failed to fetch order details' })
  }
}

// 📄 User views their orders
export const getUserOrders = async (req, res) => {
  const user_id = req.user.id

  try {
    const [orders] = await pool.query(`
      SELECT id, total_amount, payment_method, pay_at_counter, status, created_at
      FROM orders
      WHERE user_id = ?
      ORDER BY created_at DESC
    `, [user_id])

    // Get order items for each order to include product names
    for (let order of orders) {
      const [items] = await pool.query(`
        SELECT 
          oi.quantity, 
          oi.unit_price,
          oi.total_price,
          CASE 
            WHEN oi.product_id IS NULL THEN 'Unavailable Product'
            ELSE p.name 
          END as product_name, 
          CASE 
            WHEN oi.product_id IS NULL THEN NULL
            ELSE p.image 
          END as image, 
          oi.product_id,
          ps.size as size_name
        FROM order_items oi
        LEFT JOIN products p ON oi.product_id = p.id
        LEFT JOIN product_sizes ps ON oi.size_id = ps.id
        WHERE oi.order_id = ?
      `, [order.id])
      
      order.items = items
    }

    res.json(orders)
  } catch (err) {
    console.error('User order history error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}

// 👩‍💼 Admin views all orders
export const getAllOrders = async (req, res) => {
  try {
    console.log('📋 Fetching all orders for admin...');
    
    const [orders] = await pool.query(`
      SELECT 
        o.id, 
        o.user_id, 
        u.name AS user_name,
        u.student_id,
        u.email,
        u.degree,
        u.year_level,
        u.section,
        o.total_amount, 
        o.payment_method, 
        o.pay_at_counter,
        o.payment_status,
        o.status, 
        o.created_at,
        o.updated_at,
        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as item_count,
        (SELECT SUM(quantity) FROM order_items WHERE order_id = o.id) as total_quantity
      FROM orders o
      JOIN users u ON o.user_id = u.id
      ORDER BY o.created_at DESC
    `)

    console.log(`📋 Found ${orders.length} orders`);

    // Get order items for each order to include product names
    for (let order of orders) {
      const [items] = await pool.query(`
        SELECT 
          oi.quantity, 
          oi.unit_price,
          oi.unit_cost,
          oi.total_price,
          CASE 
            WHEN oi.product_id IS NULL THEN 'Unavailable Product'
            ELSE p.name 
          END as product_name, 
          CASE 
            WHEN oi.product_id IS NULL THEN NULL
            ELSE p.image 
          END as image, 
          oi.product_id,
          ps.size as size_name
        FROM order_items oi
        LEFT JOIN products p ON oi.product_id = p.id
        LEFT JOIN product_sizes ps ON oi.size_id = ps.id
        WHERE oi.order_id = ?
      `, [order.id])
      
      order.items = items
    }

    console.log('✅ Orders fetched successfully');
    res.json(orders)
  } catch (err) {
    console.error('❌ Admin orders fetch error:', err.message)
    console.error('Error details:', err)
    res.status(500).json({ 
      error: 'Internal server error',
      message: err.message,
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    })
  }
}

// 📦 Get order items (with size)
// IMPORTANT: Returns oi.unit_price (transaction-time price), NOT current product price
export const getOrderItems = async (req, res) => {
  const { id } = req.params

  try {
    const [items] = await pool.query(`
      SELECT 
        oi.quantity, 
        oi.size, 
        oi.unit_price, 
        oi.unit_cost, 
        oi.total_price, 
        CASE 
          WHEN oi.product_id IS NULL THEN 'Unavailable Product'
          ELSE p.name 
        END as name, 
        CASE 
          WHEN oi.product_id IS NULL THEN NULL
          ELSE p.image 
        END as image, 
        oi.product_id
      FROM order_items oi
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
    `, [id])

    res.json(items)
  } catch (err) {
    console.error('Get order items error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}

// 📋 Get single order with details
export const getOrderById = async (req, res) => {
  const { id } = req.params

  try {
    // Get order details
    const [orders] = await pool.query(`
      SELECT 
        o.id, 
        o.user_id, 
        u.name AS user_name,
        u.student_id,
        u.email,
        u.degree,
        u.section,
        o.total_amount, 
        o.payment_method, 
        o.pay_at_counter,
        o.status, 
        o.created_at,
        o.updated_at
      FROM orders o
      JOIN users u ON o.user_id = u.id
      WHERE o.id = ?
    `, [id])

    if (orders.length === 0) {
      return res.status(404).json({ error: 'Order not found' })
    }

    const order = orders[0]

    // Get order items
    // IMPORTANT: Using oi.unit_price (transaction-time price), NOT p.price or ps.price (current product price)
    // This ensures historical orders show the price at the time of purchase, not the current price
    const [items] = await pool.query(`
      SELECT 
        oi.quantity, 
        oi.unit_price, 
        oi.total_price, 
        oi.size as size,
        p.name as product_name, 
        p.image, 
        p.id as product_id, 
        ps.size as size_name
      FROM order_items oi
      LEFT JOIN products p ON oi.product_id = p.id
      LEFT JOIN product_sizes ps ON oi.size_id = ps.id
      WHERE oi.order_id = ?
    `, [id])

    // Get order status history
    const [statusHistory] = await pool.query(`
      SELECT old_status, new_status, notes, created_at
      FROM order_status_logs
      WHERE order_id = ?
      ORDER BY created_at DESC
    `, [id])

    res.json({
      ...order,
      items,
      status_history: statusHistory
    })
  } catch (err) {
    console.error('Get order by ID error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}

// 🔁 Admin updates order status
export const updateOrderStatus = async (req, res) => {
  const { id } = req.params
  const { status, notes } = req.body

  // Enhanced order statuses
  const validStatuses = ['pending', 'processing', 'ready_for_pickup', 'claimed', 'cancelled', 'refunded']
  
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ 
      error: 'Invalid status value',
      validStatuses: validStatuses
    })
  }

  try {
    // Get current order details
    const [currentOrder] = await pool.query(
      'SELECT status, user_id, total_amount, payment_method, payment_status FROM orders WHERE id = ?',
      [id]
    )

    if (currentOrder.length === 0) {
      return res.status(404).json({ error: 'Order not found' })
    }

    const oldStatus = currentOrder[0].status
    const userId = currentOrder[0].user_id
    const totalAmount = currentOrder[0].total_amount
    const paymentMethod = currentOrder[0].payment_method
    const paymentStatus = currentOrder[0].payment_status

    // Update order status
    const [result] = await pool.query(
      `UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?`,
      [status, id]
    )

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Order not found' })
    }

    // Log status change
    await pool.query(`
      INSERT INTO order_status_logs (order_id, old_status, new_status, notes, created_at)
      VALUES (?, ?, ?, ?, NOW())
    `, [id, oldStatus, status, notes || null])

    // Handle inventory and sales tracking based on status changes
    if (status === 'processing' && oldStatus !== 'processing') {
      // Automatically record stock out when order moves to processing
      await recordOrderStockOut(id, req.user.id)
      
    } else if (status === 'cancelled' || status === 'refunded') {
      // Restore stock for cancelled/refunded orders
      await restoreOrderStock(id)
      
      // Log sales reversal
      await logSalesMovement(id, 'reversal', totalAmount, paymentMethod, `Order ${status}`)
      
    } else if ((status === 'claimed' || status === 'completed') && (oldStatus !== 'claimed' && oldStatus !== 'completed')) {
      // Record the sale when order is claimed or completed
      await logSalesMovement(id, 'sale', totalAmount, paymentMethod, `Order ${status} - Sale recorded`)
      
      // Automatically mark payment as paid when order is claimed or completed
      if (paymentStatus !== 'paid') {
        await pool.query(
          'UPDATE orders SET payment_status = ? WHERE id = ?',
          ['paid', id]
        )
        
        // Log the payment completion
        await pool.query(`
          INSERT INTO payment_transactions (
            order_id, 
            transaction_id, 
            amount, 
            payment_method, 
            status, 
            gateway_response,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, NOW())
        `, [
          id,
          `auto_paid_${id}_${Date.now()}`,
          totalAmount,
          paymentMethod,
          'completed',
          JSON.stringify({ 
            auto_completed: true, 
            reason: 'Order claimed',
            completed_at: new Date().toISOString()
          })
        ])
      }
    }

    // Create notification for user
    console.log(`🔔 Starting notification creation for order ${id}, user ${userId}, status: ${status}`);
    const notificationResult = await createOrderStatusNotification(userId, id, status)
    console.log(`🔔 Notification result:`, notificationResult);
    
    // Emit real-time notification to user
    const io = req.app.get('io')
    console.log(`🔔 Socket.io instance available:`, !!io);
    if (io && notificationResult) {
      console.log(`🔔 Emitting notification to user ${userId}`);
      emitUserNotification(io, userId, {
        id: notificationResult.id,
        title: notificationResult.title,
        message: notificationResult.message,
        type: notificationResult.type,
        orderId: id,
        status: status,
        read: false,
        timestamp: new Date().toISOString(),
        priority: status === 'ready_for_pickup' ? 'high' : 'medium',
        hasAction: notificationResult.hasAction,
        actionData: notificationResult.actionData
      })
    } else {
      console.log(`🔔 Not emitting notification - io: ${!!io}, notificationResult:`, !!notificationResult);
    }
    
    // Send claimed/completed order notification (no email)
    if ((status === 'claimed' || status === 'completed') && (oldStatus !== 'claimed' && oldStatus !== 'completed')) {
      console.log(`📧 Order ${id} marked as ${status} - no email sent`);
    }
    
    // Email notifications disabled - only in-app notifications are used
    
    // Emit real-time order update
    if (io) {
      emitOrderUpdate(io, userId, {
        orderId: id,
        status,
        previousStatus: oldStatus,
        timestamp: new Date().toISOString()
      })
      
      // Emit data refresh signals
      emitAdminDataRefresh(io, 'orders', { action: 'updated', orderId: id, status });
      emitUserDataRefresh(io, userId, 'orders', { action: 'updated', orderId: id, status });
    }
    
    // If order is marked as claimed or completed, create special notification for admin confirmation
    if (status === 'claimed' || status === 'completed') {
      await createDeliveredOrderNotification(id, userId)
    }
    
    // If order is cancelled, create admin notification
    if (status === 'cancelled') {
      await createCancelledOrderNotification(id, userId)
    }

    res.json({ 
      message: `Order status updated to '${status}'`,
      previousStatus: oldStatus,
      newStatus: status,
      inventoryUpdated: (status === 'cancelled' || status === 'refunded'),
      salesLogged: (status === 'claimed' || status === 'completed'),
      paymentStatusUpdated: ((status === 'claimed' || status === 'completed') && paymentStatus !== 'paid'),
      paymentStatus: (status === 'claimed' || status === 'completed') ? 'paid' : paymentStatus
    })
  } catch (err) {
    console.error('Update status error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}

// Helper function to record stock out when order moves to processing
const recordOrderStockOut = async (orderId, userId) => {
  try {
    // Get order items
    const [orderItems] = await pool.query(`
      SELECT oi.product_id, oi.quantity, p.name as product_name
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
    `, [orderId])

    for (const item of orderItems) {
      // Check if stock_movements table exists
      try {
        await pool.query('SELECT 1 FROM stock_movements LIMIT 1')
      } catch (tableError) {
        console.log('Stock movements table does not exist, creating it...')
        await pool.query(`
          CREATE TABLE IF NOT EXISTS stock_movements (
            id INT PRIMARY KEY AUTO_INCREMENT,
            product_id INT NOT NULL,
            user_id INT NOT NULL,
            movement_type ENUM('stock_in', 'stock_out') NOT NULL,
            quantity INT NOT NULL,
            previous_stock INT DEFAULT 0,
            new_stock INT DEFAULT 0,
            reason VARCHAR(100) NOT NULL,
            supplier VARCHAR(200),
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            
            CONSTRAINT chk_movement_quantity CHECK (quantity > 0),
            INDEX idx_stock_movements_product (product_id),
            INDEX idx_stock_movements_user (user_id),
            INDEX idx_stock_movements_type (movement_type),
            INDEX idx_stock_movements_date (created_at)
          )
        `)
      }

      // Record stock out movement
      await pool.query(`
        INSERT INTO stock_movements 
        (product_id, user_id, movement_type, quantity, reason, notes, created_at) 
        VALUES (?, ?, 'stock_out', ?, 'sale', ?, NOW())
      `, [
        item.product_id, 
        userId, 
        item.quantity, 
        `Order #${orderId} - ${item.product_name}`
      ])

      // Note: Stock is already deducted during checkout process
      // No need to deduct again here as it would cause double deduction
    }

    console.log(`✅ Stock out recorded for order ${orderId}`)
  } catch (error) {
    console.error('Error recording stock out:', error)
  }
}

// Helper function to restore stock for cancelled orders
const restoreOrderStock = async (orderId) => {
  try {
    const [orderItems] = await pool.query(`
      SELECT oi.product_id, oi.quantity, oi.size_id, ps.stock as size_stock
      FROM order_items oi
      LEFT JOIN product_sizes ps ON oi.size_id = ps.id
      WHERE oi.order_id = ?
    `, [orderId])

    for (const item of orderItems) {
      if (item.size_id) {
        // Restore size-specific stock
        await pool.query(
          'UPDATE product_sizes SET stock = stock + ? WHERE id = ?',
          [item.quantity, item.size_id]
        )
      } else {
        // Restore general product stock
        await pool.query(
          'UPDATE products SET stock = stock + ? WHERE id = ?',
          [item.quantity, item.product_id]
        )
      }
    }
  } catch (error) {
    console.error('Error restoring stock:', error)
  }
}

// Helper function to log sales movements
const logSalesMovement = async (orderId, movementType, amount, paymentMethod, description) => {
  try {
    await pool.query(`
      INSERT INTO sales_logs (order_id, movement_type, amount, payment_method, description, created_at)
      VALUES (?, ?, ?, ?, ?, NOW())
    `, [orderId, movementType, amount, paymentMethod, description])
  } catch (error) {
    console.error('Error logging sales movement:', error)
  }
}


// 📊 Get order statistics
export const getOrderStats = async (req, res) => {
  try {
    const { period = 'month' } = req.query
    let dateFilter = ''
    
    switch (period) {
      case 'day':
        dateFilter = 'AND DATE(created_at) = CURDATE()'
        break
      case 'week':
        dateFilter = 'AND YEARWEEK(created_at) = YEARWEEK(CURDATE())'
        break
      case 'month':
        dateFilter = 'AND YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE())'
        break
      case 'year':
        dateFilter = 'AND YEAR(created_at) = YEAR(CURDATE())'
        break
    }

    const [stats] = await pool.query(`
      SELECT 
        COUNT(*) as total_orders,
        SUM(total_amount) as total_revenue,
        AVG(total_amount) as avg_order_value,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_orders,
        COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing_orders,
        COUNT(CASE WHEN status = 'ready_for_pickup' THEN 1 END) as ready_orders,
        COUNT(CASE WHEN status = 'claimed' THEN 1 END) as claimed_orders,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_orders
      FROM orders
      WHERE 1=1 ${dateFilter}
    `)

    const [dailyStats] = await pool.query(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as orders,
        SUM(total_amount) as revenue
      FROM orders
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `)

    res.json({
      period,
      summary: stats[0],
      dailyStats,
      statusBreakdown: {
        pending: stats[0].pending_orders,
        processing: stats[0].processing_orders,
        ready: stats[0].ready_orders,
        claimed: stats[0].claimed_orders,
        cancelled: stats[0].cancelled_orders
      }
    })
  } catch (err) {
    console.error('Get order stats error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}

// 📋 Get detailed sales report (order items)
export const getDetailedSalesReport = async (req, res) => {
  try {
    console.log('📊 Detailed sales report request received:', req.query)
    
    const { start_date, end_date, product_id, size, category_id } = req.query
    
    // Build date filter
    let dateFilter = '';
    let dateParams = [];
    
    if (start_date) {
      dateFilter += 'AND DATE(o.created_at) >= ? ';
      dateParams.push(start_date);
    }
    if (end_date) {
      dateFilter += 'AND DATE(o.created_at) <= ? ';
      dateParams.push(end_date);
    }
    
    // Build product filter
    if (product_id) {
      dateFilter += 'AND p.id = ? ';
      dateParams.push(parseInt(product_id));
    }
    
    // Build size filter
    if (size) {
      // Handle both explicit size values and 'N/A' for products without sizes
      if (size === 'N/A' || size === 'NONE') {
        dateFilter += 'AND (COALESCE(oi.size, ps.size, \'N/A\') = \'N/A\' OR COALESCE(oi.size, ps.size, \'N/A\') = \'NONE\') ';
      } else {
        dateFilter += 'AND (COALESCE(oi.size, ps.size, \'N/A\') = ?) ';
        dateParams.push(size);
      }
    }
    
    // Build category filter
    if (category_id) {
      dateFilter += 'AND p.category_id = ? ';
      dateParams.push(parseInt(category_id));
    }
    
    // Get detailed order items for claimed/completed orders
    // Note: size is saved to order_items during checkout, but we also join with product_sizes to ensure all sizes are displayed
    // IMPORTANT: Using oi.unit_price (transaction-time price) for accurate historical sales reporting
    // Historical prices are LOCKED and never change, even if product prices are updated later
    const [orderItems] = await pool.query(`
      SELECT 
        o.created_at as order_date,
        p.id as product_id,
        p.name as product_name,
        p.category_id,
        COALESCE(c.name, 'Uncategorized') as category_name,
        COALESCE(oi.size, ps.size, 'N/A') as size,
        oi.quantity,
        oi.unit_price,
        oi.total_price as item_total,
        o.payment_method,
        o.status,
        u.name as customer_name,
        u.student_id,
        u.email as customer_email,
        -- Compare historical price (oi.unit_price) with current price to identify price changes
        CASE 
          WHEN oi.size_id IS NOT NULL THEN
            CASE 
              WHEN ABS(oi.unit_price - COALESCE(ps.price, p.price)) > 0.01 THEN 1
              ELSE 0
            END
          ELSE
            CASE 
              WHEN ABS(oi.unit_price - p.price) > 0.01 THEN 1
              ELSE 0
            END
        END as is_historical_price,
        COALESCE(ps.price, p.price) as current_price
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN product_sizes ps ON oi.size_id = ps.id
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.status IN ('claimed', 'completed')
      ${dateFilter}
      ORDER BY o.created_at DESC, p.name
    `, dateParams);
    
    console.log(`📊 Found ${orderItems.length} order items for sales report`);
    if (orderItems.length > 0) {
      console.log('📊 Detailed sample of first 3 items:');
      orderItems.slice(0, 3).forEach((item, idx) => {
        console.log(`   Item ${idx + 1}:`);
        console.log(`   - Product: ${item.product_name}`);
        console.log(`   - Size: "${item.size || 'NULL/EMPTY'}" (type: ${typeof item.size})`);
        console.log(`   - Quantity: ${item.quantity}`);
        console.log(`   - Unit Price: ${item.unit_price}`);
        console.log(`   - Total: ${item.item_total}`);
        console.log(`   - Payment: ${item.payment_method}`);
        console.log('   ---');
      });
    } else {
      console.log('📊 No order items found for sales report!');
    }
    
    // Calculate summary (using same filters)
    const [summary] = await pool.query(`
      SELECT 
        COUNT(DISTINCT o.id) as total_orders,
        SUM(oi.total_price) as total_revenue,
        COUNT(DISTINCT CASE WHEN LOWER(o.payment_method) = 'gcash' THEN o.id END) as gcash_orders,
        COUNT(DISTINCT CASE WHEN LOWER(o.payment_method) = 'cash' THEN o.id END) as cash_orders,
        SUM(CASE WHEN LOWER(o.payment_method) = 'gcash' THEN oi.total_price ELSE 0 END) as gcash_revenue,
        SUM(CASE WHEN LOWER(o.payment_method) = 'cash' THEN oi.total_price ELSE 0 END) as cash_revenue
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      LEFT JOIN product_sizes ps ON oi.size_id = ps.id
      WHERE o.status IN ('claimed', 'completed')
      ${dateFilter}
    `, dateParams);
    
    // Calculate revenue breakdown by price point (historical vs current)
    // Compare order_items.unit_price (historical/locked price) with current product price
    const [priceBreakdown] = await pool.query(`
      SELECT 
        -- Historical prices (locked at time of sale, may differ from current price)
        SUM(CASE 
          WHEN oi.size_id IS NOT NULL THEN
            CASE 
              WHEN ABS(oi.unit_price - COALESCE(ps.price, p.price)) > 0.01 THEN oi.total_price
              ELSE 0
            END
          ELSE
            CASE 
              WHEN ABS(oi.unit_price - p.price) > 0.01 THEN oi.total_price
              ELSE 0
            END
        END) as revenue_from_historical_prices,
        
        -- Current price (sales made at current product price)
        SUM(CASE 
          WHEN oi.size_id IS NOT NULL THEN
            CASE 
              WHEN ABS(oi.unit_price - COALESCE(ps.price, p.price)) <= 0.01 THEN oi.total_price
              ELSE 0
            END
          ELSE
            CASE 
              WHEN ABS(oi.unit_price - p.price) <= 0.01 THEN oi.total_price
              ELSE 0
            END
        END) as revenue_from_current_price,
        
        -- Count of items sold at historical prices
        SUM(CASE 
          WHEN oi.size_id IS NOT NULL THEN
            CASE 
              WHEN ABS(oi.unit_price - COALESCE(ps.price, p.price)) > 0.01 THEN oi.quantity
              ELSE 0
            END
          ELSE
            CASE 
              WHEN ABS(oi.unit_price - p.price) > 0.01 THEN oi.quantity
              ELSE 0
            END
        END) as items_at_historical_price,
        
        -- Count of items sold at current price
        SUM(CASE 
          WHEN oi.size_id IS NOT NULL THEN
            CASE 
              WHEN ABS(oi.unit_price - COALESCE(ps.price, p.price)) <= 0.01 THEN oi.quantity
              ELSE 0
            END
          ELSE
            CASE 
              WHEN ABS(oi.unit_price - p.price) <= 0.01 THEN oi.quantity
              ELSE 0
            END
        END) as items_at_current_price
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      LEFT JOIN product_sizes ps ON oi.size_id = ps.id
      WHERE o.status IN ('claimed', 'completed')
      ${dateFilter}
    `, dateParams);
    
    console.log(`📊 Found ${orderItems.length} order items`);
    
    res.json({
      orderItems,
      summary: summary[0] || {
        total_orders: 0,
        total_revenue: 0,
        gcash_orders: 0,
        cash_orders: 0,
        gcash_revenue: 0,
        cash_revenue: 0
      },
      priceBreakdown: priceBreakdown[0] || {
        revenue_from_historical_prices: 0,
        revenue_from_current_price: 0,
        items_at_historical_price: 0,
        items_at_current_price: 0
      }
    });
  } catch (err) {
    console.error('Detailed sales report error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
};

// 📊 Get product sales report (grouped by product with historical prices)
export const getProductSalesReport = async (req, res) => {
  try {
    console.log('📊 Product sales report request received:', req.query);
    
    const { start_date, end_date, product_id, size, min_price, max_price } = req.query;
    
    // Build date filter
    let dateFilter = '';
    let dateParams = [];
    
    if (start_date) {
      dateFilter += 'AND DATE(o.created_at) >= ? ';
      dateParams.push(start_date);
    }
    if (end_date) {
      dateFilter += 'AND DATE(o.created_at) <= ? ';
      dateParams.push(end_date);
    }
    
    // Build product filter
    if (product_id) {
      dateFilter += 'AND p.id = ? ';
      dateParams.push(parseInt(product_id));
    }
    
    // Build size filter
    if (size) {
      // Handle both explicit size values and 'N/A' for products without sizes
      if (size === 'N/A' || size === 'NONE') {
        dateFilter += 'AND (COALESCE(oi.size, ps.size, \'N/A\') = \'N/A\' OR COALESCE(oi.size, ps.size, \'N/A\') = \'NONE\') ';
      } else {
        dateFilter += 'AND (COALESCE(oi.size, ps.size, \'N/A\') = ?) ';
        dateParams.push(size);
      }
    }
    
    // Build price filter
    if (min_price) {
      dateFilter += 'AND oi.unit_price >= ? ';
      dateParams.push(parseFloat(min_price));
    }
    if (max_price) {
      dateFilter += 'AND oi.unit_price <= ? ';
      dateParams.push(parseFloat(max_price));
    }
    
    // Get product sales grouped by product, showing historical prices
    // IMPORTANT: Using oi.unit_price (transaction-time price) to preserve historical pricing
    const [productSales] = await pool.query(`
      SELECT 
        p.id as product_id,
        p.name as product_name,
        p.image as product_image,
        COALESCE(oi.size, ps.size, 'N/A') as size,
        oi.unit_price as sale_price,
        SUM(oi.quantity) as total_quantity_sold,
        COUNT(DISTINCT o.id) as order_count,
        SUM(oi.total_price) as total_revenue,
        MIN(o.created_at) as first_sale_date,
        MAX(o.created_at) as last_sale_date
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      LEFT JOIN product_sizes ps ON oi.size_id = ps.id
      WHERE o.status IN ('claimed', 'completed')
      ${dateFilter}
      GROUP BY p.id, p.name, p.image, COALESCE(oi.size, ps.size, 'N/A'), oi.unit_price
      ORDER BY p.name, oi.unit_price DESC, total_quantity_sold DESC
    `, dateParams);
    
    console.log(`📊 Found ${productSales.length} product sales records`);
    
    // Calculate summary (using same filters)
    const [summary] = await pool.query(`
      SELECT 
        COUNT(DISTINCT o.id) as total_orders,
        COUNT(DISTINCT oi.product_id) as unique_products,
        SUM(oi.total_price) as total_revenue,
        SUM(oi.quantity) as total_items_sold
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      WHERE o.status IN ('claimed', 'completed')
      ${dateFilter}
    `, dateParams);
    
    // Calculate revenue breakdown by price point (historical vs current)
    // IMPORTANT: This compares order_items.unit_price (locked historical price) with current product price
    // Historical prices are NEVER modified - they remain locked at the time of purchase
    const [priceBreakdown] = await pool.query(`
      SELECT 
        -- Revenue from historical prices (sales made at old prices, before price changes)
        SUM(CASE 
          WHEN oi.size_id IS NOT NULL THEN
            CASE 
              WHEN ABS(oi.unit_price - COALESCE(ps.price, p.price)) > 0.01 THEN oi.total_price
              ELSE 0
            END
          ELSE
            CASE 
              WHEN ABS(oi.unit_price - p.price) > 0.01 THEN oi.total_price
              ELSE 0
            END
        END) as revenue_from_historical_prices,
        
        -- Revenue from current price (sales made at current product price)
        SUM(CASE 
          WHEN oi.size_id IS NOT NULL THEN
            CASE 
              WHEN ABS(oi.unit_price - COALESCE(ps.price, p.price)) <= 0.01 THEN oi.total_price
              ELSE 0
            END
          ELSE
            CASE 
              WHEN ABS(oi.unit_price - p.price) <= 0.01 THEN oi.total_price
              ELSE 0
            END
        END) as revenue_from_current_price,
        
        -- Count of items sold at historical prices
        SUM(CASE 
          WHEN oi.size_id IS NOT NULL THEN
            CASE 
              WHEN ABS(oi.unit_price - COALESCE(ps.price, p.price)) > 0.01 THEN oi.quantity
              ELSE 0
            END
          ELSE
            CASE 
              WHEN ABS(oi.unit_price - p.price) > 0.01 THEN oi.quantity
              ELSE 0
            END
        END) as items_at_historical_price,
        
        -- Count of items sold at current price
        SUM(CASE 
          WHEN oi.size_id IS NOT NULL THEN
            CASE 
              WHEN ABS(oi.unit_price - COALESCE(ps.price, p.price)) <= 0.01 THEN oi.quantity
              ELSE 0
            END
          ELSE
            CASE 
              WHEN ABS(oi.unit_price - p.price) <= 0.01 THEN oi.quantity
              ELSE 0
            END
        END) as items_at_current_price
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      LEFT JOIN product_sizes ps ON oi.size_id = ps.id
      WHERE o.status IN ('claimed', 'completed')
      ${dateFilter}
    `, dateParams);
    
    res.json({
      productSales,
      summary: summary[0] || {
        total_orders: 0,
        unique_products: 0,
        total_revenue: 0,
        total_items_sold: 0
      },
      priceBreakdown: priceBreakdown[0] || {
        revenue_from_historical_prices: 0,
        revenue_from_current_price: 0,
        items_at_historical_price: 0,
        items_at_current_price: 0
      }
    });
  } catch (err) {
    console.error('Product sales report error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
};

// 📈 Get sales performance
export const getSalesPerformance = async (req, res) => {
  try {
    console.log('📊 Sales performance request received:', req.query)
    
    const { start_date, end_date, group_by = 'day' } = req.query
    
    // Debug: Check what payment methods exist in claimed/completed orders
    const [paymentMethods] = await pool.query(`
      SELECT DISTINCT payment_method, COUNT(*) as count
      FROM orders 
      WHERE status IN ('claimed', 'completed')
      GROUP BY payment_method
    `);
    console.log('📊 Payment methods in claimed/completed orders:', paymentMethods)
    
    let groupClause = 'DATE(created_at)'
    if (group_by === 'month') {
      groupClause = 'DATE_FORMAT(created_at, "%Y-%m")'
    } else if (group_by === 'year') {
      groupClause = 'YEAR(created_at)'
    }

    console.log('📊 Executing sales data query...')
    
    // Simple date filtering - use DATE() function to avoid timezone issues
    let dateFilter = '';
    let dateParams = [];
    
    if (start_date) {
      dateFilter += 'AND DATE(o.created_at) >= ? ';
      dateParams.push(start_date);
    }
    if (end_date) {
      dateFilter += 'AND DATE(o.created_at) <= ? ';
      dateParams.push(end_date);
    }
    
    const [salesData] = await pool.query(`
      SELECT 
        ${groupClause.replace('created_at', 'o.created_at')} as period,
        COUNT(*) as orders,
        SUM(o.total_amount) as revenue,
        AVG(o.total_amount) as avg_order_value,
        COUNT(CASE WHEN LOWER(o.payment_method) = 'gcash' THEN 1 END) as gcash_orders,
        COUNT(CASE WHEN LOWER(o.payment_method) = 'cash' THEN 1 END) as cash_orders,
        SUM(CASE WHEN LOWER(o.payment_method) = 'gcash' THEN o.total_amount ELSE 0 END) as gcash_revenue,
        SUM(CASE WHEN LOWER(o.payment_method) = 'cash' THEN o.total_amount ELSE 0 END) as cash_revenue
      FROM orders o
      WHERE o.status IN ('claimed', 'completed')
      ${dateFilter}
      GROUP BY ${groupClause.replace('created_at', 'o.created_at')}
      ORDER BY period DESC
    `, dateParams)

    console.log('📊 Sales data query completed. Sample data:', salesData.slice(0, 2))
    console.log('📊 Executing top products query...')
    
    // Check if we have any orders first
    const [orderCount] = await pool.query('SELECT COUNT(*) as count FROM orders');
    console.log('📊 Total orders in database:', orderCount[0].count);
    
    let topProducts = [];
    if (orderCount[0].count > 0) {
      const [topProductsResult] = await pool.query(`
        SELECT 
          p.name as product_name,
          p.image as product_image,
          SUM(oi.quantity) as total_sold,
          SUM(oi.total_price) as total_revenue
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        JOIN orders o ON oi.order_id = o.id
        WHERE o.status IN ('claimed', 'completed')
        ${dateFilter}
        GROUP BY p.id, p.name, p.image
        ORDER BY total_sold DESC
        LIMIT 10
      `, dateParams)
      topProducts = topProductsResult;
    } else {
      console.log('📊 No orders found, returning empty top products');
    }

    // Get payment method breakdown
    console.log('📊 Executing payment breakdown query...')
    const [paymentBreakdown] = await pool.query(`
      SELECT 
        LOWER(o.payment_method) as payment_method,
        COUNT(*) as order_count,
        SUM(o.total_amount) as total_revenue,
        AVG(o.total_amount) as avg_order_value
      FROM orders o
      WHERE o.status IN ('claimed', 'completed')
      ${dateFilter}
      GROUP BY LOWER(o.payment_method)
      ORDER BY total_revenue DESC
    `, dateParams)

    // Get inventory movement summary (simplified)
    console.log('📊 Executing inventory summary query...')
    let inventorySummary = [];
    try {
      const [inventoryResult] = await pool.query(`
        SELECT 
          movement_type,
          COUNT(*) as movement_count,
          SUM(ABS(quantity_change)) as total_quantity,
          COUNT(DISTINCT product_id) as products_affected
        FROM inventory_movements im
        WHERE im.order_id IS NOT NULL
        ${dateFilter.replace('created_at', 'im.created_at')}
        GROUP BY movement_type
      `, dateParams)
      inventorySummary = inventoryResult;
    } catch (inventoryError) {
      console.log('📊 Inventory movements table not available:', inventoryError.message);
      inventorySummary = [];
    }

    // Get sales logs summary from orders (more accurate)
    console.log('📊 Executing sales logs summary query...')
    let salesLogsSummary = {};
    try {
      // Use orders table for accurate sales data instead of sales_logs
      const [salesLogsResult] = await pool.query(`
        SELECT 
          COUNT(*) as total_sales_logs,
          SUM(total_amount) as total_sales_revenue,
          COUNT(CASE WHEN status != 'cancelled' THEN 1 END) as completed_sales,
          COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as reversed_sales,
          SUM(CASE WHEN status != 'cancelled' THEN total_amount ELSE 0 END) as completed_revenue,
          SUM(CASE WHEN status = 'cancelled' THEN total_amount ELSE 0 END) as reversed_revenue
        FROM orders o
        WHERE 1=1
        ${dateFilter}
      `, dateParams);
      salesLogsSummary = salesLogsResult[0] || {};
    } catch (salesLogsError) {
      console.log('📊 Sales logs query failed:', salesLogsError.message);
      salesLogsSummary = {};
    }

    // Always create summary data from orders (for accurate totals)
    const [summary] = await pool.query(`
      SELECT 
        COUNT(*) as total_orders,
        SUM(o.total_amount) as total_revenue,
        AVG(o.total_amount) as avg_order_value,
        COUNT(CASE WHEN LOWER(o.payment_method) = 'gcash' THEN 1 END) as gcash_orders,
        COUNT(CASE WHEN LOWER(o.payment_method) = 'cash' THEN 1 END) as cash_orders,
        SUM(CASE WHEN LOWER(o.payment_method) = 'gcash' THEN o.total_amount ELSE 0 END) as gcash_revenue,
        SUM(CASE WHEN LOWER(o.payment_method) = 'cash' THEN o.total_amount ELSE 0 END) as cash_revenue
      FROM orders o
      WHERE o.status IN ('claimed', 'completed')
      ${dateFilter}
    `, dateParams);
    
    const summaryData = summary[0];

    res.json({
      salesData,
      topProducts,
      paymentBreakdown,
      inventorySummary,
      salesLogsSummary: salesLogsSummary,
      summary: summaryData,
      period: { start_date, end_date, group_by }
    })
  } catch (err) {
    console.error('Get sales performance error:', err)
    console.error('Error details:', {
      message: err.message,
      code: err.code,
      sqlState: err.sqlState,
      sqlMessage: err.sqlMessage
    })
    
    // Provide more specific error messages
    if (err.code === 'ER_NO_SUCH_TABLE') {
      res.status(500).json({ 
        error: 'Database tables not found',
        message: 'Required database tables are missing. Please run the database setup script.',
        details: err.message
      })
    } else if (err.code === 'ER_BAD_DB_ERROR') {
      res.status(500).json({ 
        error: 'Database connection error',
        message: 'Cannot connect to database. Please check your database configuration.',
        details: err.message
      })
    } else {
      res.status(500).json({ 
        error: 'Internal server error',
        message: 'Failed to fetch sales performance data',
        details: err.message
      })
    }
  }
}

// ✅ Admin confirms order receipt
export const confirmOrderReceipt = async (req, res) => {
  const { id } = req.params
  const { action } = req.body // 'received' or 'cancelled'

  try {
    // Get order details
    const [orderData] = await pool.query(
      'SELECT user_id, status FROM orders WHERE id = ?',
      [id]
    )

    if (orderData.length === 0) {
      return res.status(404).json({ error: 'Order not found' })
    }

    const userId = orderData[0].user_id
    const currentStatus = orderData[0].status

    if (currentStatus !== 'claimed') {
      return res.status(400).json({ 
        error: 'Order must be in claimed status to confirm receipt' 
      })
    }

    if (action === 'received') {
      // Order successfully received - create thank you notification for user
      const [notificationResult] = await pool.query(`
        INSERT INTO notifications (user_id, title, message, type, created_at)
        VALUES (?, ?, ?, ?, NOW())
      `, [
        userId,
        '🎉 Order Successfully Received!',
        'Thank you! Your order has been successfully received and confirmed. We appreciate your business!',
        'system'
      ])

      // Emit real-time notification
      const io = req.app.get('io')
      if (io) {
        emitUserNotification(io, userId, {
          id: notificationResult.insertId,
          title: '🎉 Order Successfully Received!',
          message: 'Thank you! Your order has been successfully received and confirmed. We appreciate your business!',
          type: 'system',
          orderId: id,
          status: 'completed',
          read: false,
          timestamp: new Date().toISOString(),
          priority: 'high'
        })
      }

      // Update order status to completed
      await pool.query(
        'UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?',
        ['completed', id]
      )

      res.json({ 
        success: true,
        message: 'Order receipt confirmed successfully',
        userNotified: true
      })

    } else if (action === 'cancelled') {
      // Order cancelled after delivery
      const [notificationResult] = await pool.query(`
        INSERT INTO notifications (user_id, title, message, type, created_at)
        VALUES (?, ?, ?, ?, NOW())
      `, [
        userId,
        '❌ Order Cancelled',
        'Your order has been cancelled after delivery. Please contact support for assistance.',
        'system'
      ])

      // Emit real-time notification
      const io = req.app.get('io')
      if (io) {
        emitUserNotification(io, userId, {
          id: notificationResult.insertId,
          title: '❌ Order Cancelled',
          message: 'Your order has been cancelled after delivery. Please contact support for assistance.',
          type: 'system',
          orderId: id,
          status: 'cancelled',
          read: false,
          timestamp: new Date().toISOString(),
          priority: 'high'
        })
      }

      // Update order status to cancelled
      await pool.query(
        'UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?',
        ['cancelled', id]
      )

      res.json({ 
        success: true,
        message: 'Order cancelled successfully',
        userNotified: true
      })

    } else {
      return res.status(400).json({ 
        error: 'Invalid action. Must be "received" or "cancelled"' 
      })
    }

  } catch (err) {
    console.error('Confirm order receipt error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}

// ✅ User confirms order receipt
export const userConfirmOrderReceipt = async (req, res) => {
  const { id } = req.params
  const user_id = req.user.id

  try {
    // Get order details and verify ownership
    const [orderData] = await pool.query(
      'SELECT user_id, status FROM orders WHERE id = ?',
      [id]
    )

    if (orderData.length === 0) {
      return res.status(404).json({ error: 'Order not found' })
    }

    if (orderData[0].user_id !== user_id) {
      return res.status(403).json({ error: 'You can only confirm your own orders' })
    }

    const currentStatus = orderData[0].status

    if (currentStatus !== 'claimed') {
      return res.status(400).json({ 
        error: 'Order must be in claimed status to confirm receipt' 
      })
    }

    // Update order status to completed
    await pool.query(
      'UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?',
      ['completed', id]
    )

    // Update sales and inventory - get order items and update stock
    const [orderItems] = await pool.query(`
      SELECT oi.product_id, oi.quantity, p.name as product_name
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
    `, [id]);

    // Note: Stock is already deducted during checkout process
    // No need to deduct again here as it would cause double deduction

    // Create product summary for notifications
    let productSummary = '';
    if (orderItems.length > 0) {
      if (orderItems.length === 1) {
        const item = orderItems[0];
        productSummary = `${item.quantity}x ${item.product_name}`;
      } else if (orderItems.length <= 3) {
        productSummary = orderItems.map(item => 
          `${item.quantity}x ${item.product_name}`
        ).join(', ');
      } else {
        const firstItem = orderItems[0];
        const firstItemText = `${firstItem.quantity}x ${firstItem.product_name}`;
        productSummary = `${firstItemText} and ${orderItems.length - 1} more items`;
      }
    }

    // Create thank you notification for user
    const [notificationResult] = await pool.query(`
      INSERT INTO notifications (user_id, title, message, type, created_at)
      VALUES (?, ?, ?, ?, NOW())
    `, [
      user_id,
      '🎉 Order Confirmed!',
      `Thank you for confirming receipt! Your order for ${productSummary} has been successfully completed. We appreciate your business!`,
      'system'
    ])

    // Emit real-time notification
    const io = req.app.get('io')
    if (io) {
      emitUserNotification(io, user_id, {
        id: notificationResult.insertId,
        title: '🎉 Order Confirmed!',
        message: `Thank you for confirming receipt! Your order for ${productSummary} has been successfully completed. We appreciate your business!`,
        type: 'system',
        orderId: id,
        status: 'completed',
        read: false,
        timestamp: new Date().toISOString(),
        priority: 'high'
      })
    }

    // Notify admins that user confirmed receipt and inventory updated
    const [adminUsers] = await pool.query(`
      SELECT id FROM users WHERE role = 'admin'
    `);
    
    for (const admin of adminUsers) {
      await pool.query(`
        INSERT INTO notifications (user_id, title, message, type, related_id, created_at)
        VALUES (?, ?, ?, ?, ?, NOW())
      `, [
        admin.id,
        '✅ Order Confirmed & Inventory Updated',
        `Customer confirmed receipt of order containing ${productSummary}. Sales and inventory have been automatically updated.`,
        'admin_order',
        id
      ]);
    }

    // Send email receipt to customer
    try {
      // Get user details and complete order information for email
      const [userDetails] = await pool.query(`
        SELECT u.name, u.email, u.degree, u.section, o.total_amount, o.payment_method, o.created_at, o.status
        FROM users u
        JOIN orders o ON u.id = o.user_id
        WHERE o.id = ?
      `, [id]);

      if (userDetails.length > 0) {
        const user = userDetails[0];
        
        // Get order items with prices for email
        const [orderItemsWithPrices] = await pool.query(`
          SELECT oi.quantity, oi.unit_price, oi.total_price, p.name as product_name
          FROM order_items oi
          JOIN products p ON oi.product_id = p.id
          WHERE oi.order_id = ?
        `, [id]);

        const orderData = {
          orderId: id,
          items: orderItemsWithPrices,
          totalAmount: user.total_amount,
          paymentMethod: user.payment_method,
          createdAt: user.created_at,
          status: 'completed',
          userName: user.name,
          degree: user.degree,
          section: user.section
        };

        const emailResult = await sendOrderReceiptEmail(user.email, user.name, orderData);
        if (emailResult.success) {
          console.log(`Email receipt sent to ${user.email} for order #${id}`);
        } else {
          console.log(`Email receipt not sent for order #${id}: ${emailResult.message}`);
        }
      }
    } catch (emailError) {
      console.error('Error sending email receipt:', emailError);
      // Don't fail the entire operation if email fails
    }

    res.json({ 
      success: true,
      message: 'Order receipt confirmed successfully',
      status: 'completed'
    })

  } catch (err) {
    console.error('User confirm order receipt error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}

// ✅ Confirm order receipt via notification
// 🧪 Test notification endpoint (for debugging)
export const testNotification = async (req, res) => {
  const { userId, orderId, status } = req.body;
  
  try {
    console.log(`🧪 Testing notification for user ${userId}, order ${orderId}, status: ${status}`);
    
    // Create notification
    const notificationResult = await createOrderStatusNotification(userId, orderId, status);
    console.log(`🧪 Notification created:`, notificationResult);
    
    // Emit real-time notification
    const io = req.app.get('io');
    if (io && notificationResult) {
      console.log(`🧪 Emitting test notification to user ${userId}`);
      emitUserNotification(io, userId, {
        id: notificationResult.id,
        title: notificationResult.title,
        message: notificationResult.message,
        type: notificationResult.type,
        orderId: orderId,
        status: status,
        read: false,
        timestamp: new Date().toISOString(),
        priority: status === 'ready_for_pickup' ? 'high' : 'medium',
        hasAction: notificationResult.hasAction,
        actionData: notificationResult.actionData
      });
    }
    
    res.json({
      success: true,
      message: 'Test notification sent',
      notification: notificationResult,
      socketEmitted: !!io
    });
  } catch (error) {
    console.error('🧪 Test notification error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send test notification',
      details: error.message
    });
  }
};

// ✅ Confirm order receipt via notification
export const confirmOrderReceiptNotification = async (req, res) => {
  const { orderId } = req.params
  const user_id = req.user.id

  try {
    // Get order details and verify ownership
    const [orderData] = await pool.query(`
      SELECT o.id, o.user_id, o.status, o.total_amount, o.payment_method, o.created_at, u.name, u.email
      FROM orders o
      JOIN users u ON o.user_id = u.id
      WHERE o.id = ? AND o.user_id = ?
    `, [orderId, user_id])

    if (orderData.length === 0) {
      return res.status(404).json({ error: 'Order not found or access denied' })
    }

    const order = orderData[0]

    if (order.status !== 'ready_for_pickup') {
      return res.status(400).json({ 
        error: 'Order must be ready for pickup to confirm receipt' 
      })
    }

    // Update order status to completed
    await pool.query(
      'UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?',
      ['completed', orderId]
    )

    // Get order items for notification
    const [orderItems] = await pool.query(`
      SELECT oi.product_name, oi.quantity
      FROM order_items oi
      WHERE oi.order_id = ?
    `, [orderId])

    // Create thank you notification for user
    const productSummary = orderItems.length === 1 
      ? `${orderItems[0].quantity}x ${orderItems[0].product_name}`
      : `${orderItems.length} items`

    const [notificationResult] = await pool.query(`
      INSERT INTO notifications (user_id, title, message, type, created_at)
      VALUES (?, ?, ?, ?, NOW())
    `, [
      user_id,
      '🎉 Order Confirmed!',
      `Thank you for confirming receipt! Your order for ${productSummary} has been completed. A receipt has been sent to your email.`,
      'system'
    ])

    // Emit real-time notification
    const io = req.app.get('io')
    if (io) {
      emitUserNotification(io, user_id, {
        id: notificationResult.insertId,
        title: '🎉 Order Confirmed!',
        message: `Thank you for confirming receipt! Your order for ${productSummary} has been completed. A receipt has been sent to your email.`,
        type: 'system',
        orderId: orderId,
        status: 'completed',
        read: false,
        timestamp: new Date().toISOString(),
        priority: 'high'
      })
    }

    // Mark the ready_for_pickup notification as read/handled
    await pool.query(`
      UPDATE notifications 
      SET is_read = 1 
      WHERE user_id = ? AND related_id = ? AND type = 'system'
    `, [user_id, orderId])

    res.json({ 
      success: true,
      message: 'Order confirmed successfully! Receipt sent to your email.',
      orderId: orderId
    })

  } catch (err) {
    console.error('Confirm order receipt via notification error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}

// ✅ Get Sales Analytics with Profit Analysis
export const getSalesAnalytics = async (req, res) => {
  try {
    const { startDate, endDate, groupBy = 'day' } = req.query;
    
    // Build date filter
    let dateFilter = '';
    let params = [];
    
    if (startDate && endDate) {
      dateFilter = 'WHERE o.created_at BETWEEN ? AND ?';
      params = [startDate, endDate];
    }

    // Get sales data with profit analysis
    const [salesData] = await pool.query(`
      SELECT 
        DATE(o.created_at) as date,
        COUNT(DISTINCT o.id) as total_orders,
        SUM(o.total_amount) as total_revenue,
        SUM(oi.quantity * oi.unit_cost) as total_cost,
        SUM(o.total_amount) - SUM(oi.quantity * oi.unit_cost) as total_profit,
        ROUND(((SUM(o.total_amount) - SUM(oi.quantity * oi.unit_cost)) / SUM(o.total_amount)) * 100, 2) as profit_margin_percent
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      ${dateFilter}
      AND o.status IN ('completed', 'claimed')
      GROUP BY DATE(o.created_at)
      ORDER BY date DESC
      LIMIT 30
    `, params);

    // Get top products by profit
    const [topProducts] = await pool.query(`
      SELECT 
        p.name as product_name,
        SUM(oi.quantity) as total_quantity_sold,
        SUM(oi.quantity * oi.unit_price) as total_revenue,
        SUM(oi.quantity * oi.unit_cost) as total_cost,
        SUM(oi.quantity * oi.unit_price) - SUM(oi.quantity * oi.unit_cost) as total_profit,
        ROUND(((SUM(oi.quantity * oi.unit_price) - SUM(oi.quantity * oi.unit_cost)) / SUM(oi.quantity * oi.unit_price)) * 100, 2) as profit_margin_percent
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      JOIN orders o ON oi.order_id = o.id
      ${dateFilter}
      AND o.status IN ('completed', 'claimed')
      GROUP BY p.id, p.name
      ORDER BY total_profit DESC
      LIMIT 10
    `, params);

    // Get overall summary
    const [summary] = await pool.query(`
      SELECT 
        COUNT(DISTINCT o.id) as total_orders,
        SUM(o.total_amount) as total_revenue,
        SUM(oi.quantity * oi.unit_cost) as total_cost,
        SUM(o.total_amount) - SUM(oi.quantity * oi.unit_cost) as total_profit,
        ROUND(((SUM(o.total_amount) - SUM(oi.quantity * oi.unit_cost)) / SUM(o.total_amount)) * 100, 2) as overall_profit_margin
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      ${dateFilter}
      AND o.status IN ('completed', 'claimed')
    `, params);

    res.json({
      salesData,
      topProducts,
      summary: summary[0] || {
        total_orders: 0,
        total_revenue: 0,
        total_cost: 0,
        total_profit: 0,
        overall_profit_margin: 0
      }
    });

  } catch (error) {
    console.error('Sales analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch sales analytics' });
  }
}

// ✅ Admin updates order payment method
export const updateOrderPaymentMethod = async (req, res) => {
  const { id } = req.params;
  const { payment_method, payment_status, notes } = req.body;

  // Validate payment method
  const validPaymentMethods = ['cash', 'gcash'];
  if (!validPaymentMethods.includes(payment_method)) {
    return res.status(400).json({ 
      error: 'Invalid payment method',
      validPaymentMethods: validPaymentMethods
    });
  }

  // Validate payment status if provided
  const validPaymentStatuses = ['unpaid', 'pending', 'paid', 'cancelled', 'refunded'];
  if (payment_status && !validPaymentStatuses.includes(payment_status)) {
    return res.status(400).json({ 
      error: 'Invalid payment status',
      validPaymentStatuses: validPaymentStatuses
    });
  }

  try {
    // Get current order details
    const [currentOrder] = await pool.query(
      'SELECT payment_method, payment_status, user_id, total_amount FROM orders WHERE id = ?',
      [id]
    );

    if (currentOrder.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const oldPaymentMethod = currentOrder[0].payment_method;
    const oldPaymentStatus = currentOrder[0].payment_status;
    const userId = currentOrder[0].user_id;
    const totalAmount = currentOrder[0].total_amount;

    // Start transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Update payment method and status
      const updateFields = ['payment_method = ?'];
      const updateValues = [payment_method];

      if (payment_status) {
        updateFields.push('payment_status = ?');
        updateValues.push(payment_status);
      }

      updateFields.push('updated_at = NOW()');
      updateValues.push(id);

      await connection.query(
        `UPDATE orders SET ${updateFields.join(', ')} WHERE id = ?`,
        updateValues
      );

      // Log payment method change
      await connection.query(`
        INSERT INTO order_status_logs (order_id, old_status, new_status, notes, admin_id, created_at)
        VALUES (?, ?, ?, ?, ?, NOW())
      `, [
        id, 
        `payment_method:${oldPaymentMethod}`, 
        `payment_method:${payment_method}`, 
        notes || `Payment method changed from ${oldPaymentMethod} to ${payment_method}`,
        req.user.id
      ]);

      // If payment status was updated, log that too
      if (payment_status && payment_status !== oldPaymentStatus) {
        await connection.query(`
          INSERT INTO order_status_logs (order_id, old_status, new_status, notes, admin_id, created_at)
          VALUES (?, ?, ?, ?, ?, NOW())
        `, [
          id, 
          `payment_status:${oldPaymentStatus}`, 
          `payment_status:${payment_status}`, 
          notes || `Payment status changed from ${oldPaymentStatus} to ${payment_status}`,
          req.user.id
        ]);
      }

      // Create payment transaction record if payment method changed
      if (payment_method !== oldPaymentMethod) {
        await connection.query(`
          INSERT INTO payment_transactions (
            order_id, 
            transaction_id, 
            amount, 
            payment_method, 
            status, 
            gateway_response,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, NOW())
        `, [
          id,
          `admin_update_${id}_${Date.now()}`,
          totalAmount,
          payment_method,
          payment_status || oldPaymentStatus,
          JSON.stringify({ 
            admin_updated: true, 
            previous_method: oldPaymentMethod,
            reason: 'Admin updated payment method',
            updated_at: new Date().toISOString()
          })
        ]);
      }

      await connection.commit();
      connection.release();

      // Create notification for user about payment method change
      try {
        await pool.query(`
          INSERT INTO notifications (user_id, title, message, type, related_id, created_at)
          VALUES (?, ?, ?, ?, ?, NOW())
        `, [
          userId,
          '💳 Payment Method Updated',
          `Your order #${id} payment method has been updated to ${payment_method.toUpperCase()}${payment_status ? ` with status: ${payment_status.toUpperCase()}` : ''}.`,
          'system',
          id
        ]);

        // Emit real-time notification to user
        const io = req.app.get('io');
        if (io) {
          emitUserNotification(io, userId, {
            title: '💳 Payment Method Updated',
            message: `Your order #${id} payment method has been updated to ${payment_method.toUpperCase()}${payment_status ? ` with status: ${payment_status.toUpperCase()}` : ''}.`,
            type: 'system',
            orderId: id,
            read: false,
            timestamp: new Date().toISOString()
          });
        }
      } catch (notificationError) {
        console.error('Error creating payment method change notification:', notificationError);
        // Don't fail the operation if notification fails
      }

      // Emit real-time updates
      const io = req.app.get('io');
      if (io) {
        emitAdminDataRefresh(io, 'orders', { 
          action: 'payment_updated', 
          orderId: id, 
          paymentMethod: payment_method,
          paymentStatus: payment_status || oldPaymentStatus
        });
        emitUserDataRefresh(io, userId, 'orders', { 
          action: 'payment_updated', 
          orderId: id 
        });
      }

      res.json({ 
        message: `Order payment method updated successfully`,
        previousPaymentMethod: oldPaymentMethod,
        newPaymentMethod: payment_method,
        previousPaymentStatus: oldPaymentStatus,
        newPaymentStatus: payment_status || oldPaymentStatus,
        orderId: id
      });

    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }

  } catch (err) {
    console.error('Update payment method error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ✅ Confirm Order Receipt (Public endpoint for email button)
export const confirmOrderReceiptPublic = async (req, res) => {
  try {
    const { orderId } = req.params;
    
    if (!orderId) {
      return res.status(400).json({ error: 'Order ID is required' });
    }

    // Get order details
    const [orders] = await pool.query(
      'SELECT id, user_id, status FROM orders WHERE id = ?',
      [orderId]
    );

    if (orders.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = orders[0];

    // Check if order is ready for pickup
    if (order.status !== 'ready_for_pickup') {
      return res.status(400).json({ 
        error: 'Order is not ready for pickup',
        currentStatus: order.status 
      });
    }

    // Update order status to completed
    await pool.query(
      'UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?',
      ['completed', orderId]
    );

    // Log status change
    await pool.query(
      `INSERT INTO order_status_logs (order_id, old_status, new_status, notes, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [orderId, 'ready_for_pickup', 'completed', 'Order confirmed received by customer']
    );

    console.log(`✅ Order ${orderId} confirmed received and marked as completed`);

    // Redirect to dashboard with success message
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
    const redirectUrl = `${clientUrl}/dashboard?orderCompleted=true&orderId=${orderId}`;
    
    res.redirect(redirectUrl);

  } catch (error) {
    console.error('Confirm order receipt error:', error);
    res.status(500).json({ error: 'Failed to confirm order receipt' });
  }
}

// 🚫 User cancels their own order (only if not processing)
export const userCancelOrder = async (req, res) => {
  const { id } = req.params
  const userId = req.user.id

  try {
    // Get order details and verify ownership
    const [orderData] = await pool.query(
      'SELECT user_id, status, total_amount, payment_method, payment_status FROM orders WHERE id = ?',
      [id]
    )

    if (orderData.length === 0) {
      return res.status(404).json({ error: 'Order not found' })
    }

    if (orderData[0].user_id !== userId) {
      return res.status(403).json({ error: 'You can only cancel your own orders' })
    }

    const currentStatus = orderData[0].status
    const totalAmount = orderData[0].total_amount
    const paymentMethod = orderData[0].payment_method

    // Check if order can be cancelled (only if not processing or beyond)
    const cancellableStatuses = ['pending']
    if (!cancellableStatuses.includes(currentStatus)) {
      return res.status(400).json({ 
        error: 'Order cannot be cancelled',
        message: `Orders with status '${currentStatus}' cannot be cancelled. Only pending orders can be cancelled by users.`,
        currentStatus,
        cancellableStatuses
      })
    }

    // Update order status to cancelled
    const [result] = await pool.query(
      'UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?',
      ['cancelled', id]
    )

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Order not found' })
    }

    // Log status change
    await pool.query(`
      INSERT INTO order_status_logs (order_id, old_status, new_status, notes, created_at)
      VALUES (?, ?, ?, ?, NOW())
    `, [id, currentStatus, 'cancelled', 'Cancelled by user'])

    // Restore stock for cancelled order
    await restoreOrderStock(id)
    
    // Log sales reversal
    await logSalesMovement(id, 'reversal', totalAmount, paymentMethod, 'Order cancelled by user')

    // Create notification for user
    await createOrderStatusNotification(userId, id, 'cancelled')
    
    // Create admin notification
    await createCancelledOrderNotification(id, userId)

    // Emit real-time notification to user
    const io = req.app.get('io')
    if (io) {
      emitOrderUpdate(io, userId, {
        orderId: id,
        status: 'cancelled',
        previousStatus: currentStatus,
        timestamp: new Date().toISOString()
      })
      
      // Emit data refresh signals
      emitAdminDataRefresh(io, 'orders', { action: 'updated', orderId: id, status: 'cancelled' });
      emitUserDataRefresh(io, userId, 'orders', { action: 'updated', orderId: id, status: 'cancelled' });
    }

    res.json({ 
      success: true,
      message: 'Order cancelled successfully',
      previousStatus: currentStatus,
      newStatus: 'cancelled',
      inventoryUpdated: true,
      salesLogged: true
    })

  } catch (err) {
    console.error('User cancel order error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}

