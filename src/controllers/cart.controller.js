import { pool } from '../database/db.js';
import { validateId, validateQuantity } from '../utils/validation.js';
import { ValidationError } from '../utils/errorHandler.js';
import { emitCartUpdate, emitDataRefresh, emitUserDataRefresh } from '../utils/socket-helper.js';

// ✅ Add to Cart
export const addToCart = async (req, res) => {
  const { product_id, quantity, size_id } = req.body;
  
  console.log('🛒 Add to cart request body:', req.body);
  console.log('🛒 Add to cart request user:', req.user);
  console.log('🛒 Add to cart request headers:', req.headers);
  
  if (!req.user || !req.user.id) {
    console.log('❌ Authentication failed - no user found');
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'Please log in to add items to cart'
    });
  }
  
  const user_id = req.user.id;

  if (!product_id || quantity == null) {
    console.log('❌ Missing required fields:', { product_id, quantity });
    return res.status(400).json({ 
      error: 'Missing required fields',
      message: 'Product ID and quantity are required'
    });
  }

  try {
    // Validate input using new validation functions
    const validatedQuantity = validateQuantity(quantity);
    const validatedProductId = validateId(product_id);
    
    // Continue with validated values
    await processAddToCart(req, res, validatedProductId, validatedQuantity, size_id, user_id);
  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({ 
        error: error.message,
        field: error.field
      });
    }
    throw error;
  }
}

// Helper function to process add to cart
const processAddToCart = async (req, res, product_id, quantity, size_id, user_id) => {
  try {
    // Get product and size information
    let stockQuery, stockParams;
    
    if (size_id) {
      // Check specific size stock
      stockQuery = `
        SELECT ps.stock, ps.price, p.name, p.image 
        FROM product_sizes ps 
        JOIN products p ON ps.product_id = p.id 
        WHERE ps.id = ? AND ps.product_id = ? AND p.is_active = 1 AND ps.is_active = 1
      `;
      stockParams = [size_id, product_id];
    } else {
      // Check general product stock
      // Check if deleted_at column exists before using it
      let deletedAtCondition = '';
      try {
        const [columns] = await pool.query(`
          SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'deleted_at'
        `);
        if (columns.length > 0) {
          deletedAtCondition = 'AND deleted_at IS NULL';
        }
      } catch (err) {
        // Column doesn't exist yet, continue without the condition
      }
      stockQuery = `SELECT stock, price, name, image FROM products WHERE id = ? AND is_active = 1 ${deletedAtCondition}`;
      stockParams = [product_id];
    }

    const [stockRows] = await pool.query(stockQuery, stockParams);
    
    console.log('🔍 Stock query result:', stockRows);
    
    if (stockRows.length === 0) {
      console.log('❌ No stock rows found');
      return res.status(404).json({ 
        error: 'Product not found',
        message: 'The selected product or size is not available'
      });
    }

    const productInfo = stockRows[0];
    const availableStock = productInfo.stock;

    console.log('📦 Available stock:', availableStock, 'Requested quantity:', quantity);

    if (availableStock < quantity) {
      console.log('❌ Insufficient stock');
      return res.status(400).json({
        error: 'Insufficient stock',
        message: `Only ${availableStock} left in stock`
      });
    }

    // Get size name if size_id is provided
    let sizeName = null;
    if (size_id) {
      const [sizeRows] = await pool.query(
        `SELECT size FROM product_sizes WHERE id = ?`,
        [size_id]
      );
      if (sizeRows.length > 0) {
        sizeName = sizeRows[0].size;
      }
    }

    // Check if same product & size is already in cart
    const [existing] = await pool.query(
      `SELECT * FROM cart_items WHERE user_id = ? AND product_id = ? AND (size = ? OR (size IS NULL AND ? IS NULL))`,
      [user_id, product_id, sizeName || null, sizeName || null]
    );

    const currentQty = existing.length > 0 ? existing[0].quantity : 0;
    const newQty = currentQty + quantity;

    if (newQty > availableStock) {
      console.log('❌ New quantity exceeds available stock');
      return res.status(400).json({
        error: 'Out of Stock',
        message: `Selected size is out of stock or insufficient quantity`
      });
    }

    if (existing.length > 0) {
      await pool.query(
        `UPDATE cart_items SET quantity = ?, size = ? WHERE id = ?`,
        [newQty, sizeName, existing[0].id]
      );
      
      // Emit real-time cart update
      const io = req.app.get('io')
      if (io) {
        emitCartUpdate(io, user_id, {
          action: 'updated',
          productId: product_id,
          quantity: newQty,
          sizeId: size_id
        })
      }
      
      return res.json({ 
        success: true,
        message: 'Cart item quantity updated',
        action: 'updated'
      });
    }

    await pool.query(
      `INSERT INTO cart_items (user_id, product_id, size, quantity) VALUES (?, ?, ?, ?)`,
      [user_id, product_id, sizeName, quantity]
    );

    // Emit real-time cart update
    const io = req.app.get('io')
    if (io) {
      emitCartUpdate(io, user_id, {
        action: 'added',
        productId: product_id,
        quantity,
        sizeId: size_id
      })
    }

    // Emit refresh signals
    if (io) {
      emitDataRefresh(io, 'cart', { action: 'added', productId: product_id });
      emitUserDataRefresh(io, user_id, 'cart', { action: 'added', productId: product_id });
    }

    res.status(201).json({ 
      success: true,
      message: 'Product added to cart successfully',
      action: 'added'
    });
  } catch (err) {
    console.error('❌ Add to cart error:', err);
    console.error('❌ Add to cart error stack:', err.stack);
    console.error('❌ Add to cart error details:', {
      message: err.message,
      code: err.code,
      sqlState: err.sqlState,
      sqlMessage: err.sqlMessage
    });
    
    // Handle specific database errors
    if (err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(500).json({ 
        error: 'Database configuration error',
        message: 'Cart table not found. Please contact administrator.'
      });
    }
    
    if (err.code === 'ER_BAD_DB_ERROR' || err.code === 'ECONNREFUSED') {
      return res.status(500).json({ 
        error: 'Database connection error',
        message: 'Unable to connect to database. Please try again.'
      });
    }
    
    // Handle validation errors
    if (err.message && (
      err.message.includes('Invalid') || 
      err.message.includes('Missing') ||
      err.message.includes('required')
    )) {
      return res.status(400).json({ 
        error: 'Validation error',
        message: err.message
      });
    }
    
    res.status(500).json({ 
      error: 'Server error',
      message: 'Failed to add item to cart. Please try again.',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ✅ View Cart
export const getCart = async (req, res) => {
  try {
    if (!req.user) {
      console.error('❌ getCart - req.user is undefined');
      return res.status(401).json({ 
        success: false,
        message: 'Unauthorized - user missing' 
      });
    }

    const user_id = req.user.id;
    const [items] = await pool.query(`
      SELECT 
        c.id, 
        c.quantity, 
        c.product_id,
        c.size,
        p.name as product_name, 
        p.image as product_image,
        p.price as product_price,
        p.stock as product_stock,
        ps.id as size_id,
        ps.price as size_price,
        ps.stock as size_stock,
        COALESCE(ps.price, p.price) as final_price,
        CASE 
          WHEN ps.id IS NOT NULL AND ps.stock IS NOT NULL THEN ps.stock
          WHEN c.size IS NULL OR c.size = '' THEN p.stock
          ELSE p.stock
        END as available_stock
      FROM cart_items c
        JOIN products p ON c.product_id = p.id AND p.is_active = 1
      LEFT JOIN product_sizes ps ON c.product_id = ps.product_id 
        AND ps.is_active = 1
        AND (
          (c.size IS NOT NULL AND c.size != '' AND UPPER(TRIM(c.size)) = UPPER(TRIM(ps.size)))
          OR (c.size IS NULL OR c.size = '') AND (ps.size IS NULL OR ps.size = 'NONE')
        )
      WHERE c.user_id = ?
    `, [user_id]);

    // Transform the data to match frontend expectations
    const transformedItems = items.map(item => ({
      id: item.id,
      quantity: item.quantity,
      product_id: item.product_id,
      size_id: item.size_id,
      product_name: item.product_name,
      product_image: item.product_image,
      size: item.size,
      price: item.final_price,
      available_stock: item.available_stock || 0
    }));

    res.json({ 
      success: true,
      items: transformedItems,
      total_items: transformedItems.length
    });
  } catch (err) {
    console.error('Get cart error:', err);
    res.status(500).json({ 
      error: 'Server error',
      message: 'Failed to load cart. Please try again.'
    });
  }
};

// ✅ Update Cart Item
export const updateCart = async (req, res) => {
  const { id } = req.params;
  const { quantity, size_id } = req.body;

  if (quantity == null || quantity < 1) {
    return res.status(400).json({ 
      error: 'Invalid quantity',
      message: 'Quantity must be at least 1'
    });
  }

  try {
    const [cartRows] = await pool.query(`SELECT * FROM cart_items WHERE id = ?`, [id]);
    if (cartRows.length === 0) {
      return res.status(404).json({ 
        error: 'Cart item not found',
        message: 'The cart item you are trying to update does not exist'
      });
    }

    const cartItem = cartRows[0];
    const product_id = cartItem.product_id;

    // Check stock availability
    let stockQuery, stockParams;
    
    if (size_id) {
      stockQuery = 'SELECT stock FROM product_sizes WHERE id = ? AND product_id = ?';
      stockParams = [size_id, product_id];
    } else {
      stockQuery = 'SELECT stock FROM products WHERE id = ?';
      stockParams = [product_id];
    }

    const [stockRows] = await pool.query(stockQuery, stockParams);
    if (stockRows.length === 0) {
      return res.status(404).json({ 
        error: 'Product not found',
        message: 'The selected product or size is not available'
      });
    }

    const availableStock = stockRows[0].stock;

    if (quantity > availableStock) {
      return res.status(400).json({ 
        error: 'Insufficient stock',
        message: `Only ${availableStock} in stock`
      });
    }

    // Get size name if size_id is provided
    let sizeName = null;
    if (size_id) {
      const [sizeRows] = await pool.query(
        `SELECT size FROM product_sizes WHERE id = ?`,
        [size_id]
      );
      if (sizeRows.length > 0) {
        sizeName = sizeRows[0].size;
      }
    }

    await pool.query(
      `UPDATE cart_items SET quantity = ?, size = ? WHERE id = ?`,
      [quantity, sizeName, id]
    );

    // Emit refresh signals
    const io = req.app.get('io');
    if (io) {
      emitDataRefresh(io, 'cart', { action: 'updated', cartItemId: id });
      emitUserDataRefresh(io, req.user.id, 'cart', { action: 'updated', cartItemId: id });
    }

    res.json({ 
      success: true,
      message: 'Cart item updated successfully'
    });
  } catch (err) {
    console.error('Update cart error:', err);
    res.status(500).json({ 
      error: 'Server error',
      message: 'Failed to update cart item. Please try again.'
    });
  }
};

// ✅ Delete Cart Item
export const deleteCartItem = async (req, res) => {
  const { id } = req.params;
  const user_id = req.user.id;

  try {
    // Get cart item details before deletion for Socket.io emission
    const [cartItem] = await pool.query(`
      SELECT product_id, size, quantity 
      FROM cart_items 
      WHERE id = ? AND user_id = ?
    `, [id, user_id]);

    if (cartItem.length === 0) {
      return res.status(404).json({ 
        error: 'Cart item not found',
        message: 'The cart item you are trying to remove does not exist'
      });
    }

    const [result] = await pool.query(`DELETE FROM cart_items WHERE id = ?`, [id]);

    // Emit real-time cart update
    const io = req.app.get('io')
    if (io) {
      // Get size_id from size if needed for socket emission
      let sizeId = null;
      if (cartItem[0].size) {
        const [sizeRows] = await pool.query(
          `SELECT id FROM product_sizes WHERE product_id = ? AND size = ?`,
          [cartItem[0].product_id, cartItem[0].size]
        );
        if (sizeRows.length > 0) {
          sizeId = sizeRows[0].id;
        }
      }

      emitCartUpdate(io, user_id, {
        action: 'removed',
        productId: cartItem[0].product_id,
        quantity: cartItem[0].quantity,
        sizeId: sizeId
      });
      emitDataRefresh(io, 'cart', { action: 'removed', cartItemId: id });
      emitUserDataRefresh(io, user_id, 'cart', { action: 'removed', cartItemId: id });
    }

    res.json({ 
      success: true,
      message: 'Cart item removed successfully'
    });
  } catch (err) {
    console.error('Delete cart error:', err);
    res.status(500).json({ 
      error: 'Server error',
      message: 'Failed to remove cart item. Please try again.'
    });
  }
};

// ✅ Clear Cart
export const clearCart = async (req, res) => {
  const user_id = req.user.id;

  try {
    await pool.query(`DELETE FROM cart_items WHERE user_id = ?`, [user_id]);
    // Emit refresh signals
    const io = req.app.get('io');
    if (io) {
      emitDataRefresh(io, 'cart', { action: 'cleared' });
      emitUserDataRefresh(io, user_id, 'cart', { action: 'cleared' });
    }

    res.json({ 
      success: true,
      message: 'Cart cleared successfully'
    });
  } catch (err) {
    console.error('Clear cart error:', err);
    res.status(500).json({ 
      error: 'Server error',
      message: 'Failed to clear cart. Please try again.'
    });
  }
};
