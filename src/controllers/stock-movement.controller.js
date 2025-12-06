import { pool } from '../database/db.js';
import { emitAdminDataRefresh, emitDataRefresh } from '../utils/socket-helper.js';

// ✅ Test endpoint
export const testStockMovements = async (req, res) => {
  try {
    console.log('🧪 Testing stock movements endpoint...');
    res.json({ 
      message: 'Stock movements endpoint is working',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Test Stock Movements Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// ✅ Create table endpoint
export const createStockMovementsTable = async (req, res) => {
  try {
    console.log('🔧 Creating stock_movements table...');
    
    // First, check if table exists and get its structure
    try {
      const [columns] = await pool.query('DESCRIBE stock_movements');
      console.log('📋 Existing table structure:', columns);
      
      const existingColumns = columns.map(col => col.Field);
      const requiredColumns = ['id', 'product_id', 'user_id', 'movement_type', 'quantity', 'reason', 'supplier', 'notes', 'previous_stock', 'new_stock', 'created_at'];
      
      // Add missing columns
      for (const column of requiredColumns) {
        if (!existingColumns.includes(column)) {
          console.log(`🔧 Adding missing ${column} column...`);
          
          switch (column) {
            case 'user_id':
              await pool.query('ALTER TABLE stock_movements ADD COLUMN user_id INT NOT NULL AFTER product_id');
              await pool.query('ALTER TABLE stock_movements ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE');
              await pool.query('ALTER TABLE stock_movements ADD INDEX idx_stock_movements_user (user_id)');
              break;
            case 'supplier':
              await pool.query('ALTER TABLE stock_movements ADD COLUMN supplier VARCHAR(200) AFTER reason');
              break;
            case 'notes':
              await pool.query('ALTER TABLE stock_movements ADD COLUMN notes TEXT AFTER supplier');
              break;
            case 'movement_type':
              await pool.query('ALTER TABLE stock_movements ADD COLUMN movement_type ENUM("stock_in", "stock_out", "stock_adjustment") NOT NULL AFTER user_id');
              break;
            case 'quantity':
              await pool.query('ALTER TABLE stock_movements ADD COLUMN quantity INT NOT NULL AFTER movement_type');
              break;
            case 'reason':
              await pool.query('ALTER TABLE stock_movements ADD COLUMN reason VARCHAR(100) NOT NULL AFTER quantity');
              break;
            case 'created_at':
              await pool.query('ALTER TABLE stock_movements ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP AFTER notes');
              break;
            case 'previous_stock':
              await pool.query('ALTER TABLE stock_movements ADD COLUMN previous_stock INT AFTER notes');
              break;
            case 'new_stock':
              await pool.query('ALTER TABLE stock_movements ADD COLUMN new_stock INT AFTER previous_stock');
              break;
          }
          console.log(`✅ Added ${column} column`);
        }
      }
    } catch (describeError) {
      console.log('📋 Table does not exist, creating it...');
      
      await pool.query(`
        CREATE TABLE IF NOT EXISTS stock_movements (
          id INT PRIMARY KEY AUTO_INCREMENT,
          product_id INT NOT NULL,
          user_id INT NOT NULL,
          movement_type ENUM('stock_in', 'stock_out', 'stock_adjustment') NOT NULL,
          quantity INT NOT NULL,
          reason VARCHAR(100) NOT NULL,
          supplier VARCHAR(200),
          notes TEXT,
          previous_stock INT,
          new_stock INT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          
          FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          
          CONSTRAINT chk_movement_quantity CHECK (quantity > 0),
          INDEX idx_stock_movements_product (product_id),
          INDEX idx_stock_movements_user (user_id),
          INDEX idx_stock_movements_type (movement_type),
          INDEX idx_stock_movements_date (created_at)
        )
      `);
    }
    
    console.log('✅ Stock movements table created/updated successfully');
    res.json({ 
      message: 'Stock movements table created/updated successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Create Table Error:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
};

// ✅ Create Stock Movement
export const createStockMovement = async (req, res) => {
  try {
    const { product_id, movement_type, quantity, reason, supplier, notes, size } = req.body;
    const user_id = req.user.id;

    // Debug logging
    console.log('📦 Stock Movement Request:', {
      product_id,
      movement_type,
      quantity,
      reason,
      size,
      size_type: typeof size,
      size_is_null: size === null,
      size_is_undefined: size === undefined,
      size_is_empty: size === '',
      body: req.body
    });

    // Validation
    if (!product_id || !movement_type || !quantity) {
      return res.status(400).json({ 
        error: 'Product ID, movement type, and quantity are required' 
      });
    }
    
    // Set default reason if not provided
    let finalReason = reason;
    if (!finalReason || finalReason.trim() === '') {
      if (movement_type === 'stock_in') {
        finalReason = 'restock';
      } else if (movement_type === 'stock_out') {
        finalReason = 'deduction';
      } else if (movement_type === 'stock_adjustment') {
        finalReason = 'adjustment';
      } else {
        finalReason = 'other';
      }
    }

    if (!['stock_in', 'stock_out', 'stock_adjustment'].includes(movement_type)) {
      return res.status(400).json({ 
        error: 'Movement type must be "stock_in", "stock_out", or "stock_adjustment"' 
      });
    }

    if (quantity <= 0) {
      return res.status(400).json({ 
        error: 'Quantity must be greater than 0' 
      });
    }

    // Check if stock_movements table exists and has required columns
    try {
      await pool.query('SELECT 1 FROM stock_movements LIMIT 1');
      
      // Check if size_id column exists
      const [columns] = await pool.query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'stock_movements' 
        AND COLUMN_NAME = 'size_id'
      `);
      
      if (columns.length === 0) {
        console.log('📦 Adding size_id column to stock_movements table...');
        await pool.query(`
          ALTER TABLE stock_movements 
          ADD COLUMN size_id INT NULL AFTER product_id
        `);
        
        // Add foreign key constraint
        try {
          await pool.query(`
            ALTER TABLE stock_movements 
            ADD CONSTRAINT fk_stock_movements_size 
            FOREIGN KEY (size_id) REFERENCES product_sizes(id) ON DELETE SET NULL
          `);
        } catch (fkError) {
          // Foreign key might already exist, ignore
          console.log('ℹ️ Foreign key constraint may already exist:', fkError.message);
        }
        
        // Add index
        try {
          await pool.query(`
            CREATE INDEX idx_stock_movements_size ON stock_movements (size_id)
          `);
        } catch (indexError) {
          // Index might already exist, ignore
          console.log('ℹ️ Index may already exist:', indexError.message);
        }
        
        console.log('✅ size_id column added successfully');
      }
    } catch (tableError) {
      console.log('Stock movements table does not exist, creating it...');
      // Create the table if it doesn't exist
      await pool.query(`
        CREATE TABLE IF NOT EXISTS stock_movements (
          id INT PRIMARY KEY AUTO_INCREMENT,
          product_id INT NOT NULL,
          size_id INT NULL,
          user_id INT NOT NULL,
          movement_type ENUM('stock_in', 'stock_out', 'stock_adjustment') NOT NULL,
          quantity INT NOT NULL,
          reason VARCHAR(100) NOT NULL,
          supplier VARCHAR(200),
          notes TEXT,
          previous_stock INT,
          new_stock INT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          
          FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
          FOREIGN KEY (size_id) REFERENCES product_sizes(id) ON DELETE SET NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          
          CONSTRAINT chk_movement_quantity CHECK (quantity > 0),
          INDEX idx_stock_movements_product (product_id),
          INDEX idx_stock_movements_size (size_id),
          INDEX idx_stock_movements_user (user_id),
          INDEX idx_stock_movements_type (movement_type),
          INDEX idx_stock_movements_date (created_at)
        )
      `);
    }

    // Check if product exists
    const [products] = await pool.query(
      'SELECT id, name, stock FROM products WHERE id = ? AND is_active = 1',
      [product_id]
    );

    if (products.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = products[0];
    
    // Get size_id if size is provided
    let size_id = null;
    let currentStock = parseInt(product.stock) || 0;
    let stockTarget = 'products'; // Track whether we're updating product or product_sizes
    
    // Clean and validate the size parameter
    const cleanSize = size && size.toString().trim();
    console.log('🔍 Size parameter received:', {
      original: size,
      cleaned: cleanSize,
      type: typeof size,
      isEmpty: !cleanSize || cleanSize === '' || cleanSize === 'null' || cleanSize === 'undefined'
    });
    
    if (cleanSize && cleanSize !== '' && cleanSize !== 'null' && cleanSize !== 'undefined') {
      console.log('🔍 Looking for size:', cleanSize, 'for product_id:', product_id);
      
      // First, let's see what sizes exist for this product
      const [availableSizes] = await pool.query(
        'SELECT id, size, stock FROM product_sizes WHERE product_id = ? AND is_active = 1',
        [product_id]
      );
      console.log('📋 Available sizes for product:', availableSizes);
      
      const [sizeResults] = await pool.query(
        'SELECT id, stock FROM product_sizes WHERE product_id = ? AND TRIM(size) = ? AND is_active = 1',
        [product_id, cleanSize]
      );
      
      console.log('🔍 Size query results:', sizeResults);
      
      if (sizeResults.length > 0) {
        size_id = sizeResults[0].id;
        currentStock = parseInt(sizeResults[0].stock) || 0;
        stockTarget = 'product_sizes';
        console.log('✅ Found size_id:', size_id, 'with current stock:', currentStock);
      } else {
        console.log('⚠️ No size found with name:', cleanSize, 'for product:', product_id);
        console.log('⚠️ Query was: SELECT id, stock FROM product_sizes WHERE product_id =', product_id, 'AND TRIM(size) =', cleanSize, 'AND is_active = 1');
      }
    } else {
      console.log('ℹ️ No size specified - updating base stock');
    }

    // Check if stock out would result in negative stock (not for adjustments)
    // Only block if it would go below 0
    if (movement_type === 'stock_out' && currentStock < quantity) {
      // Allow if admin wants to adjust to negative (for corrections)
      // Just log a warning instead of blocking
      console.warn(`⚠️ Stock out would result in negative stock. Current: ${currentStock}, Requested: ${quantity}`);
      // Allow the operation to proceed - admin may be correcting inventory
    }

    // Start transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Calculate new stock
      let newStock;
      if (movement_type === 'stock_in') {
        newStock = currentStock + quantity;
      } else if (movement_type === 'stock_out') {
        newStock = currentStock - quantity;
      } else if (movement_type === 'stock_adjustment') {
        // For adjustments, quantity represents the new stock level
        newStock = quantity;
      }

      // Update stock in the appropriate table
      if (stockTarget === 'product_sizes' && size_id) {
        await connection.query(
          'UPDATE product_sizes SET stock = ?, updated_at = NOW() WHERE id = ?',
          [newStock, size_id]
        );
      } else {
        await connection.query(
          'UPDATE products SET stock = ?, updated_at = NOW() WHERE id = ?',
          [newStock, product_id]
        );
      }

      // Record stock movement with size_id
      const [result] = await connection.query(
        `INSERT INTO stock_movements 
         (product_id, size_id, user_id, movement_type, quantity, reason, supplier, notes, previous_stock, new_stock, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [product_id, size_id, user_id, movement_type, quantity, finalReason, supplier, notes, currentStock, newStock]
      );

      await connection.commit();
      connection.release();

      // Check if stock is now above reorder point (for stock_in or positive adjustments)
      // Use a fresh connection to ensure we see the committed data
      let shouldRefreshLowStockAlerts = false;
      if (movement_type === 'stock_in' || (movement_type === 'stock_adjustment' && newStock > currentStock)) {
        // Get product reorder point and current stock to check if stock is now above threshold
        const checkConnection = await pool.getConnection();
        try {
          const [productInfo] = await checkConnection.query(
            'SELECT stock, reorder_point FROM products WHERE id = ?',
            [product_id]
          );
          
          if (productInfo.length > 0) {
            // Use consistent threshold of 10 to match low stock alerts display logic
            const LOW_STOCK_THRESHOLD = 10;
            const actualCurrentStock = parseInt(productInfo[0].stock) || 0;
            
            // Check if product should be removed from low stock alerts
            // For products with sizes, we need to check if ALL sizes are above threshold
            // For products without sizes, check base stock
            
            // First, check if product has sizes
            const [productSizes] = await checkConnection.query(
              'SELECT id, size, stock FROM product_sizes WHERE product_id = ? AND is_active = 1',
              [product_id]
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
              const baseStockAboveThreshold = actualCurrentStock > LOW_STOCK_THRESHOLD;
              
              // Product should be removed if:
              // 1. All sizes are above threshold AND (base stock is above threshold OR base stock is 0)
              // 2. OR total size stock is above threshold (for size-only products)
              if ((allSizesAboveThreshold && (baseStockAboveThreshold || actualCurrentStock === 0)) || 
                  (totalSizeStock > LOW_STOCK_THRESHOLD && totalSizeStock > 0)) {
                shouldRefreshLowStockAlerts = true;
                console.log(`✅ Product ${product_id} (with sizes) - stock above threshold (${LOW_STOCK_THRESHOLD}) - alert should be removed`);
              } else {
                console.log(`⚠️ Product ${product_id} (with sizes) - some sizes still at or below threshold (${LOW_STOCK_THRESHOLD})`);
              }
            } else {
              // Product without sizes - check base stock only
              console.log(`🔍 Checking low stock alert: Product ${product_id}, Stock: ${actualCurrentStock}, Threshold: ${LOW_STOCK_THRESHOLD}`);
              if (actualCurrentStock > LOW_STOCK_THRESHOLD) {
                shouldRefreshLowStockAlerts = true;
                console.log(`✅ Product ${product_id} stock (${actualCurrentStock}) is now above threshold (${LOW_STOCK_THRESHOLD}) - alert should be removed`);
              }
            }
          }
        } finally {
          checkConnection.release();
        }
      }

      // Emit real-time updates
      const io = req.app.get('io');
      if (io) {
        emitAdminDataRefresh(io, 'inventory', {
          product_id,
          size_id,
          size,
          movement_type,
          quantity,
          new_stock: newStock
        });
        
        // Always emit low stock alerts refresh when stock is added (stock_in)
        // The frontend will refresh and the backend will filter out products above threshold
        if (movement_type === 'stock_in') {
          io.to('admin-room').emit('low-stock-alerts-refresh', {
            product_id,
            new_stock: newStock,
            message: 'Stock restocked - refreshing alerts'
          });
          console.log(`🔄 Low stock alerts refresh emitted for product ${product_id} after stock_in`);
        } else if (shouldRefreshLowStockAlerts) {
          // For other movement types, only refresh if stock is above threshold
          io.to('admin-room').emit('low-stock-alerts-refresh', {
            product_id,
            new_stock: newStock,
            message: 'Stock restocked above threshold - alert removed'
          });
          console.log(`✅ Low stock alert should be removed for product ${product_id} (stock: ${newStock})`);
        }
      }

      res.status(201).json({
        message: 'Stock movement recorded successfully',
        stock_movement_id: result.insertId,
        new_stock: newStock,
        movement: {
          id: result.insertId,
          product_id,
          size_id,
          size,
          movement_type,
          quantity,
          reason,
          supplier,
          notes,
          created_at: new Date()
        }
      });

    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }

  } catch (error) {
    console.error('Create Stock Movement Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// ✅ Get Stock Movements
export const getStockMovements = async (req, res) => {
  try {
    console.log('📊 Getting stock movements...');
    const { product_id, movement_type, limit = 50, offset = 0 } = req.query;

    // Check if stock_movements table exists
    try {
      await pool.query('SELECT 1 FROM stock_movements LIMIT 1');
      console.log('✅ Stock movements table exists');
    } catch (tableError) {
      console.log('❌ Stock movements table does not exist, returning empty array');
      console.log('Table error:', tableError.message);
      return res.json([]);
    }

    let whereConditions = [];
    let queryParams = [];

    if (product_id) {
      whereConditions.push('sm.product_id = ?');
      queryParams.push(product_id);
    }

    if (movement_type) {
      whereConditions.push('sm.movement_type = ?');
      queryParams.push(movement_type);
    }

    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(' AND ')}` 
      : '';

    const [movements] = await pool.query(
      `SELECT 
        sm.id,
        sm.product_id,
        sm.user_id,
        sm.movement_type,
        sm.quantity,
        sm.reason,
        sm.supplier,
        sm.notes,
        sm.previous_stock,
        sm.new_stock,
        sm.created_at,
        p.name as product_name,
        CASE 
          WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL 
            THEN CONCAT(u.first_name, ' ', u.last_name)
          WHEN u.email IS NOT NULL 
            THEN u.email
          ELSE 'System'
        END as user_name,
        u.role as user_role
       FROM stock_movements sm
       LEFT JOIN products p ON sm.product_id = p.id
       LEFT JOIN users u ON sm.user_id = u.id
       ${whereClause}
       ORDER BY sm.created_at DESC
       LIMIT ? OFFSET ?`,
      [...queryParams, parseInt(limit), parseInt(offset)]
    );

    console.log(`📊 Found ${movements.length} stock movements`);
    res.json(movements);

  } catch (error) {
    console.error('Get Stock Movements Error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      errno: error.errno,
      sqlState: error.sqlState
    });
    res.status(500).json({ 
      error: 'Internal Server Error',
      details: error.message,
      code: error.code
    });
  }
};

// ✅ Get Stock Movement by ID
export const getStockMovementById = async (req, res) => {
  try {
    const { id } = req.params;

    const [movements] = await pool.query(
      `SELECT 
        sm.id,
        sm.product_id,
        sm.user_id,
        sm.movement_type,
        sm.quantity,
        sm.reason,
        sm.supplier,
        sm.notes,
        sm.previous_stock,
        sm.new_stock,
        sm.created_at,
        p.name as product_name,
        u.name as user_name
       FROM stock_movements sm
       LEFT JOIN products p ON sm.product_id = p.id
       LEFT JOIN users u ON sm.user_id = u.id
       WHERE sm.id = ?`,
      [id]
    );

    if (movements.length === 0) {
      return res.status(404).json({ error: 'Stock movement not found' });
    }

    res.json(movements[0]);

  } catch (error) {
    console.error('Get Stock Movement Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// ✅ Get Stock Movement Summary
export const getStockMovementSummary = async (req, res) => {
  try {
    const { product_id, days = 30 } = req.query;

    let whereConditions = ['sm.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)'];
    let queryParams = [parseInt(days)];

    if (product_id) {
      whereConditions.push('sm.product_id = ?');
      queryParams.push(product_id);
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    const [summary] = await pool.query(
      `SELECT 
        sm.movement_type,
        COUNT(*) as movement_count,
        SUM(sm.quantity) as total_quantity
       FROM stock_movements sm
       ${whereClause}
       GROUP BY sm.movement_type`,
      queryParams
    );

    const [recentMovements] = await pool.query(
      `SELECT 
        sm.id,
        sm.movement_type,
        sm.quantity,
        sm.reason,
        sm.created_at,
        p.name as product_name
       FROM stock_movements sm
       LEFT JOIN products p ON sm.product_id = p.id
       ${whereClause}
       ORDER BY sm.created_at DESC
       LIMIT 10`,
      queryParams
    );

    res.json({
      summary,
      recent_movements: recentMovements
    });

  } catch (error) {
    console.error('Get Stock Movement Summary Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// ✅ Get Current Inventory Report
export const getCurrentInventoryReport = async (req, res) => {
  try {
    const { category, low_stock_threshold = 10 } = req.query;

    let whereConditions = ['p.is_active = 1'];
    let queryParams = [];

    if (category) {
      whereConditions.push('c.name = ?');
      queryParams.push(category);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const [products] = await pool.query(
      `SELECT 
        p.id,
        p.name as product_name,
        p.stock as current_stock,
        p.base_stock,
        p.price as selling_price,
        p.original_price as cost_price,
        c.name as category_name,
        p.reorder_point,
        p.created_at,
        p.updated_at
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       ${whereClause}
       ORDER BY p.name`,
      queryParams
    );

    // For each product, get its sizes and create rows for each size
    const inventory = [];
    const threshold = parseInt(low_stock_threshold);

    for (const product of products) {
      // Get sizes for this product
      const [sizes] = await pool.query(
        `SELECT 
          id,
          size,
          stock,
          base_stock,
          price,
          is_active
         FROM product_sizes
         WHERE product_id = ? AND is_active = 1
         ORDER BY 
           CASE size
             WHEN 'XXS' THEN 1
             WHEN 'XS' THEN 2
             WHEN 'S' THEN 3
             WHEN 'M' THEN 4
             WHEN 'L' THEN 5
             WHEN 'XL' THEN 6
             WHEN 'XXL' THEN 7
             ELSE 8
           END`,
        [product.id]
      );

      if (sizes.length > 0) {
        // Product has sizes - add a row for each size
        for (const size of sizes) {
          inventory.push({
            id: `${product.id}-${size.id}`,
            product_id: product.id,
            product_name: product.product_name,
            size: size.size,
            current_stock: size.stock,
            base_stock: product.base_stock,  // Use product's base stock, not size's base stock
            selling_price: size.price || product.selling_price,
            cost_price: product.cost_price,
            category_name: product.category_name,
            stock_status: size.stock === 0 ? 'Out of Stock' : size.stock <= threshold ? 'Low Stock' : 'In Stock',
            reorder_point: product.reorder_point,
            created_at: product.created_at,
            updated_at: product.updated_at
          });
        }
      } else {
        // Product has no sizes - add single row
        inventory.push({
          id: product.id,
          product_id: product.id,
          product_name: product.product_name,
          size: 'No sizes',
          current_stock: product.current_stock,
          base_stock: product.base_stock,
          selling_price: product.selling_price,
          cost_price: product.cost_price,
          category_name: product.category_name,
          stock_status: product.current_stock === 0 ? 'Out of Stock' : product.current_stock <= threshold ? 'Low Stock' : 'In Stock',
          reorder_point: product.reorder_point,
          created_at: product.created_at,
          updated_at: product.updated_at
        });
      }
    }

    res.json({
      report_type: 'current_inventory',
      generated_at: new Date().toISOString(),
      total_products: products.length,
      total_rows: inventory.length,
      low_stock_threshold: threshold,
      inventory
    });

  } catch (error) {
    console.error('Get Current Inventory Report Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// ✅ Get Restock Report
export const getRestockReport = async (req, res) => {
  try {
    const { days = 30, product_id } = req.query;

    let whereConditions = [
      'sm.movement_type = "stock_in"',
      'sm.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)'
    ];
    let queryParams = [parseInt(days)];

    if (product_id) {
      whereConditions.push('sm.product_id = ?');
      queryParams.push(product_id);
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    // Check if size_id column exists in stock_movements table
    let hasSizeColumn = false;
    try {
      const [columns] = await pool.query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'stock_movements' 
        AND COLUMN_NAME = 'size_id'
      `);
      hasSizeColumn = columns.length > 0;
    } catch (err) {
      console.log('Could not check for size_id column:', err.message);
    }

    // Build query based on whether size_id column exists
    const sizeFields = hasSizeColumn 
      ? 'sm.size_id, ps.size as size,'
      : 'NULL as size_id, NULL as size,';
    
    const sizeJoin = hasSizeColumn
      ? 'LEFT JOIN product_sizes ps ON sm.size_id = ps.id'
      : '';

    const [restocks] = await pool.query(
      `SELECT 
        sm.id,
        sm.product_id,
        ${sizeFields}
        p.name as product_name,
        sm.quantity,
        sm.reason,
        sm.supplier,
        sm.previous_stock as stock_before,
        sm.new_stock as stock_after,
        sm.created_at as date,
        CASE 
          WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL 
            THEN CONCAT(u.first_name, ' ', u.last_name)
          WHEN u.name IS NOT NULL 
            THEN u.name
          WHEN u.email IS NOT NULL 
            THEN u.email
          ELSE 'System'
        END as admin_name
       FROM stock_movements sm
       LEFT JOIN products p ON sm.product_id = p.id
       ${sizeJoin}
       LEFT JOIN users u ON sm.user_id = u.id
       ${whereClause}
       ORDER BY sm.created_at DESC`,
      queryParams
    );

    // Calculate summary
    const totalRestocked = restocks.reduce((sum, item) => sum + item.quantity, 0);
    const uniqueProducts = new Set(restocks.map(item => item.product_id)).size;

    res.json({
      report_type: 'restock',
      generated_at: new Date().toISOString(),
      period_days: parseInt(days),
      total_restocks: restocks.length,
      total_quantity_restocked: totalRestocked,
      unique_products_restocked: uniqueProducts,
      restocks,
      has_size_tracking: hasSizeColumn
    });

  } catch (error) {
    console.error('Get Restock Report Error:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
};

// ✅ Get Sales/Usage Report
export const getSalesUsageReport = async (req, res) => {
  try {
    const { days = 30, product_id } = req.query;

    let whereConditions = [
      'sm.movement_type = "stock_out"',
      'sm.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)'
    ];
    let queryParams = [parseInt(days)];

    if (product_id) {
      whereConditions.push('sm.product_id = ?');
      queryParams.push(product_id);
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    // Check if size_id column exists in stock_movements table
    let hasSizeColumn = false;
    try {
      const [columns] = await pool.query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'stock_movements' 
        AND COLUMN_NAME = 'size_id'
      `);
      hasSizeColumn = columns.length > 0;
    } catch (err) {
      console.log('Could not check for size_id column:', err.message);
    }

    // Build query based on whether size_id column exists
    const sizeFields = hasSizeColumn 
      ? 'sm.size_id, ps.size as size,'
      : 'NULL as size_id, NULL as size,';
    
    const sizeJoin = hasSizeColumn
      ? 'LEFT JOIN product_sizes ps ON sm.size_id = ps.id'
      : '';

    const [sales] = await pool.query(
      `SELECT 
        sm.id,
        sm.product_id,
        ${sizeFields}
        p.name as product_name,
        sm.quantity,
        sm.reason,
        sm.previous_stock,
        sm.new_stock,
        sm.created_at,
        CASE 
          WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL 
            THEN CONCAT(u.first_name, ' ', u.last_name)
          WHEN u.name IS NOT NULL 
            THEN u.name
          WHEN u.email IS NOT NULL 
            THEN u.email
          ELSE 'System'
        END as user_name
       FROM stock_movements sm
       LEFT JOIN products p ON sm.product_id = p.id
       ${sizeJoin}
       LEFT JOIN users u ON sm.user_id = u.id
       ${whereClause}
       ORDER BY sm.created_at DESC`,
      queryParams
    );

    // Calculate summary
    const totalSold = sales.reduce((sum, item) => sum + item.quantity, 0);
    const uniqueProducts = new Set(sales.map(item => item.product_id)).size;
    
    // Group by reason
    const reasonBreakdown = sales.reduce((acc, item) => {
      acc[item.reason] = (acc[item.reason] || 0) + item.quantity;
      return acc;
    }, {});

    res.json({
      report_type: 'sales_usage',
      generated_at: new Date().toISOString(),
      period_days: parseInt(days),
      total_sales: sales.length,
      total_quantity_sold: totalSold,
      unique_products_sold: uniqueProducts,
      reason_breakdown: reasonBreakdown,
      sales,
      has_size_tracking: hasSizeColumn
    });

  } catch (error) {
    console.error('Get Sales/Usage Report Error:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
};

// ✅ Get Low Stock Alert Report
export const getLowStockAlertReport = async (req, res) => {
  try {
    const { threshold = 10, category } = req.query;

    let whereConditions = [
      'p.is_active = 1',
      'p.stock <= ?'
    ];
    let queryParams = [parseInt(threshold)];

    if (category) {
      whereConditions.push('c.name = ?');
      queryParams.push(category);
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    const [lowStockProducts] = await pool.query(
      `SELECT 
        p.id,
        p.name as product_name,
        p.stock as current_stock,
        p.price as selling_price,
        c.name as category_name,
        CASE 
          WHEN p.stock = 0 THEN 'Out of Stock'
          ELSE 'Low Stock'
        END as alert_level,
        p.created_at,
        p.updated_at
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       ${whereClause}
       ORDER BY p.stock ASC, p.name`,
      queryParams
    );

    // Calculate summary
    const outOfStock = lowStockProducts.filter(p => p.current_stock === 0).length;
    const lowStock = lowStockProducts.filter(p => p.current_stock > 0).length;

    res.json({
      report_type: 'low_stock_alert',
      generated_at: new Date().toISOString(),
      threshold: parseInt(threshold),
      total_alerts: lowStockProducts.length,
      out_of_stock: outOfStock,
      low_stock: lowStock,
      products: lowStockProducts
    });

  } catch (error) {
    console.error('Get Low Stock Alert Report Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};
