import { pool } from '../database/db.js';

// Get current stock for all products
const getCurrentStock = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    // Get total count first
    // Build WHERE clause conditionally
    let whereClause = 'WHERE is_active = TRUE';
    try {
      const [columns] = await pool.query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'deleted_at'
      `);
      if (columns.length > 0) {
        whereClause += ' AND deleted_at IS NULL';
      }
    } catch (err) {
      // Column doesn't exist yet, continue without the condition
    }
    
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM products ${whereClause}`
    );
    const total = countResult[0].total;
    
    // Build WHERE clause with deleted_at check
    let productWhereClause = 'WHERE p.is_active = TRUE';
    try {
      const [columns] = await pool.query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'deleted_at'
      `);
      if (columns.length > 0) {
        productWhereClause += ' AND p.deleted_at IS NULL';
      }
    } catch (err) {
      // Column doesn't exist yet, continue without the condition
    }
    
    const query = `
      SELECT 
        p.id,
        p.name,
        p.category_id,
        c.name as category_name,
        p.stock as current_stock,
        p.base_stock as base_stock,
        p.price,
        p.original_price,
        COALESCE(p.reorder_point, 10) as reorder_point,
        p.max_stock,
        CASE 
          WHEN p.stock <= 0 THEN 'OUT_OF_STOCK'
          WHEN p.stock <= COALESCE(p.reorder_point, 10) THEN 'LOW'
          ELSE 'IN_STOCK'
        END as stock_status,
        p.updated_at as last_updated
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      ${productWhereClause}
      ORDER BY p.name
      LIMIT ? OFFSET ?
    `;
    
    const [products] = await pool.query(query, [parseInt(limit), offset]);
    
    // Get sizes for each product
    const productsWithSizes = await Promise.all(
      products.map(async (product) => {
        try {
          const [sizes] = await pool.query(
            `SELECT id, size, stock, base_stock, price, is_active 
             FROM product_sizes 
             WHERE product_id = ? AND is_active = 1 
             ORDER BY 
               CASE size 
                 WHEN 'NONE' THEN 0
                 WHEN 'XS' THEN 1 
                 WHEN 'S' THEN 2 
                 WHEN 'M' THEN 3 
                 WHEN 'L' THEN 4 
                 WHEN 'XL' THEN 5 
                 WHEN 'XXL' THEN 6 
                 ELSE 7 
               END`,
            [product.id]
          );
          
          return {
            ...product,
            sizes: sizes || []
          };
        } catch (error) {
          console.error(`Error fetching sizes for product ${product.id}:`, error);
          return {
            ...product,
            sizes: []
          };
        }
      })
    );
    
    res.json({ 
      success: true, 
      data: productsWithSizes,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching current stock:', error);
    res.status(500).json({ error: 'Failed to fetch current stock' });
  }
};

// Get current stock for a specific product
const getProductStock = async (req, res) => {
  try {
    const { productId } = req.params;
    
    const query = `
      SELECT 
        p.id,
        p.name,
        p.category_id,
        c.name as category_name,
        COALESCE(sb.qty, p.stock, 0) as current_stock,
        p.reorder_point,
        p.max_stock,
        CASE 
          WHEN COALESCE(sb.qty, p.stock, 0) <= p.reorder_point THEN 'LOW'
          WHEN COALESCE(sb.qty, p.stock, 0) <= (p.reorder_point * 2) THEN 'MEDIUM'
          ELSE 'GOOD'
        END as stock_status,
        sb.updated_at as last_updated
      FROM products p
      LEFT JOIN stock_balance sb ON p.id = sb.product_id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.id = ? AND p.is_active = TRUE
    `;
    
    const [rows] = await pool.query(query, [productId]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Error fetching product stock:', error);
    res.status(500).json({ error: 'Failed to fetch product stock' });
  }
};

// Add stock in (using stored procedure)
const addStockIn = async (req, res) => {
  try {
    const { productId, quantity, referenceNo, batchNo, expiryDate, source, note, size } = req.body;
    const userId = req.user?.id || null;
    
    console.log('📦 Stock In Request:', { productId, quantity, size, source, note, userId });
    
    // Validate required fields
    if (!productId || !quantity || !source) {
      return res.status(400).json({ error: 'Product ID, quantity, and source are required' });
    }
    
    if (quantity <= 0) {
      return res.status(400).json({ error: 'Quantity must be greater than 0' });
    }
    
    // Start transaction for handling both product and size stock
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    
    try {
      // Verify user exists if userId is provided
      if (userId) {
        const [userCheck] = await connection.query(
          'SELECT id FROM users WHERE id = ?',
          [userId]
        );
        
        if (userCheck.length === 0) {
          console.log(`⚠️ User ID ${userId} not found, setting created_by to NULL`);
        }
      }
      // If size is provided, update product_sizes table
      if (size && size.trim() !== '') {
        console.log(`📦 Updating size-specific stock for size: ${size}`);
        
        // Check if size exists for this product
        const [sizeExists] = await connection.query(
          'SELECT id, stock FROM product_sizes WHERE product_id = ? AND size = ? AND is_active = 1',
          [productId, size.trim()]
        );
        
        if (sizeExists.length === 0) {
          throw new Error(`Size "${size}" not found for this product`);
        }
        
        // Update size-specific stock
        await connection.query(
          'UPDATE product_sizes SET stock = stock + ? WHERE product_id = ? AND size = ?',
          [quantity, productId, size.trim()]
        );
        
        console.log(`✅ Updated stock for size ${size} by +${quantity}`);
      }
      
      // Call stored procedure for main product stock (this handles products table and transactions)
      // Note: userId can be NULL if user is not found or not authenticated
      await connection.query(
        'CALL sp_stock_in(?, ?, ?, ?, ?, ?, ?, ?)',
        [productId, quantity, referenceNo || null, batchNo || null, expiryDate || null, source, note || null, userId]
      );
      
      await connection.commit();
      
      // Check if stock is now above reorder point
      let shouldRefreshLowStockAlerts = false;
      const [productInfo] = await connection.query(
        'SELECT stock, reorder_point FROM products WHERE id = ?',
        [productId]
      );
      
      if (productInfo.length > 0) {
        // Use consistent threshold of 10 to match low stock alerts display logic
        const LOW_STOCK_THRESHOLD = 10;
        const currentStock = parseInt(productInfo[0].stock) || 0;
        
        // Check if product should be removed from low stock alerts
        // For products with sizes, we need to check if ALL sizes are above threshold
        // For products without sizes, check base stock
        
        // First, check if product has sizes
        const [productSizes] = await connection.query(
          'SELECT id, size, stock FROM product_sizes WHERE product_id = ? AND is_active = 1',
          [productId]
        );
        
        if (productSizes.length > 0) {
          // Product has sizes - calculate total size stock
          const totalSizeStock = productSizes.reduce((sum, size) => sum + (parseInt(size.stock) || 0), 0);
          
          // Check if ALL sizes are above threshold
          const allSizesAboveThreshold = productSizes.every(size => {
            const sizeStock = parseInt(size.stock) || 0;
            return sizeStock > LOW_STOCK_THRESHOLD;
          });
          
          // Also check if base stock is above threshold (if applicable)
          const baseStockAboveThreshold = currentStock > LOW_STOCK_THRESHOLD;
          
          // Product should be removed if:
          // 1. All sizes are above threshold AND (base stock is above threshold OR base stock is 0)
          // 2. OR total size stock is above threshold (for size-only products)
          if ((allSizesAboveThreshold && (baseStockAboveThreshold || currentStock === 0)) || 
              (totalSizeStock > LOW_STOCK_THRESHOLD && totalSizeStock > 0)) {
            shouldRefreshLowStockAlerts = true;
            console.log(`✅ Product ${productId} (with sizes) - stock above threshold (${LOW_STOCK_THRESHOLD}) - alert should be removed`);
          }
        } else {
          // Product without sizes - check base stock only
          if (currentStock > LOW_STOCK_THRESHOLD) {
            shouldRefreshLowStockAlerts = true;
            console.log(`✅ Product ${productId} stock (${currentStock}) is now above threshold (${LOW_STOCK_THRESHOLD}) - alert should be removed`);
          }
        }
      }
      
      connection.release();
      
      console.log(`✅ Successfully added ${quantity} units to stock for product ${productId}${size ? ` (size: ${size})` : ''}`);
      
      // Emit real-time inventory update
      const io = req.app.get('io');
      if (io) {
        io.to('admin-room').emit('inventory-updated', {
          productId,
          quantityChange: quantity,
          size: size || null,
          movementType: 'stock_in',
          reason: 'Stock added',
          timestamp: new Date().toISOString()
        });
        console.log(`📡 Real-time inventory update sent for product ${productId}`);
        
        // Emit low stock alerts refresh if stock is now above threshold
        if (shouldRefreshLowStockAlerts) {
          io.to('admin-room').emit('low-stock-alerts-refresh', {
            productId,
            message: 'Stock restocked above threshold - alert removed'
          });
          console.log(`✅ Low stock alert should be removed for product ${productId}`);
        }
      }
      
      res.json({ 
        success: true, 
        message: `Successfully added ${quantity} units to stock${size ? ` for size ${size}` : ''}`,
        data: { productId, quantity, size, referenceNo, batchNo, expiryDate, source }
      });
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
  } catch (error) {
    console.error('❌ Error adding stock in:', error);
    res.status(500).json({ 
      error: 'Failed to add stock',
      message: error.message || 'An error occurred while adding stock'
    });
  }
};

// Stock out (using stored procedure)
const stockOut = async (req, res) => {
  try {
    const { productId, quantity, referenceNo, source, note, size } = req.body;
    const userId = req.user.id;
    
    // Validate required fields
    if (!productId || !quantity || !source) {
      return res.status(400).json({ error: 'Product ID, quantity, and source are required' });
    }
    
    if (quantity <= 0) {
      return res.status(400).json({ error: 'Quantity must be greater than 0' });
    }
    
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    
    try {
      // If size is provided, update product_sizes table
      if (size && size.trim() !== '') {
        const [sizeRows] = await connection.query(
          'SELECT id, stock FROM product_sizes WHERE product_id = ? AND size = ?',
          [productId, size]
        );
        
        if (sizeRows.length === 0) {
          await connection.rollback();
          connection.release();
          return res.status(404).json({ error: `Size ${size} not found for this product` });
        }
        
        const currentSizeStock = sizeRows[0].stock;
        if (currentSizeStock < quantity) {
          await connection.rollback();
          connection.release();
          return res.status(400).json({ error: `Insufficient stock for size ${size}. Available: ${currentSizeStock}` });
        }
        
        // Deduct from product_sizes
        await connection.query(
          'UPDATE product_sizes SET stock = stock - ? WHERE product_id = ? AND size = ?',
          [quantity, productId, size]
        );
      }
      
      // Call stored procedure for main stock
      await connection.query(
        'CALL sp_stock_out(?, ?, ?, ?, ?, ?)',
        [productId, quantity, referenceNo || null, source, note || null, userId]
      );
      
      await connection.commit();
      connection.release();
      
      // Emit socket event for real-time updates
      const io = req.app.get('io');
      if (io) {
        io.to('admin-room').emit('inventory-updated', {
          productId,
          quantity,
          type: 'stock_out',
          size: size || null,
          timestamp: new Date().toISOString()
        });
      }
      
      res.json({ 
        success: true, 
        message: `Successfully deducted ${quantity} units from stock${size ? ` for size ${size}` : ''}`,
        data: { productId, quantity, size, referenceNo, source }
      });
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
  } catch (error) {
    console.error('Error processing stock out:', error);
    if (error.message.includes('Insufficient stock')) {
      res.status(400).json({ error: 'Insufficient stock available' });
    } else {
      res.status(500).json({ error: 'Failed to process stock out' });
    }
  }
};

// Stock adjustment (using stored procedure)
const adjustStock = async (req, res) => {
  try {
    const { productId, physicalCount, reason, note } = req.body;
    const userId = req.user.id;
    
    // Validate required fields
    if (!productId || physicalCount === undefined || !reason) {
      return res.status(400).json({ error: 'Product ID, physical count, and reason are required' });
    }
    
    if (physicalCount < 0) {
      return res.status(400).json({ error: 'Physical count cannot be negative' });
    }
    
    // Call stored procedure
    await pool.query(
      'CALL sp_stock_adjustment(?, ?, ?, ?, ?)',
      [productId, physicalCount, reason, note, userId]
    );
    
    res.json({ 
      success: true, 
      message: 'Stock adjustment completed successfully',
      data: { productId, physicalCount, reason }
    });
  } catch (error) {
    console.error('Error adjusting stock:', error);
    res.status(500).json({ error: 'Failed to adjust stock' });
  }
};

// Get stock transaction history
const getStockHistory = async (req, res) => {
  try {
    const { productId, page = 1, limit = 50, transactionType, startDate, endDate } = req.query;
    const offset = (page - 1) * limit;
    
    // Check if stock_movements table exists
    let stockMovementsExists = false;
    try {
      await pool.query('SELECT 1 FROM stock_movements LIMIT 1');
      stockMovementsExists = true;
    } catch (tableError) {
      console.log('⚠️ Stock movements table does not exist, using stock_transactions only');
      stockMovementsExists = false;
    }
    
    // Build WHERE clauses and parameters
    let stWhereClause = 'WHERE 1=1';
    let smWhereClause = 'WHERE 1=1';
    const params = [];
    const countParams = [];
    
    if (productId) {
      stWhereClause += ' AND st.product_id = ?';
      smWhereClause += ' AND sm.product_id = ?';
      params.push(productId);
      countParams.push(productId);
    }
    
    if (startDate) {
      stWhereClause += ' AND st.created_at >= ?';
      smWhereClause += ' AND sm.created_at >= ?';
      params.push(startDate);
      countParams.push(startDate);
    }
    
    if (endDate) {
      stWhereClause += ' AND st.created_at <= ?';
      smWhereClause += ' AND sm.created_at <= ?';
      params.push(endDate);
      countParams.push(endDate);
    }
    
    // Build transaction type filter for stock_transactions
    let stTypeFilter = '';
    if (transactionType) {
      if (transactionType === 'IN') {
        stTypeFilter = " AND st.transaction_type = 'IN'";
      } else if (transactionType === 'OUT') {
        stTypeFilter = " AND st.transaction_type = 'OUT'";
      } else {
        stTypeFilter = ' AND st.transaction_type = ?';
        params.push(transactionType);
        countParams.push(transactionType);
      }
    }
    
    // Build movement type filter for stock_movements
    let smTypeFilter = '';
    if (transactionType && stockMovementsExists) {
      if (transactionType === 'IN') {
        smTypeFilter = " AND sm.movement_type = 'stock_in'";
      } else if (transactionType === 'OUT') {
        smTypeFilter = " AND sm.movement_type = 'stock_out'";
      } else {
        // For other types, skip stock_movements or handle accordingly
        smTypeFilter = " AND 1=0"; // Exclude stock_movements for non-IN/OUT types
      }
    }
    
    // Build the query - use stock_movements only if table exists
    let query = '';
    if (stockMovementsExists) {
      // Combined query from both stock_transactions and stock_movements
      query = `
        SELECT 
          id,
          product_id,
          product_name,
          transaction_type,
          quantity,
          previous_stock,
          new_stock,
          reference_no,
          batch_no,
          expiry_date,
          source,
          note,
          created_by_name,
          created_by_role,
          created_at
        FROM (
          SELECT 
            st.id,
            st.product_id,
            p.name as product_name,
            st.transaction_type,
            st.quantity,
            NULL as previous_stock,
            NULL as new_stock,
            st.reference_no,
            st.batch_no,
            st.expiry_date,
            st.source,
            st.note,
            CASE 
              WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL 
                THEN CONCAT(u.first_name, ' ', u.last_name)
              WHEN u.email IS NOT NULL 
                THEN u.email
              ELSE 'System'
            END as created_by_name,
            u.role as created_by_role,
            st.created_at
          FROM stock_transactions st
          JOIN products p ON st.product_id = p.id
          LEFT JOIN users u ON st.created_by = u.id
          ${stWhereClause}
          ${stTypeFilter}
          
          UNION ALL
          
          SELECT 
            sm.id + 1000000 as id,
            sm.product_id,
            p.name as product_name,
            CASE 
              WHEN sm.movement_type = 'stock_in' THEN 'IN'
              WHEN sm.movement_type = 'stock_out' THEN 'OUT'
              WHEN sm.movement_type = 'stock_adjustment' THEN 'ADJUSTMENT'
              ELSE sm.movement_type
            END as transaction_type,
            sm.quantity,
            sm.previous_stock,
            sm.new_stock,
            NULL as reference_no,
            NULL as batch_no,
            NULL as expiry_date,
            COALESCE(sm.reason, 'Manual') as source,
            COALESCE(sm.notes, sm.reason, '') as note,
            CASE 
              WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL 
                THEN CONCAT(u.first_name, ' ', u.last_name)
              WHEN u.email IS NOT NULL 
                THEN u.email
              ELSE 'System'
            END as created_by_name,
            u.role as created_by_role,
            sm.created_at
          FROM stock_movements sm
          JOIN products p ON sm.product_id = p.id
          LEFT JOIN users u ON sm.user_id = u.id
          ${smWhereClause}
          ${smTypeFilter}
        ) combined_history
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `;
    } else {
      // Use only stock_transactions if stock_movements doesn't exist
      query = `
        SELECT 
          st.id,
          st.product_id,
          p.name as product_name,
          st.transaction_type,
          st.quantity,
          NULL as previous_stock,
          NULL as new_stock,
          st.reference_no,
          st.batch_no,
          st.expiry_date,
          st.source,
          st.note,
          CASE 
            WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL 
              THEN CONCAT(u.first_name, ' ', u.last_name)
            WHEN u.email IS NOT NULL 
              THEN u.email
            ELSE 'System'
          END as created_by_name,
          u.role as created_by_role,
          st.created_at
        FROM stock_transactions st
        JOIN products p ON st.product_id = p.id
        LEFT JOIN users u ON st.created_by = u.id
        ${stWhereClause}
        ${stTypeFilter}
        ORDER BY st.created_at DESC
        LIMIT ? OFFSET ?
      `;
    }
    
    params.push(parseInt(limit), offset);
    
    const [rows] = await pool.query(query, params);
    
    // Get total count
    let countQuery = '';
    if (stockMovementsExists) {
      countQuery = `
        SELECT COUNT(*) as total FROM (
          SELECT st.id
          FROM stock_transactions st
          ${stWhereClause}
          ${stTypeFilter}
          
          UNION ALL
          
          SELECT sm.id
          FROM stock_movements sm
          ${smWhereClause}
          ${smTypeFilter}
        ) combined_count
      `;
    } else {
      countQuery = `
        SELECT COUNT(*) as total
        FROM stock_transactions st
        ${stWhereClause}
        ${stTypeFilter}
      `;
    }
    
    const [countResult] = await pool.query(countQuery, countParams);
    const total = countResult[0]?.total || 0;
    
    res.json({
      success: true,
      data: rows || [],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('❌ Error fetching stock history:', error);
    console.error('❌ Error stack:', error.stack);
    console.error('❌ Error details:', {
      message: error.message,
      code: error.code,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage
    });
    res.status(500).json({ 
      error: 'Failed to fetch stock history',
      message: error.message || 'An error occurred while fetching stock history'
    });
  }
};

// Get stock items (batch tracking)
const getStockItems = async (req, res) => {
  try {
    const { productId } = req.params;
    
    const query = `
      SELECT 
        si.id,
        si.product_id,
        p.name as product_name,
        si.batch_no,
        si.expiry_date,
        si.received_at,
        si.remaining_qty,
        si.total_qty,
        si.created_at
      FROM stock_items si
      JOIN products p ON si.product_id = p.id
      WHERE si.product_id = ? AND si.remaining_qty > 0
      ORDER BY si.received_at ASC, si.expiry_date ASC
    `;
    
    const [rows] = await pool.query(query, [productId]);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching stock items:', error);
    res.status(500).json({ error: 'Failed to fetch stock items' });
  }
};

// Get monthly stock report
const getMonthlyStockReport = async (req, res) => {
  try {
    const { year, month } = req.query;
    
    let query = `
      SELECT 
        p.id as product_id,
        p.name as product_name,
        DATE_FORMAT(st.created_at, '%Y-%m') as month,
        SUM(CASE WHEN st.transaction_type = 'IN' THEN st.quantity ELSE 0 END) as total_in,
        SUM(CASE WHEN st.transaction_type = 'OUT' THEN st.quantity ELSE 0 END) as total_out,
        SUM(CASE WHEN st.transaction_type = 'IN' THEN st.quantity ELSE -st.quantity END) as net_movement
      FROM products p
      LEFT JOIN stock_transactions st ON p.id = st.product_id
      WHERE p.is_active = TRUE
    `;
    
    const params = [];
    
    if (year) {
      query += ' AND YEAR(st.created_at) = ?';
      params.push(year);
    }
    
    if (month) {
      query += ' AND MONTH(st.created_at) = ?';
      params.push(month);
    }
    
    query += `
      GROUP BY p.id, p.name, p.sku, DATE_FORMAT(st.created_at, '%Y-%m')
      ORDER BY month DESC, p.name
    `;
    
    const [rows] = await pool.query(query, params);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching monthly stock report:', error);
    res.status(500).json({ error: 'Failed to fetch monthly stock report' });
  }
};

// Get low stock alerts
const getLowStockAlerts = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    
    // Get all active products with their base stock
    const [allProducts] = await pool.query(`
      SELECT 
        p.id,
        p.name,
        c.name as category_name,
        p.stock as current_stock,
        p.base_stock,
        p.price,
        p.original_price,
        p.reorder_point,
        p.max_stock
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.is_active = TRUE
      ORDER BY p.stock ASC, p.name
    `);
    
    // Get product sizes for all products and filter for low stock
    const lowStockProducts = [];
    
    // Use consistent threshold of 10 to match product table display
    const LOW_STOCK_THRESHOLD = 10;
    
    for (const product of allProducts) {
      let isLowStock = false;
      let alertLevel = 'GOOD';
      
      // Get size-specific stock if product has sizes
      const [sizes] = await pool.query(
        'SELECT id, size, stock FROM product_sizes WHERE product_id = ? AND is_active = 1',
        [product.id]
      );
      
      // Calculate actual current stock:
      // - For products WITH sizes: current stock = sum of all size stocks (actual available stock)
      // - For products WITHOUT sizes: current stock = base stock
      let actualCurrentStock = 0;
      if (sizes.length > 0) {
        // Product has sizes - use sum of all size stocks as current stock
        actualCurrentStock = sizes.reduce((sum, size) => sum + (parseInt(size.stock) || 0), 0);
      } else {
        // Product without sizes - use base stock
        actualCurrentStock = parseInt(product.current_stock) || 0;
      }
      
      // Check if current stock is low (based on actual current stock, not base stock)
      if (actualCurrentStock <= LOW_STOCK_THRESHOLD) {
        isLowStock = true;
        if (actualCurrentStock === 0) {
          alertLevel = 'CRITICAL';
        } else {
          alertLevel = 'LOW';
        }
      }
      
      // For products with sizes, also check individual sizes for more detailed alert level
      if (sizes.length > 0) {
        // Check if any size is out of stock
        const hasOutOfStockSize = sizes.some(size => {
          const sizeStock = parseInt(size.stock) || 0;
          return sizeStock === 0;
        });
        if (hasOutOfStockSize && alertLevel !== 'CRITICAL') {
          alertLevel = 'CRITICAL';
        }
      }
      
      // Only include products with low stock (based on actual current stock)
      if (isLowStock) {
        // Calculate suggested reorder quantity
        // Suggested = (max_stock or reorder_point * 3) - current_stock
        const maxStock = parseInt(product.max_stock) || (parseInt(product.reorder_point) || LOW_STOCK_THRESHOLD) * 3;
        const suggestedReorder = Math.max(0, maxStock - actualCurrentStock);
        
        // Determine status text
        const status = actualCurrentStock === 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK';
        
        lowStockProducts.push({
          ...product,
          current_stock: actualCurrentStock, // Use actual current stock
          alert_level: alertLevel,
          status: status, // Add status field
          reorder_level: LOW_STOCK_THRESHOLD, // Use consistent threshold
          suggested_reorder_quantity: suggestedReorder,
          sizes: sizes.length > 0 ? sizes.map(s => ({
            id: s.id,
            size: s.size,
            stock: parseInt(s.stock) || 0
          })) : null // Include size information for display
        });
      }
    }
    
    // Sort by stock level (critical first, then by stock amount)
    // Use the updated current_stock value (which is total size stock for products with sizes)
    lowStockProducts.sort((a, b) => {
      if (a.alert_level === 'CRITICAL' && b.alert_level !== 'CRITICAL') return -1;
      if (a.alert_level !== 'CRITICAL' && b.alert_level === 'CRITICAL') return 1;
      // Sort by the actual current_stock (which we set correctly above)
      const aStock = parseInt(a.current_stock) || 0;
      const bStock = parseInt(b.current_stock) || 0;
      return aStock - bStock;
    });
    
    // Apply pagination
    const total = lowStockProducts.length;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const paginatedProducts = lowStockProducts.slice(offset, offset + parseInt(limit));
    
    console.log(`📊 Low Stock Alerts: Found ${total} products with stock <= ${LOW_STOCK_THRESHOLD} (showing page ${page}, ${paginatedProducts.length} items)`);
    
    res.json({ 
      success: true, 
      data: paginatedProducts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      },
      threshold: LOW_STOCK_THRESHOLD
    });
  } catch (error) {
    console.error('Error fetching low stock alerts:', error);
    res.status(500).json({ error: 'Failed to fetch low stock alerts' });
  }
};

// Get comprehensive inventory/stock report
const getInventoryStockReport = async (req, res) => {
  try {
    const { start_date, end_date, product_id, category_id, size, status, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    // Build date filter
    let dateFilter = '';
    let dateParams = [];
    
    if (start_date) {
      dateFilter += 'AND DATE(sm.created_at) >= ? ';
      dateParams.push(start_date);
    }
    if (end_date) {
      dateFilter += 'AND DATE(sm.created_at) <= ? ';
      dateParams.push(end_date);
    }
    
    // Build product filter
    if (product_id) {
      dateFilter += 'AND p.id = ? ';
      dateParams.push(parseInt(product_id));
    }
    
    // Build category filter
    if (category_id) {
      dateFilter += 'AND p.category_id = ? ';
      dateParams.push(parseInt(category_id));
    }
    
    // Build size filter
    if (size && size !== 'N/A' && size !== 'NONE') {
      dateFilter += 'AND (ps.size = ? OR (ps.size IS NULL AND ? = \'N/A\')) ';
      dateParams.push(size, size);
    }
    
    // Get all products with their sizes
    let productQuery = `
      SELECT DISTINCT
        p.id as product_id,
        p.name as product_name,
        p.category_id,
        COALESCE(c.name, 'Uncategorized') as category_name,
        p.price,
        p.original_price,
        ps.id as size_id,
        ps.size,
        ps.price as size_price
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN product_sizes ps ON p.id = ps.product_id AND ps.is_active = 1
      WHERE p.is_active = TRUE AND p.deleted_at IS NULL
    `;
    
    if (product_id) {
      productQuery += ' AND p.id = ?';
    }
    if (category_id) {
      productQuery += ' AND p.category_id = ?';
    }
    
    const productParams = [];
    if (product_id) productParams.push(parseInt(product_id));
    if (category_id) productParams.push(parseInt(category_id));
    
    const [products] = await pool.query(productQuery, productParams);
    
    // For each product/size combination, calculate stock movements
    const reportData = [];
    
    for (const product of products) {
      const sizeId = product.size_id;
      const productSize = product.size || 'N/A';
      
      // Skip if size filter is applied and doesn't match
      if (size && size !== 'N/A' && size !== 'NONE' && productSize !== size) {
        continue;
      }
      if (size && (size === 'N/A' || size === 'NONE') && productSize !== 'N/A' && productSize !== 'NONE') {
        continue;
      }
      
      // Get beginning stock (stock at start_date or current stock if no start_date)
      let beginningStock = 0;
      if (start_date) {
        // Get stock before the start date
        const [beginningStockQuery] = await pool.query(`
          SELECT 
            COALESCE(ps.stock, p.stock, 0) as stock
          FROM products p
          LEFT JOIN product_sizes ps ON p.id = ps.product_id AND ps.id = ? AND ps.is_active = 1
          WHERE p.id = ?
        `, [sizeId || null, product.product_id]);
        
        beginningStock = beginningStockQuery[0]?.stock || 0;
        
        // Subtract all movements before start_date
        const [movementsBefore] = await pool.query(`
          SELECT 
            SUM(CASE WHEN sm.movement_type = 'stock_in' THEN sm.quantity ELSE 0 END) as stock_in,
            SUM(CASE WHEN sm.movement_type = 'stock_out' THEN sm.quantity ELSE 0 END) as stock_out
          FROM stock_movements sm
          WHERE sm.product_id = ?
            AND (sm.size_id = ? OR (sm.size_id IS NULL AND ? IS NULL))
            AND DATE(sm.created_at) < ?
        `, [product.product_id, sizeId, sizeId, start_date]);
        
        const stockInBefore = parseFloat(movementsBefore[0]?.stock_in || 0);
        const stockOutBefore = parseFloat(movementsBefore[0]?.stock_out || 0);
        beginningStock = beginningStock - stockInBefore + stockOutBefore;
      } else {
        // No start date - use current stock
        if (sizeId) {
          const [sizeStock] = await pool.query(
            'SELECT stock FROM product_sizes WHERE id = ?',
            [sizeId]
          );
          beginningStock = sizeStock[0]?.stock || 0;
        } else {
          const [productStock] = await pool.query(
            'SELECT stock FROM products WHERE id = ?',
            [product.product_id]
          );
          beginningStock = productStock[0]?.stock || 0;
        }
      }
      
      // Get stock movements in the period
      // Stock In includes: restocks (stock_in) and positive adjustments
      // Stock Out includes: sales, returns, damages (stock_out) and negative adjustments
      let movementQuery = `
        SELECT 
          -- Stock In: restocks and positive adjustments
          SUM(CASE 
            WHEN sm.movement_type = 'stock_in' THEN sm.quantity 
            WHEN sm.movement_type = 'stock_adjustment' AND sm.quantity > 0 THEN sm.quantity 
            ELSE 0 
          END) as stock_in,
          -- Stock Out: sales, returns, damages, and negative adjustments
          SUM(CASE 
            WHEN sm.movement_type = 'stock_out' THEN sm.quantity 
            WHEN sm.movement_type = 'stock_adjustment' AND sm.quantity < 0 THEN ABS(sm.quantity) 
            ELSE 0 
          END) as stock_out,
          -- Breakdown by reason for reporting
          SUM(CASE WHEN sm.movement_type = 'stock_in' AND (sm.reason LIKE '%restock%' OR sm.reason LIKE '%restock%' OR sm.reason = 'restock') THEN sm.quantity ELSE 0 END) as restocks,
          SUM(CASE WHEN sm.movement_type = 'stock_out' AND (sm.reason LIKE '%sale%' OR sm.reason LIKE '%order%') THEN sm.quantity ELSE 0 END) as sales,
          SUM(CASE WHEN sm.movement_type = 'stock_out' AND sm.reason LIKE '%return%' THEN sm.quantity ELSE 0 END) as returns,
          SUM(CASE WHEN sm.movement_type = 'stock_out' AND sm.reason LIKE '%damage%' THEN sm.quantity ELSE 0 END) as damages,
          SUM(CASE WHEN sm.movement_type = 'stock_adjustment' AND sm.quantity > 0 THEN sm.quantity ELSE 0 END) as positive_adjustments,
          SUM(CASE WHEN sm.movement_type = 'stock_adjustment' AND sm.quantity < 0 THEN ABS(sm.quantity) ELSE 0 END) as negative_adjustments,
          GROUP_CONCAT(DISTINCT CONCAT(sm.reason, ': ', COALESCE(sm.notes, '')) SEPARATOR '; ') as remarks
        FROM stock_movements sm
        WHERE sm.product_id = ?
          AND (sm.size_id = ? OR (sm.size_id IS NULL AND ? IS NULL))
          ${dateFilter}
      `;
      
      const movementParams = [product.product_id, sizeId, sizeId, ...dateParams];
      const [movements] = await pool.query(movementQuery, movementParams);
      
      // Calculate totals
      // Stock In = restocks + positive adjustments
      const stockIn = parseFloat(movements[0]?.stock_in || 0);
      // Stock Out = sales + returns + damages + negative adjustments
      const stockOut = parseFloat(movements[0]?.stock_out || 0);
      const endingStock = beginningStock + stockIn - stockOut;
      
      // Get unit price/cost (size price if available, otherwise product price)
      // Try to get cost from original_price first, then price
      const unitCost = product.size_price || product.original_price || product.price || 0;
      const unitPrice = product.size_price || product.price || 0;
      // Total Stock Value = Ending Stock × Unit Cost (if cost available, otherwise use price)
      const totalStockValue = endingStock * (unitCost || unitPrice);
      
      // Determine stock status
      const LOW_STOCK_THRESHOLD = 10;
      let stockStatus = 'IN_STOCK';
      if (endingStock === 0) {
        stockStatus = 'OUT_OF_STOCK';
      } else if (endingStock <= LOW_STOCK_THRESHOLD) {
        stockStatus = 'LOW_STOCK';
      }
      
      // Apply status filter if provided
      if (status) {
        if (status === 'IN_STOCK' && stockStatus !== 'IN_STOCK') {
          continue;
        }
        if (status === 'LOW_STOCK' && stockStatus !== 'LOW_STOCK') {
          continue;
        }
        if (status === 'OUT_OF_STOCK' && stockStatus !== 'OUT_OF_STOCK') {
          continue;
        }
      }
      
      // Only include if there are movements or if explicitly requested
      if (stockIn > 0 || stockOut > 0 || !start_date) {
        reportData.push({
          product_id: product.product_id,
          product_name: product.product_name,
          category_name: product.category_name,
          size: productSize,
          beginning_stock: Math.max(0, beginningStock),
          stock_in: stockIn, // Total restocks and positive adjustments
          stock_out: stockOut, // Total sales, returns, damages, and negative adjustments
          ending_stock: Math.max(0, endingStock), // Beginning + In - Out
          unit_cost: unitCost, // Unit cost (original_price or price)
          unit_price: unitPrice, // Unit selling price
          total_stock_value: totalStockValue, // Ending Stock × Unit Cost
          stock_status: stockStatus,
          remarks: movements[0]?.remarks || '',
          // Breakdown for reference (optional)
          breakdown: {
            restocks: parseFloat(movements[0]?.restocks || 0),
            sales: parseFloat(movements[0]?.sales || 0),
            returns: parseFloat(movements[0]?.returns || 0),
            damages: parseFloat(movements[0]?.damages || 0),
            positive_adjustments: parseFloat(movements[0]?.positive_adjustments || 0),
            negative_adjustments: parseFloat(movements[0]?.negative_adjustments || 0)
          }
        });
      }
    }
    
    // Calculate summary (from all data, not just paginated)
    const summary = {
      total_products: new Set(reportData.map(r => r.product_id)).size,
      total_beginning_stock: reportData.reduce((sum, r) => sum + r.beginning_stock, 0),
      total_stock_in: reportData.reduce((sum, r) => sum + r.stock_in, 0),
      total_stock_out: reportData.reduce((sum, r) => sum + r.stock_out, 0),
      total_ending_stock: reportData.reduce((sum, r) => sum + r.ending_stock, 0),
      total_stock_value: reportData.reduce((sum, r) => sum + r.total_stock_value, 0)
    };
    
    // Apply pagination
    const totalRecords = reportData.length;
    const paginatedData = reportData.slice(offset, offset + parseInt(limit));
    
    res.json({
      success: true,
      data: paginatedData,
      summary,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalRecords,
        pages: Math.ceil(totalRecords / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching inventory stock report:', error);
    res.status(500).json({ error: 'Failed to fetch inventory stock report' });
  }
};

// Automatic stock out on order placement
const processOrderStockOut = async (orderId, orderItems) => {
  try {
    const userId = 1; // System user ID for automatic transactions
    
    for (const item of orderItems) {
      await pool.query(
        'CALL sp_stock_out(?, ?, ?, ?, ?, ?)',
        [
          item.product_id,
          item.quantity,
          `ORDER-${orderId}`,
          'sale',
          `Order #${orderId} - ${item.product_name}`,
          userId
        ]
      );
    }
    
    console.log(`✅ Stock out processed for order ${orderId}`);
  } catch (error) {
    console.error(`❌ Error processing stock out for order ${orderId}:`, error);
    throw error;
  }
};

export {
  getCurrentStock,
  getProductStock,
  addStockIn,
  stockOut,
  adjustStock,
  getStockHistory,
  getStockItems,
  getMonthlyStockReport,
  getLowStockAlerts,
  getInventoryStockReport,
  processOrderStockOut
};
