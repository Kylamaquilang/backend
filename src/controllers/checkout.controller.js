import { pool } from '../database/db.js'
import { createOrderStatusNotification, createAdminOrderNotification } from '../utils/notification-helper.js'
import { emitUserNotification, emitAdminNotification, emitInventoryUpdate, emitNewOrder, emitDataRefresh, emitAdminDataRefresh, emitUserDataRefresh, emitCartUpdate } from '../utils/socket-helper.js'


export const checkout = async (req, res) => {
  // Validate user authentication
  if (!req.user || !req.user.id) {
    console.error('❌ Checkout - No user found in request');
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'Please log in to complete checkout'
    });
  }

  const user_id = req.user.id
  const { payment_method, pay_at_counter, cart_item_ids, products } = req.body
  const io = req.app.get('io');

  console.log('🛒 Checkout request:', { user_id, payment_method, pay_at_counter, cart_item_ids, products });
  console.log('🛒 Checkout request user:', req.user);
  console.log('🛒 Checkout request headers:', req.headers);

  if (!payment_method) {
    return res.status(400).json({ 
      error: 'Payment method required',
      message: 'Please select a payment method'
    })
  }

  // Validate user exists in database
  try {
    const [userCheck] = await pool.query('SELECT id FROM users WHERE id = ?', [user_id]);
    if (userCheck.length === 0) {
      console.error(`❌ User ${user_id} not found in database`);
      return res.status(404).json({ 
        error: 'User not found',
        message: 'Your account was not found. Please log in again.'
      });
    }
  } catch (userCheckError) {
    console.error('❌ Error checking user existence:', userCheckError);
    return res.status(500).json({ 
      error: 'Database error',
      message: 'Unable to verify your account. Please try again.'
    });
  }

  try {
    let cartItems;
    
    // Check if we're processing direct products (BUY NOW flow) or cart items
    if (products && products.length > 0) {
      // Process direct products (BUY NOW flow)
      cartItems = [];
      for (const product of products) {
        console.log('🔍 Processing product for checkout:', product);
        
        // If product_id is missing but size_id is present, look up the product_id
        let product_id = product.product_id;
        if (!product_id && product.size_id) {
          console.log('🔍 Missing product_id, looking up from size_id:', product.size_id);
          const [sizeLookup] = await pool.query(`
            SELECT product_id FROM product_sizes WHERE id = ? AND is_active = 1
          `, [product.size_id]);
          
          if (sizeLookup.length > 0) {
            product_id = sizeLookup[0].product_id;
            console.log('🔍 Found product_id from size:', product_id);
          }
        }
        
        const [productData] = await pool.query(`
          SELECT p.id as product_id, p.stock, p.price, ps.id as size_id, ps.stock as size_stock, ps.price as size_price, ps.size as size_name
          FROM products p
          LEFT JOIN product_sizes ps ON p.id = ps.product_id AND ps.id = ?
          WHERE p.id = ? AND p.is_active = 1
        `, [product.size_id || null, product_id]);
        
        console.log('🔍 Product query result:', productData);
        
        if (productData.length === 0) {
          console.log('❌ Product not found in checkout:', product);
          return res.status(404).json({ 
            error: 'Product not found',
            message: `Product ID ${product_id} not found or is inactive`
          });
        }
        
        const item = productData[0];
        
        // Validate that we have a valid price
        const price = parseFloat(item.size_id ? (item.size_price || item.price) : (item.price || 0));
        if (!price || isNaN(price) || price <= 0) {
          return res.status(400).json({ 
            error: 'Invalid price',
            message: `Invalid price for product ID ${product.product_id}${product.size_id ? ` with size ID ${product.size_id}` : ''}. Price: ${price}`
          });
        }
        
        // Validate quantity
        const quantity = parseInt(product.quantity) || 0;
        if (quantity <= 0) {
          return res.status(400).json({ 
            error: 'Invalid quantity',
            message: `Invalid quantity for product ID ${product_id}. Quantity must be greater than 0.`
          });
        }
        
        cartItems.push({
          cart_id: null, // No cart ID for direct products
          quantity: quantity,
          product_id: item.product_id,
          size_id: product.size_id || null,
          size_name: item.size_name || null,
          stock: item.size_id ? (item.size_stock || 0) : (item.stock || 0),
          price: price,
          size_price: parseFloat(item.size_price || 0)
        });
      }
    } else if (cart_item_ids && cart_item_ids.length > 0) {
      // Process only selected cart items
      const placeholders = cart_item_ids.map(() => '?').join(',');
      [cartItems] = await pool.query(`
        SELECT c.id AS cart_id, c.quantity, c.product_id, c.size,
               p.stock, p.price, ps.id as size_id, ps.stock as size_stock, ps.price as size_price, ps.size as size_name
        FROM cart_items c
        JOIN products p ON c.product_id = p.id AND p.is_active = 1
        LEFT JOIN product_sizes ps ON c.product_id = ps.product_id 
          AND ps.is_active = 1
          AND (c.size IS NULL OR c.size = '' OR UPPER(TRIM(c.size)) = UPPER(TRIM(ps.size)))
        WHERE c.user_id = ? AND c.id IN (${placeholders})
      `, [user_id, ...cart_item_ids])
    } else {
      // Fallback: process all cart items
      [cartItems] = await pool.query(`
        SELECT c.id AS cart_id, c.quantity, c.product_id, c.size,
               p.stock, p.price, ps.id as size_id, ps.stock as size_stock, ps.price as size_price, ps.size as size_name
        FROM cart_items c
        JOIN products p ON c.product_id = p.id AND p.is_active = 1
        LEFT JOIN product_sizes ps ON c.product_id = ps.product_id 
          AND ps.is_active = 1
          AND (c.size IS NULL OR c.size = '' OR UPPER(TRIM(c.size)) = UPPER(TRIM(ps.size)))
        WHERE c.user_id = ?
      `, [user_id])
    }

    // Convert prices to numbers for all cart items
    cartItems = cartItems.map(item => ({
      ...item,
      price: parseFloat(item.price || 0),
      size_price: parseFloat(item.size_price || 0)
    }));

    if (cartItems.length === 0) {
      return res.status(400).json({ 
        error: 'Empty cart',
        message: 'Your cart is empty. Please add items before checkout.'
      })
    }

    // Validate stock availability for all items
    for (const item of cartItems) {
      // Check stock based on whether it's a size-specific item or general product
      const availableStock = item.size_id ? item.size_stock : item.stock
      console.log(`🔍 Stock validation: Product ID ${item.product_id}, Size ID ${item.size_id || 'N/A'}, Available: ${availableStock}, Requested: ${item.quantity}`);
      
      if (item.quantity > availableStock) {
        return res.status(400).json({
          error: 'Insufficient stock',
          message: `Insufficient stock for product ID ${item.product_id}. Available: ${availableStock}, Requested: ${item.quantity}`
        })
      }
    }

    console.log('🔍 Cart items after processing:', cartItems.map(item => ({
      product_id: item.product_id,
      size_id: item.size_id,
      size_name: item.size_name,
      quantity: item.quantity,
      price: item.price,
      size_price: item.size_price,
      calculated_price: item.size_id ? item.size_price : item.price
    })));

    const total_amount = cartItems.reduce((sum, item) => {
      const price = parseFloat(item.size_id ? (item.size_price || item.price) : (item.price || 0));
      const quantity = parseInt(item.quantity) || 0;
      const itemTotal = price * quantity;
      
      console.log(`💰 Price calculation: Product ${item.product_id}, Size ${item.size_id}, Price ${price}, Quantity ${quantity}, Total ${itemTotal}`);
      
      if (isNaN(price) || price <= 0) {
        throw new Error(`Invalid price for product ID ${item.product_id}: price=${price}`);
      }
      
      if (isNaN(quantity) || quantity <= 0) {
        throw new Error(`Invalid quantity for product ID ${item.product_id}: quantity=${quantity}`);
      }
      
      if (isNaN(itemTotal) || itemTotal <= 0) {
        throw new Error(`Invalid price calculation for product ID ${item.product_id}: price=${price}, quantity=${quantity}, total=${itemTotal}`);
      }
      
      return sum + itemTotal;
    }, 0)

    console.log('💰 Total amount calculated:', total_amount);

    // Validate total amount
    if (isNaN(total_amount) || total_amount <= 0) {
      return res.status(400).json({ 
        error: 'Invalid total amount',
        message: 'Unable to calculate order total. Please check product prices.'
      })
    }

    // Generate unique order number
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    const [existingOrders] = await pool.query(`
      SELECT COUNT(*) as count FROM orders WHERE order_number LIKE ?
    `, [`ORD${dateStr}%`]);
    
    const orderNumber = `ORD${dateStr}${String(existingOrders[0].count + 1).padStart(4, '0')}`;

    // Start database transaction to ensure atomicity
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    let orderId; // Declare orderId outside the try block

    try {
      // Create order
      const [orderResult] = await connection.query(`
        INSERT INTO orders (user_id, order_number, total_amount, payment_method, payment_status, status, pay_at_counter)
        VALUES (?, ?, ?, ?, 'pending', 'pending', ?)
      `, [user_id, orderNumber, total_amount, payment_method, pay_at_counter || false])

      orderId = orderResult.insertId

      // Process each item in the order
      for (const item of cartItems) {
        // Get product name
        const [productInfo] = await connection.query(`SELECT name FROM products WHERE id = ?`, [item.product_id]);
        const productName = productInfo[0]?.name || 'Unknown Product';
        
        // Get product cost price
        const [productData] = await connection.query(
          `SELECT original_price FROM products WHERE id = ?`,
          [item.product_id]
        );
        const costPrice = productData[0]?.original_price || 0;

        // Get size name from cart item (already fetched from product_sizes table)
        const sizeName = item.size_name || null;
        
        // IMPORTANT: Capture the price at transaction time
        // This price is stored in order_items.unit_price and will NOT change even if the product price is updated later.
        // This ensures historical sales records maintain the price at the time of purchase.
        const transactionPrice = parseFloat(item.size_price || item.price || 0);
        
        // Validate transaction price
        if (!transactionPrice || isNaN(transactionPrice) || transactionPrice <= 0) {
          await connection.rollback();
          connection.release();
          return res.status(400).json({ 
            error: 'Invalid product price',
            message: `Invalid price for product "${productName}". Please contact support.`
          });
        }
        
        const transactionTotal = transactionPrice * item.quantity;
        
        // Validate transaction total
        if (isNaN(transactionTotal) || transactionTotal <= 0) {
          await connection.rollback();
          connection.release();
          return res.status(400).json({ 
            error: 'Invalid order total',
            message: `Invalid total for product "${productName}". Please contact support.`
          });
        }
        
        console.log(`📦 Creating order item:`);
        console.log(`   - Product: "${productName}"`);
        console.log(`   - Size Name: "${sizeName || 'NULL'}"`);
        console.log(`   - Size ID: ${item.size_id || 'NULL'}`);
        console.log(`   - Quantity: ${item.quantity}`);
        console.log(`   - Transaction Price (stored): ${transactionPrice}`);
        console.log(`   - Transaction Total: ${transactionTotal}`);
        console.log(`   - Item object:`, JSON.stringify(item, null, 2));

        // Insert order item with size name
        // NOTE: unit_price stores the price at the time of transaction, not the current product price
        const insertResult = await connection.query(
          `INSERT INTO order_items (order_id, product_id, size_id, size, product_name, quantity, unit_price, unit_cost, total_price)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [orderId, item.product_id, item.size_id || null, sizeName, productName, item.quantity, transactionPrice, costPrice, transactionTotal]
        )
        
        // Verify what was actually saved
        const [savedItem] = await connection.query(
          `SELECT id, product_name, size, size_id, quantity FROM order_items WHERE id = ?`,
          [insertResult[0].insertId]
        );
        console.log(`✅ Order item saved to database:`, savedItem[0])

        // Process stock deduction directly (optimized for speed)
        console.log(`📦 Processing stock deduction for Product ID ${item.product_id}, Quantity ${item.quantity}`);
        
        if (item.size_id) {
          // Deduct from size-specific stock
          await connection.query(
            `UPDATE product_sizes SET stock = stock - ? WHERE id = ? AND stock >= ?`,
            [item.quantity, item.size_id, item.quantity]
          );
        } else {
          // Deduct from general product stock
          await connection.query(
            `UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?`,
            [item.quantity, item.product_id, item.quantity]
          );
        }
        
        console.log(`✅ Stock deduction completed for Product ID ${item.product_id}`)
      }

      // Only delete cart items if we processed cart items (not direct products)
      if (products && products.length > 0) {
        // For direct products (BUY NOW), don't delete cart items since they weren't in cart
        console.log('Direct product checkout - no cart items to delete');
      } else if (cart_item_ids && cart_item_ids.length > 0) {
        // Delete only the selected cart items
        const placeholders = cart_item_ids.map(() => '?').join(',');
        await connection.query(`DELETE FROM cart_items WHERE user_id = ? AND id IN (${placeholders})`, [user_id, ...cart_item_ids])
      } else {
        // Fallback: delete all cart items (for backward compatibility)
        await connection.query(`DELETE FROM cart_items WHERE user_id = ?`, [user_id])
      }

      // Commit the transaction
      await connection.commit();
      
    } catch (error) {
      // Rollback the transaction on error
      console.error('❌ Checkout transaction error:', error);
      await connection.rollback();
      throw error;
    } finally {
      // Release the connection
      connection.release();
    }

    console.log('✅ Transaction completed successfully, orderId:', orderId);

    // Emit inventory updates and new order to admin
    try {
      if (io) {
        // Emit inventory updates for each product
        for (const item of cartItems) {
          try {
            // Get product name for the inventory update
            const [productInfo] = await pool.query(`SELECT name FROM products WHERE id = ?`, [item.product_id]);
            const productName = productInfo[0]?.name || 'Unknown Product';
            
            emitInventoryUpdate(io, {
              productId: item.product_id,
              productName: productName,
              quantityChange: -item.quantity,
              movementType: 'sale',
              reason: 'Order placed',
              orderId: orderId
            });
          } catch (itemError) {
            console.error(`❌ Error emitting inventory update for product ${item.product_id}:`, itemError);
            // Continue with other items even if one fails
          }
        }
        
        // Emit new order event
        try {
          emitNewOrder(io, {
            orderId: orderId,
            userId: user_id,
            totalAmount: total_amount,
            paymentMethod: payment_method,
            itemCount: cartItems.length,
            timestamp: new Date().toISOString()
          });
        } catch (orderEmitError) {
          console.error('❌ Error emitting new order event:', orderEmitError);
        }
        
        console.log('📡 Real-time inventory updates and new order sent to admin');
      }
    } catch (socketError) {
      console.error('❌ Error emitting inventory updates:', socketError);
      // Don't fail the checkout if socket emission fails
    }

    // Create user notification for order placed
    try {
      console.log('📧 Creating user notification...');
      const userNotification = await createOrderStatusNotification(user_id, orderId, 'pending');
      console.log('✅ User notification created');
      
      // Emit real-time notification to user
      if (io) {
        emitUserNotification(io, user_id, {
          title: userNotification.title,
          message: userNotification.message,
          type: 'system',
          orderId: orderId,
          status: 'pending',
          read: false
        });
        console.log('📡 Real-time user notification sent');
      }
    } catch (notificationError) {
      console.error('❌ Error creating user notification:', notificationError);
      // Don't fail the checkout if notification fails
    }

    // Create admin notifications for new order (outside transaction)
    try {
      console.log('📧 Creating admin notification...');
      const adminNotification = await createAdminOrderNotification(orderId, total_amount, payment_method);
      console.log('✅ Admin notification created');
      
      // Emit real-time notification to admin
      if (io) {
        emitAdminNotification(io, {
          title: adminNotification.title,
          message: adminNotification.message,
          type: 'admin_order',
          orderId: orderId,
          customerName: adminNotification.customerName,
          studentId: adminNotification.studentId,
          totalAmount: adminNotification.totalAmount,
          paymentMethod: adminNotification.paymentMethod,
          paymentStatus: adminNotification.paymentStatus,
          read: false
        });
        console.log('📡 Real-time admin notification sent');
      }
    } catch (notificationError) {
      console.error('❌ Error creating admin notification:', notificationError);
      // Don't fail the checkout if notification fails
    }

    // Emit refresh signals (wrapped in try-catch to prevent checkout failure)
    if (io) {
      try {
      emitDataRefresh(io, 'orders', { action: 'created', orderId });
      emitAdminDataRefresh(io, 'orders', { action: 'created', orderId });
      emitUserDataRefresh(io, user_id, 'orders', { action: 'created', orderId });
      emitDataRefresh(io, 'cart', { action: 'cleared' });
      emitUserDataRefresh(io, user_id, 'cart', { action: 'cleared' });
      
      // Also emit direct cart-updated event for immediate UI update
      emitCartUpdate(io, user_id, {
        action: 'cleared',
        timestamp: new Date().toISOString()
      });
      } catch (socketError) {
        console.error('❌ Error emitting socket events (non-fatal):', socketError);
        // Don't fail checkout if socket emission fails
      }
    }

    console.log('🎉 Checkout completed successfully, sending response...');
    res.status(200).json({
      success: true,
      message: 'Checkout successful',
      orderId,
      total_amount,
      payment_method,
      payment_status: 'pending'
    })
  } catch (err) {
    console.error('❌ Checkout error:', err);
    console.error('❌ Error stack:', err.stack);
    console.error('❌ Error details:', {
      message: err.message,
      code: err.code,
      sqlState: err.sqlState,
      sqlMessage: err.sqlMessage
    });
    
    // Handle validation errors (400)
    if (err.message && (
      err.message.includes('Invalid price') || 
      err.message.includes('Invalid quantity') || 
      err.message.includes('Invalid total') ||
      err.message.includes('Insufficient stock')
    )) {
      return res.status(400).json({ 
        error: 'Validation error',
        message: err.message
      });
    }
    
    // Handle foreign key constraint errors
    if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.errno === 1452) {
      console.error('❌ Foreign key constraint error:', err.sqlMessage);
      if (err.sqlMessage && err.sqlMessage.includes('user_id')) {
        return res.status(404).json({ 
          error: 'User account error',
          message: 'Your account was not found. Please log out and log in again.'
        });
      }
      return res.status(400).json({ 
        error: 'Data integrity error',
        message: 'Unable to process order due to data inconsistency. Please contact support.'
      });
    }
    
    // Handle specific database errors
    if (err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(500).json({ 
        error: 'Database configuration error',
        message: 'Required tables not found. Please contact administrator.'
      });
    }
    
    if (err.code === 'ER_BAD_DB_ERROR') {
      return res.status(500).json({ 
        error: 'Database connection error',
        message: 'Unable to connect to database. Please try again.'
      });
    }
    
    res.status(500).json({ 
      error: 'Server error',
      message: 'Failed to process checkout. Please try again.',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    })
  }
}
