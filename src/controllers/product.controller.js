import { pool } from '../database/db.js';
import {
    validateId,
    validateImageUrl,
    validateName,
    validatePagination,
    validatePrice,
    validateSize,
    validateStock
} from '../utils/validation.js';
import { emitAdminDataRefresh, emitDataRefresh } from '../utils/socket-helper.js';
import { ensureDeletedAtColumn, getDeletedAtConditionSafe, ensureProductImagesTable } from '../utils/migration-helper.js';
import { 
  AppError, 
  ValidationError, 
  NotFoundError, 
  ConflictError,
  logger,
  asyncHandler 
} from '../utils/errorHandler.js';

// Low stock threshold
const LOW_STOCK_THRESHOLD = 10;

// Stock movement types
const STOCK_MOVEMENT_TYPES = {
  PURCHASE: 'purchase',
  SALE: 'sale',
  ADJUSTMENT: 'adjustment',
  RETURN: 'return'
};

// ✅ Get All Products - Simple version for frontend
export const getAllProductsSimple = async (req, res) => {
  try {
    // Ensure deleted_at column exists
    await ensureDeletedAtColumn();
    
    const { category } = req.query;
    
    // Build WHERE clause
    let whereConditions = ['p.is_active = 1'];
    let queryParams = [];
    
    // Check if deleted_at column exists before adding condition
    try {
      const [columns] = await pool.query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'deleted_at'
      `);
      if (columns.length > 0) {
        whereConditions.push('p.deleted_at IS NULL');
      }
    } catch (err) {
      // Column doesn't exist yet, continue without the condition
    }
    
    if (category) {
      // Filter by category name
      whereConditions.push('UPPER(c.name) = UPPER(?)');
      queryParams.push(category.trim());
    }
    
    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;
    
    const [products] = await pool.query(`
        SELECT 
        p.id,
        p.name,
        p.description,
        p.price,
        p.original_price,
        p.stock,
        p.base_stock,
        p.image,
        p.created_at,
        p.last_restock_date,
        p.category_id,
        c.name as category_name,
        c.name as category
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      ${whereClause}
      ORDER BY p.name, p.created_at DESC
    `, queryParams);

    // Handle empty products array
    if (!products || products.length === 0) {
      return res.json([]);
    }

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
            id: product.id,
            product_code: `PRD${String(product.id).padStart(3, '0')}`,
            name: product.name,
            description: product.description,
            price: parseFloat(product.price),
            original_price: parseFloat(product.original_price || 0),
            stock: parseInt(product.stock),
            base_stock: parseInt(product.base_stock || 0),
            image_url: product.image ? product.image : null,
            image: product.image ? product.image : null,
            unit_of_measure: 'pcs',
            supplier: 'N/A',
            reorder_level: 5,
            updated_by: 'N/A',
            created_at: product.created_at,
            last_restock_date: product.last_restock_date,
            category_id: product.category_id || null,
            category_name: product.category_name,
            category: product.category || product.category_name || 'Other',
            sizes: sizes.map(size => ({
              id: size.id,
              size: size.size,
              stock: parseInt(size.stock) || 0, // Use size-specific stock, default to 0 if NULL
              base_stock: parseInt(size.base_stock || 0),
              price: parseFloat(size.price)
            }))
          };
        } catch (error) {
          console.error(`Error fetching sizes for product ${product.id}:`, error);
          return {
            id: product.id,
            product_code: `PRD${String(product.id).padStart(3, '0')}`,
            name: product.name,
            description: product.description,
            price: parseFloat(product.price),
            original_price: parseFloat(product.original_price || 0),
            stock: parseInt(product.stock),
            image_url: product.image ? product.image : null,
            image: product.image ? product.image : null,
            unit_of_measure: 'pcs',
            supplier: 'N/A',
            reorder_level: 5,
            updated_by: 'N/A',
            created_at: product.created_at,
            last_restock_date: product.last_restock_date,
            category_name: product.category_name,
            category: product.category || product.category_name || 'Other',
            sizes: []
          };
        }
      })
    );

    // Group products by name
    const groupedProducts = {};
    productsWithSizes.forEach(product => {
      if (!groupedProducts[product.name]) {
        groupedProducts[product.name] = {
          ...product,
          sizes: []
        };
      }
      
      // Add sizes from this product to the grouped product
      if (product.sizes && product.sizes.length > 0) {
        groupedProducts[product.name].sizes.push(...product.sizes);
      } else {
        // If no sizes, add a default "NONE" size
        groupedProducts[product.name].sizes.push({
          id: `default-${product.id}`,
          size: 'NONE',
          stock: product.stock,
          price: product.price
        });
      }
    });

    // Convert grouped products back to array
    const finalProducts = Object.values(groupedProducts);

    res.json(finalProducts);
  } catch (err) {
    console.error('Get Products Simple Error:', err);
    console.error('Error stack:', err.stack);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: err.message || 'Failed to fetch products'
    });
  }
};

// ✅ Create Product
export const createProduct = async (req, res) => {
  try {
    const { name, description, price, original_price, stock, sizes, category_id, image, images } = req.body;
    
    console.log('🔍 Received product data:', { name, description, price, original_price, stock, sizes, category_id, image });

    // Enhanced validation
    if (!validateName(name)) {
      return res.status(400).json({ 
        error: 'Name is required and must be 2-50 characters long' 
      });
    }

    if (!validatePrice(price)) {
      return res.status(400).json({ 
        error: 'Valid selling price is required' 
      });
    }

    if (!validatePrice(original_price)) {
      return res.status(400).json({ 
        error: 'Valid cost price is required' 
      });
    }

    if (Number(price) <= Number(original_price)) {
      return res.status(400).json({ 
        error: 'Selling price must be higher than cost price' 
      });
    }

    if (!validateStock(stock)) {
      return res.status(400).json({ 
        error: 'Valid stock quantity is required' 
      });
    }

    // Validate image is required
    if (!image || !image.trim()) {
      return res.status(400).json({ 
        error: 'Product image is required' 
      });
    }

    if (!validateImageUrl(image)) {
      return res.status(400).json({ 
        error: 'Invalid image URL format' 
      });
    }

    // Validate category is required
    if (!category_id) {
      return res.status(400).json({ 
        error: 'Category is required' 
      });
    }

    // Check if category exists
      const [categories] = await pool.query('SELECT id FROM categories WHERE id = ?', [category_id]);
      if (categories.length === 0) {
        return res.status(400).json({ error: 'Category not found' });
    }

    // Check if product with same name AND same sizes already exists
    // Allow same name with different sizes, but prevent exact duplicates
    const trimmedName = name.trim();
    const [existingProducts] = await pool.query(
      'SELECT id, name FROM products WHERE LOWER(name) = LOWER(?) AND is_active = 1',
      [trimmedName]
    );
    
    if (existingProducts.length > 0) {
      // Get sizes for the new product (normalize: sort and filter empty)
      const newProductSizes = sizes && Array.isArray(sizes) 
        ? sizes
            .filter(s => s.size && s.size.trim() !== '' && s.size !== 'NONE')
            .map(s => s.size.trim().toUpperCase())
            .sort()
        : [];
      
      // If new product has no sizes, treat as having 'NONE'
      const newSizesSet = newProductSizes.length === 0 ? ['NONE'] : newProductSizes;
      
      // Check each existing product for matching sizes
      for (const existingProduct of existingProducts) {
        const [existingSizes] = await pool.query(
          'SELECT size FROM product_sizes WHERE product_id = ? AND is_active = 1',
          [existingProduct.id]
        );
        
        const existingSizesList = existingSizes.length > 0
          ? existingSizes.map(s => s.size.toUpperCase()).sort()
          : ['NONE'];
        
        // Compare size sets (order doesn't matter)
        const sizesMatch = JSON.stringify(newSizesSet) === JSON.stringify(existingSizesList);
        
        if (sizesMatch) {
      return res.status(409).json({ 
            error: 'Duplicate product',
            message: `A product with the name "${trimmedName}" and the same sizes already exists. Please use different sizes or a different name.`
      });
        }
      }
    }

    // Start transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Insert product
      const [productResult] = await connection.query(
        `INSERT INTO products (name, description, price, original_price, stock, base_stock, category_id, image, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          name.trim(),
          description?.trim() || null,
          parseFloat(price),
          parseFloat(original_price),
          parseInt(stock),
          parseInt(stock), // Set base_stock = initial stock
          category_id || null,
          image?.trim() || null
        ]
      );

      const productId = productResult.insertId;

      // Store multiple images if provided
      if (images && Array.isArray(images) && images.length > 0) {
        // Ensure product_images table exists
        await ensureProductImagesTable();
        
        for (let i = 0; i < images.length; i++) {
          try {
            await connection.query(
              `INSERT INTO product_images (product_id, image_url, display_order, is_primary, created_at) 
               VALUES (?, ?, ?, ?, NOW())`,
              [productId, images[i], i, i === 0] // First image is primary
            );
          } catch (imageError) {
            // If product_images table doesn't exist, just log and continue
            console.log('Product images table not available, skipping multiple images:', imageError.message);
            break;
          }
        }
      }

      // If initial stock is provided, create initial stock transaction
      if (parseInt(stock) > 0) {
        console.log(`📦 Creating initial stock transaction for Product ID ${productId} with ${stock} units`);
        
        // Get the currently logged-in user's ID (admin who created the product)
        const createdBy = req.user?.id || null;
        
        // Insert initial stock transaction
        await connection.query(
          `INSERT INTO stock_transactions (product_id, transaction_type, quantity, reference_no, source, note, created_by, created_at)
           VALUES (?, 'IN', ?, ?, 'initial_stock', 'Initial stock for new product', ?, NOW())`,
          [productId, parseInt(stock), `INIT-${productId}`, createdBy]
        );

        // Initialize stock balance
        await connection.query(
          `INSERT INTO stock_balance (product_id, qty, updated_at)
           VALUES (?, ?, NOW())
           ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty), updated_at = NOW()`,
          [productId, parseInt(stock)]
        );

        console.log(`✅ Initial stock transaction created for Product ID ${productId}`);
      }

    // Store sizes in product_sizes table
    console.log('🔍 Processing sizes:', sizes);
    if (sizes && Array.isArray(sizes) && sizes.length > 0) {
      // Validate that total size stock does not exceed base stock
      const totalSizeStock = sizes.reduce((total, sizeItem) => {
        if (sizeItem.size && sizeItem.size.trim() !== '') {
          return total + (parseInt(sizeItem.stock) || 0);
        }
        return total;
      }, 0);

      if (totalSizeStock > parseInt(stock)) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({ 
          error: `Total size stock (${totalSizeStock}) cannot exceed base stock (${stock}). Please adjust the size quantities.` 
        });
      }

      // Validate: If base stock is fully allocated and there's a size without quantity, reject
      const baseStock = parseInt(stock);
      if (totalSizeStock === baseStock && baseStock > 0) {
        const sizesWithNoStock = sizes.filter(sizeItem => {
          if (!sizeItem.size || sizeItem.size.trim() === '' || sizeItem.size === 'NONE') {
            return false;
          }
          const sizeStock = parseInt(sizeItem.stock) || 0;
          return sizeStock === 0;
        });

        if (sizesWithNoStock.length > 0) {
          await connection.rollback();
          connection.release();
          const sizesToRemove = sizesWithNoStock.map(s => s.size).join(', ');
          return res.status(400).json({ 
            error: `Base stock (${baseStock}) is fully allocated. Please remove size(s) without quantity: ${sizesToRemove}.` 
          });
        }
      }

      for (const sizeItem of sizes) {
        console.log('🔍 Processing size item:', sizeItem);
        if (sizeItem.size && sizeItem.size.trim() !== '') {
          const sizeStock = parseInt(sizeItem.stock) || parseInt(stock);
          await connection.query(
            `INSERT INTO product_sizes (product_id, size, stock, base_stock, price, is_active) 
             VALUES (?, ?, ?, ?, ?, TRUE)`,
            [
              productId,
              sizeItem.size.trim(),
              sizeStock, // Use size-specific stock or fallback to base stock
              sizeStock, // Set base_stock = initial stock for this size
              parseFloat(sizeItem.price) || parseFloat(price) // Use size-specific price or fallback to base price
            ]
          );
          console.log(`✅ Size ${sizeItem.size} stored for product ${productId}`);
        }
      }
      console.log(`Product ${productId} created with ${sizes.length} sizes stored in product_sizes table`);
    } else {
      console.log('🔍 No sizes to store for product', productId);
    }

      await connection.commit();
      connection.release();

      // Emit refresh signal for new product
      const io = req.app.get('io');
      if (io) {
        // Emit specific new-product event to all users (admin and regular users)
        io.emit('new-product', {
          productId,
          name,
          action: 'created',
          timestamp: new Date().toISOString()
        });
        // Also emit to admin room specifically
        io.to('admin-room').emit('new-product', {
          productId,
          name,
          action: 'created',
          timestamp: new Date().toISOString()
        });
        console.log(`📦 Real-time new product event sent for product ${productId}`);
        
        // Also emit general data refresh signals
        emitAdminDataRefresh(io, 'products', { action: 'created', productId });
        emitDataRefresh(io, 'products', { action: 'created', productId });
      }

      res.status(201).json({ 
        message: 'Product created successfully', 
        productId: productId 
      });
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
  } catch (error) {
    console.error('Create Product Error:', error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// ✅ Get All Products with pagination and filtering
export const getAllProducts = async (req, res) => {
  try {
    // Ensure deleted_at column exists
    await ensureDeletedAtColumn();
    
    const { page = 1, limit = 10, category, search, minPrice, maxPrice, inStock, includeInactive } = req.query;
    
    // Validate pagination
    const { page: validPage, limit: validLimit } = validatePagination(page, limit);
    const offset = (validPage - 1) * validLimit;

    // Build query conditions
    let whereConditions = [];
    let queryParams = [];

    if (category) {
      // Filter by category name
      whereConditions.push('UPPER(c.name) = UPPER(?)');
      queryParams.push(category.trim());
    }

    if (search) {
      whereConditions.push('(p.name LIKE ? OR p.description LIKE ?)');
      queryParams.push(`%${search}%`, `%${search}%`);
    }

    if (minPrice) {
      whereConditions.push('p.price >= ?');
      queryParams.push(parseFloat(minPrice));
    }

    if (maxPrice) {
      whereConditions.push('p.price <= ?');
      queryParams.push(parseFloat(maxPrice));
    }

    if (inStock === 'true') {
      whereConditions.push('p.stock > 0');
    }

    // Exclude deleted products (soft delete) - only if column exists
    // Check if deleted_at column exists before adding condition
    try {
      const [columns] = await pool.query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'deleted_at'
      `);
      if (columns.length > 0) {
        whereConditions.push('p.deleted_at IS NULL');
      }
    } catch (err) {
      // Column doesn't exist yet, continue without the condition
      console.log('deleted_at column not found, skipping filter');
    }
    
    // Only exclude inactive products if includeInactive is not set to 'true'
    // This allows admin to see all products including inactive ones
    if (includeInactive !== 'true') {
    whereConditions.push('p.is_active = 1');
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Get total count for pagination
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM products p LEFT JOIN categories c ON p.category_id = c.id ${whereClause}`,
      queryParams
    );
    const totalProducts = countResult[0].total;

    // Get products with pagination
    const [products] = await pool.query(
      `SELECT p.*, c.name AS category_name
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       ${whereClause}
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [...queryParams, validLimit, offset]
    );

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
            sizes: sizes.map(size => ({
              id: size.id,
              size: size.size,
              stock: parseInt(size.stock) || 0, // Use size-specific stock, default to 0 if NULL
              base_stock: parseInt(size.base_stock) || 0,
              price: parseFloat(size.price)
            }))
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
      products: productsWithSizes,
      pagination: {
        currentPage: validPage,
        totalPages: Math.ceil(totalProducts / validLimit),
        totalProducts,
        hasNextPage: validPage < Math.ceil(totalProducts / validLimit),
        hasPrevPage: validPage > 1
      }
    });
  } catch (err) {
    console.error('Get Products Error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// ✅ Get Product by ID
export const getProductById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  try {
    // Ensure deleted_at column exists
    await ensureDeletedAtColumn();
    
    const validatedId = validateId(id);
    
    // Build WHERE clause conditionally
    let whereClause = 'WHERE p.id = ?';
    try {
      const [columns] = await pool.query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'deleted_at'
      `);
      if (columns.length > 0) {
        whereClause += ' AND p.deleted_at IS NULL';
      }
    } catch (err) {
      // Column doesn't exist yet, continue without the condition
    }
    
    const [rows] = await pool.query(`
      SELECT p.*, c.name AS category_name 
      FROM products p 
      LEFT JOIN categories c ON p.category_id = c.id 
      ${whereClause}
    `, [validatedId]);

    if (rows.length === 0) {
      throw new NotFoundError('Product');
    }

    const product = rows[0];
    
    // Try to get product sizes if the table exists, otherwise set empty array
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
        [validatedId]
      );
      product.sizes = sizes.map(size => ({
        id: size.id,
        size: size.size,
        stock: parseInt(size.stock) || 0, // Use size-specific stock, default to 0 if NULL
        base_stock: parseInt(size.base_stock) || 0,
        price: parseFloat(size.price) || 0,
        is_active: size.is_active
      }));
    } catch (sizeError) {
      // If product_sizes table doesn't exist, just set empty array
      logger.debug('Product sizes table not available, setting empty array');
      product.sizes = [];
    }

    // Try to get product images if the table exists
    try {
      // Ensure product_images table exists
      await ensureProductImagesTable();
      
      const [images] = await pool.query(
        `SELECT id, image_url, display_order, is_primary 
         FROM product_images 
         WHERE product_id = ? 
         ORDER BY is_primary DESC, display_order ASC, id ASC`,
        [validatedId]
      );
      product.images = images.map(img => ({
        id: img.id,
        url: img.image_url,
        is_primary: img.is_primary === 1 || img.is_primary === true,
        display_order: img.display_order || 0
      }));
    } catch (imageError) {
      // If product_images table doesn't exist, use single image field
      logger.debug('Product images table not available, using single image field');
      product.images = product.image ? [{ id: 'primary', url: product.image, is_primary: true }] : [];
    }

    logger.info('Product retrieved successfully', { productId: validatedId });
    res.json(product);
  } catch (error) {
    if (error instanceof ValidationError || error instanceof NotFoundError) {
      throw error;
    }
    logger.error('Get Product Error', error, { productId: id });
    throw new AppError('Failed to retrieve product');
  }
});

// ✅ Get Product by Name
export const getProductByName = async (req, res) => {
  try {
    const { name } = req.params;
    
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Product name is required' });
    }

    const [rows] = await pool.query(`
      SELECT p.*, c.name AS category_name 
      FROM products p 
      LEFT JOIN categories c ON p.category_id = c.id 
      WHERE p.name = ?
    `, [name.trim()]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = rows[0];
    
    // Try to get product sizes if the table exists, otherwise set empty array
    try {
      const [sizes] = await pool.query(
        `SELECT id, size, stock, price, is_active 
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
      product.sizes = sizes.map(size => ({
        id: size.id,
        size: size.size,
        stock: parseInt(size.stock) || 0, // Use size-specific stock, default to 0 if NULL
        price: parseFloat(size.price) || 0
      }));
    } catch (sizeError) {
      // If product_sizes table doesn't exist, just set empty array
      console.log('Product sizes table not available, setting empty array');
      product.sizes = [];
    }

    res.json(product);
  } catch (error) {
    console.error('Get Product by Name Error:', error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// ✅ Update product (admin only)
export const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, price, original_price, stock, sizes, category_id, image, is_active } = req.body;

    if (!validateId(id)) {
      return res.status(400).json({ error: 'Invalid product ID' });
    }

    // Check if product exists and get current stock (exclude deleted)
    const [existing] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const oldStock = existing[0].stock;
    const userId = req.user?.id || 1; // Get user ID from auth middleware

    // Validate input fields
    if (name && !validateName(name)) {
      return res.status(400).json({ 
        error: 'Name must be 2-50 characters long' 
      });
    }

    if (price !== undefined && !validatePrice(price)) {
      return res.status(400).json({ 
        error: 'Valid selling price is required' 
      });
    }

    if (original_price !== undefined && !validatePrice(original_price)) {
      return res.status(400).json({ 
        error: 'Valid cost price is required' 
      });
    }

    if (price !== undefined && original_price !== undefined && Number(price) <= Number(original_price)) {
      return res.status(400).json({ 
        error: 'Selling price must be higher than cost price' 
      });
    }

    if (stock !== undefined && !validateStock(stock)) {
      return res.status(400).json({ 
        error: 'Valid stock quantity is required' 
      });
    }

    if (image && !validateImageUrl(image)) {
      return res.status(400).json({ 
        error: 'Invalid image URL format' 
      });
    }

    // Check if category exists if provided
    if (category_id) {
      const [categories] = await pool.query('SELECT id FROM categories WHERE id = ?', [category_id]);
      if (categories.length === 0) {
        return res.status(400).json({ error: 'Category not found' });
      }
    }

    // Check if product with same name AND same sizes already exists (excluding current product)
    // Allow same name with different sizes, but prevent exact duplicates
    if (name !== undefined) {
      const trimmedName = name.trim();
      const [existingProducts] = await pool.query(
        'SELECT id, name FROM products WHERE LOWER(name) = LOWER(?) AND is_active = 1 AND id != ?',
        [trimmedName, id]
      );
      
      if (existingProducts.length > 0) {
        // Get sizes for the updated product
        // If sizes are provided in the update, use those; otherwise get current sizes
        let updatedProductSizes = [];
        
        if (sizes !== undefined && Array.isArray(sizes)) {
          // Use provided sizes
          updatedProductSizes = sizes
            .filter(s => s.size && s.size.trim() !== '' && s.size !== 'NONE')
            .map(s => s.size.trim().toUpperCase())
            .sort();
        } else {
          // Get current sizes from database
          const [currentSizes] = await pool.query(
            'SELECT size FROM product_sizes WHERE product_id = ? AND is_active = 1',
            [id]
          );
          updatedProductSizes = currentSizes.length > 0
            ? currentSizes.map(s => s.size.toUpperCase()).sort()
            : [];
        }
        
        // If updated product has no sizes, treat as having 'NONE'
        const newSizesSet = updatedProductSizes.length === 0 ? ['NONE'] : updatedProductSizes;
        
        // Check each existing product for matching sizes
        for (const existingProduct of existingProducts) {
          const [existingSizes] = await pool.query(
            'SELECT size FROM product_sizes WHERE product_id = ? AND is_active = 1',
            [existingProduct.id]
          );
          
          const existingSizesList = existingSizes.length > 0
            ? existingSizes.map(s => s.size.toUpperCase()).sort()
            : ['NONE'];
          
          // Compare size sets (order doesn't matter)
          const sizesMatch = JSON.stringify(newSizesSet) === JSON.stringify(existingSizesList);
          
          if (sizesMatch) {
        return res.status(409).json({ 
              error: 'Duplicate product',
              message: `A product with the name "${trimmedName}" and the same sizes already exists. Please use different sizes or a different name.`
        });
          }
        }
      }
    }

    // Start transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Build update query dynamically
      const updateFields = [];
      const updateValues = [];

      if (name !== undefined) {
        updateFields.push('name = ?');
        updateValues.push(name.trim());
      }

      if (description !== undefined) {
        updateFields.push('description = ?');
        updateValues.push(description?.trim() || null);
      }

      if (price !== undefined) {
        // IMPORTANT: Updating product price only affects future sales.
        // Historical sales prices are locked in order_items.unit_price and will NEVER change.
        // This ensures accurate historical sales reporting and revenue tracking.
        updateFields.push('price = ?');
        updateValues.push(parseFloat(price));
      }

      if (original_price !== undefined) {
        updateFields.push('original_price = ?');
        updateValues.push(parseFloat(original_price));
      }

      if (stock !== undefined) {
        updateFields.push('stock = ?');
        updateValues.push(parseInt(stock));
      }

      if (category_id !== undefined) {
        updateFields.push('category_id = ?');
        updateValues.push(category_id || null);
      }

      if (image !== undefined) {
        updateFields.push('image = ?');
        updateValues.push(image?.trim() || null);
      }

      if (is_active !== undefined) {
        updateFields.push('is_active = ?');
        updateValues.push(is_active === true || is_active === 1 || is_active === 'true' ? 1 : 0);
      }

      updateValues.push(id);

      // Update product
      if (updateFields.length > 0) {
        await connection.query(
          `UPDATE products SET ${updateFields.join(', ')} WHERE id = ?`,
          updateValues
        );
      }

      // Handle multiple images if provided
      if (req.body.images && typeof req.body.images === 'object') {
        try {
          // Ensure product_images table exists
          const tableExists = await ensureProductImagesTable();
          if (!tableExists) {
            console.warn('⚠️ product_images table does not exist, skipping image updates');
          } else {
            const { add = [], remove = [], existing = [] } = req.body.images;
            
            // Remove images (only if remove array has valid IDs)
            if (remove && Array.isArray(remove) && remove.length > 0) {
              // Filter out invalid IDs (non-numeric or string 'primary')
              const validRemoveIds = remove.filter(id => {
                // Allow numeric IDs or convert string numbers
                const numId = typeof id === 'string' && id !== 'primary' ? parseInt(id) : id;
                return !isNaN(numId) && numId > 0;
              });
              
              if (validRemoveIds.length > 0) {
                await connection.query(
                  'DELETE FROM product_images WHERE id IN (?) AND product_id = ?',
                  [validRemoveIds, id]
                );
                console.log(`✅ Removed ${validRemoveIds.length} images for product ${id}`);
              }
            }
            
            // Add new images
            if (add && Array.isArray(add) && add.length > 0) {
              // Get current max display_order for this product
              const [maxOrderResult] = await connection.query(
                'SELECT COALESCE(MAX(display_order), -1) as max_order FROM product_images WHERE product_id = ?',
                [id]
              );
              const maxOrder = maxOrderResult[0]?.max_order || -1;
              
              // Check if there are any existing images (to determine if first new image should be primary)
              const [existingCount] = await connection.query(
                'SELECT COUNT(*) as count FROM product_images WHERE product_id = ?',
                [id]
              );
              const hasExistingImages = existingCount[0]?.count > 0;
              
              for (let i = 0; i < add.length; i++) {
                const imageUrl = typeof add[i] === 'string' ? add[i] : add[i].url || add[i];
                if (!imageUrl || !imageUrl.trim()) {
                  console.warn(`⚠️ Skipping invalid image URL at index ${i}`);
                  continue;
                }
                
                const displayOrder = maxOrder + 1 + i;
                const isPrimary = i === 0 && !hasExistingImages && existing.length === 0;
                
                await connection.query(
                  `INSERT INTO product_images (product_id, image_url, display_order, is_primary, created_at) 
                   VALUES (?, ?, ?, ?, NOW())`,
                  [id, imageUrl.trim(), displayOrder, isPrimary ? 1 : 0]
                );
              }
              console.log(`✅ Added ${add.length} new images for product ${id}`);
            }
            
            // Update existing images (set primary)
            if (existing && Array.isArray(existing) && existing.length > 0) {
              // First, unset all primary flags for this product
              await connection.query(
                'UPDATE product_images SET is_primary = FALSE WHERE product_id = ?',
                [id]
              );
              
              // Set primary for specified images
              let primarySet = false;
              for (const img of existing) {
                if (img && img.is_primary) {
                  // Handle both numeric IDs and string IDs (including 'primary')
                  let imgId = img.id;
                  if (imgId === 'primary' || imgId === undefined) {
                    // If ID is 'primary' or undefined, find the first existing image
                    const [firstImg] = await connection.query(
                      'SELECT id FROM product_images WHERE product_id = ? ORDER BY display_order ASC LIMIT 1',
                      [id]
                    );
                    if (firstImg.length > 0) {
                      imgId = firstImg[0].id;
                    } else {
                      continue; // No images to set as primary
                    }
                  } else {
                    // Convert string ID to number if needed
                    imgId = typeof imgId === 'string' ? parseInt(imgId) : imgId;
                    if (isNaN(imgId) || imgId <= 0) {
                      console.warn(`⚠️ Invalid image ID: ${img.id}`);
                      continue;
                    }
                  }
                  
                  await connection.query(
                    'UPDATE product_images SET is_primary = TRUE WHERE id = ? AND product_id = ?',
                    [imgId, id]
                  );
                  primarySet = true;
                  console.log(`✅ Set image ${imgId} as primary for product ${id}`);
                  break; // Only one primary image
                }
              }
              
              // If no primary was set but there are existing images, set the first one as primary
              if (!primarySet) {
                const [firstImg] = await connection.query(
                  'SELECT id FROM product_images WHERE product_id = ? ORDER BY display_order ASC LIMIT 1',
                  [id]
                );
                if (firstImg.length > 0) {
                  await connection.query(
                    'UPDATE product_images SET is_primary = TRUE WHERE id = ? AND product_id = ?',
                    [firstImg[0].id, id]
                  );
                  console.log(`✅ Auto-set first image as primary for product ${id}`);
                }
              }
            }
          }
        } catch (imageError) {
          console.error('❌ Error handling product images:', imageError);
          console.error('Image error details:', {
            message: imageError.message,
            stack: imageError.stack,
            body: req.body.images
          });
          // Don't fail the whole update if image handling fails, but log the error
          // The product update will still succeed
        }
      }

      // Update product sizes if provided
      if (sizes && Array.isArray(sizes)) {
        // Get existing sizes to preserve base_stock and stock
        const [existingSizes] = await connection.query(
          'SELECT size, stock, base_stock FROM product_sizes WHERE product_id = ?',
          [id]
        );
        const existingSizeData = {};
        existingSizes.forEach(s => {
          existingSizeData[s.size.toUpperCase()] = {
            stock: s.stock,
            base_stock: s.base_stock
          };
        });

        // Delete existing sizes
        await connection.query('DELETE FROM product_sizes WHERE product_id = ?', [id]);

        // Insert new sizes
        for (const sizeData of sizes) {
          if (!validateSize(sizeData.size)) {
            throw new Error(`Invalid size: ${sizeData.size}. Valid sizes are: XXS, XS, S, M, L, XL, XXL, NONE`);
          }

          const sizeKey = sizeData.size.toUpperCase();
          const existingData = existingSizeData[sizeKey];
          
          // Preserve existing stock and base_stock, or use 0 for new sizes
          const sizeStock = existingData ? existingData.stock : 0;
          const baseStock = existingData ? existingData.base_stock : 0;

          await connection.query(
            `INSERT INTO product_sizes (product_id, size, stock, base_stock, price, is_active) VALUES (?, ?, ?, ?, ?, TRUE)`,
            [id, sizeKey, sizeStock, baseStock, parseFloat(sizeData.price) || parseFloat(price), 1]
          );
        }
      }

      await connection.commit();
      connection.release();

      // Record stock movement if stock changed
      if (stock !== undefined && stock !== oldStock) {
        const stockDifference = stock - oldStock;
        const movementType = stockDifference > 0 ? 'stock_in' : 'stock_out';
        const quantity = Math.abs(stockDifference);
        const reason = stockDifference > 0 ? 'restock' : 'adjustment';

        try {
          await pool.query(`
            INSERT INTO stock_movements 
            (product_id, user_id, movement_type, quantity, previous_stock, new_stock, reason, notes, created_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
          `, [
            id,
            userId,
            movementType,
            quantity,
            oldStock,
            stock,
            reason,
            `Stock updated from ${oldStock} to ${stock}`
          ]);

          console.log(`📦 Stock movement recorded: Product ${id}, ${movementType}, Quantity: ${quantity}, Old: ${oldStock}, New: ${stock}`);
        } catch (movementError) {
          console.error('❌ Failed to record stock movement:', movementError);
          // Don't fail the whole update if stock movement recording fails
        }
      }

      // Emit refresh signal for updated product
      const io = req.app.get('io');
      if (io) {
        // Emit specific product-updated event to all users
        io.emit('product-updated', {
          productId: id,
          name: name || existing[0].name,
          action: 'updated',
          timestamp: new Date().toISOString()
        });
        console.log(`📦 Real-time product update event sent for product ${id}`);
        
        // Also emit general data refresh signals
        emitAdminDataRefresh(io, 'products', { action: 'updated', productId: id });
        emitDataRefresh(io, 'products', { action: 'updated', productId: id });
      }

      res.json({ message: 'Product updated successfully' });
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
  } catch (err) {
    console.error('❌ Update product error:', err.message);
    console.error('Stack:', err.stack);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
};

// ✅ Delete Product
export const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    if (!validateId(id)) {
      return res.status(400).json({ error: 'Invalid product ID' });
    }

    // Check if product exists (exclude deleted)
    const [existing] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Check if product is in any active cart
    const [cartItems] = await pool.query('SELECT id FROM cart_items WHERE product_id = ?', [id]);
    if (cartItems.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete product that is in active carts' 
      });
    }

    // Note: We allow deletion even if product has order history
    // Order history will be preserved as order_items contains product_name, price, etc.

    // Start transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Check if deleted_at column exists, if not add it
      try {
        const [columns] = await connection.query(`
          SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'deleted_at'
        `);
        if (columns.length === 0) {
          console.log('🔧 Adding deleted_at column to products table...');
          await connection.query('ALTER TABLE products ADD COLUMN deleted_at DATETIME NULL AFTER updated_at');
          await connection.query('ALTER TABLE products ADD INDEX idx_deleted_at (deleted_at)');
          console.log('✅ deleted_at column added successfully.');
        }
      } catch (alterError) {
        console.error('Error checking/adding deleted_at column:', alterError);
        // Continue with deletion even if column addition fails
      }

      // Soft delete product by setting deleted_at timestamp
      // Keep is_active for visibility toggle (separate from deletion)
      // Check if deleted_at column exists before using it
      let updateQuery = 'UPDATE products SET is_active = 0 WHERE id = ?';
      const [colCheck] = await connection.query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'deleted_at'
      `);
      if (colCheck.length > 0) {
        updateQuery = 'UPDATE products SET deleted_at = NOW(), is_active = 0 WHERE id = ? AND deleted_at IS NULL';
      }
      
      const [result] = await connection.query(updateQuery, [id]);

      if (result.affectedRows === 0) {
        throw new Error('Product not found or already deleted');
      }

      await connection.commit();
      connection.release();

      // Emit refresh signal for deleted product
      const io = req.app.get('io');
      if (io) {
        // Emit specific product-deleted event to all users
        io.emit('product-deleted', {
          productId: id,
          action: 'deleted',
          timestamp: new Date().toISOString()
        });
        console.log(`🗑️ Real-time product deletion event sent for product ${id}`);
        
        // Also emit general data refresh signals
        emitAdminDataRefresh(io, 'products', { action: 'deleted', productId: id });
        emitDataRefresh(io, 'products', { action: 'deleted', productId: id });
      }

      res.json({ message: 'Product deleted successfully' });
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
  } catch (error) {
    console.error('Delete Product Error:', error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};


// ✅ Get Low Stock Products (for Admin Alerts)
export const getLowStockProducts = async (req, res) => {
  try {
    // First get products with low base stock
    const [baseStockProducts] = await pool.query(`
      SELECT p.*, c.name AS category_name 
      FROM products p 
      LEFT JOIN categories c ON p.category_id = c.id 
      WHERE p.stock <= ? 
      ORDER BY p.stock ASC
    `, [LOW_STOCK_THRESHOLD]);

    // Get all products with their sizes to check for size-specific low stock
    const [allProducts] = await pool.query(`
      SELECT p.*, c.name AS category_name 
      FROM products p 
      LEFT JOIN categories c ON p.category_id = c.id 
      WHERE p.is_active = 1
      ORDER BY p.stock ASC
    `);

    // Get product sizes for all products
    const productsWithSizes = await Promise.all(
      allProducts.map(async (product) => {
        const [sizes] = await pool.query(
          'SELECT * FROM product_sizes WHERE product_id = ? AND is_active = 1',
          [product.id]
        );
        return {
          ...product,
          sizes: sizes
        };
      })
    );

    // Filter for products with low stock (either base stock or any size stock)
    const lowStockProducts = productsWithSizes.filter(product => {
      // Check base stock
      if (Number(product.stock) <= LOW_STOCK_THRESHOLD) {
        return true;
      }
      
      // Check if any size has low stock
      if (product.sizes && product.sizes.length > 0) {
        return product.sizes.some(size => Number(size.stock) <= LOW_STOCK_THRESHOLD);
      }
      
      return false;
    });

    res.json({
      products: lowStockProducts,
      threshold: LOW_STOCK_THRESHOLD,
      count: lowStockProducts.length
    });
  } catch (error) {
    console.error('Low Stock Check Error:', error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// ✅ Get Product Statistics
export const getProductStats = async (req, res) => {
  try {
    const [stats] = await pool.query(`
      SELECT 
        COUNT(*) as totalProducts,
        COUNT(CASE WHEN stock = 0 THEN 1 END) as outOfStock,
        COUNT(CASE WHEN stock <= ? THEN 1 END) as lowStock,
        SUM(stock) as totalStock,
        AVG(price) as averagePrice,
        MIN(price) as minPrice,
        MAX(price) as maxPrice
      FROM products
    `, [LOW_STOCK_THRESHOLD]);

    res.json(stats[0]);
  } catch (error) {
    console.error('Get Product Stats Error:', error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// ✅ Get inventory summary
export const getInventorySummary = async (req, res) => {
  try {
    const [summary] = await pool.query(`
      SELECT 
        COUNT(*) as total_products,
        SUM(stock) as total_stock,
        SUM(CASE WHEN stock <= ? THEN 1 ELSE 0 END) as low_stock_count,
        SUM(CASE WHEN stock = 0 THEN 1 ELSE 0 END) as out_of_stock_count,
        SUM(stock * price) as total_inventory_value
      FROM products
    `, [LOW_STOCK_THRESHOLD]);

    const [categoryStats] = await pool.query(`
      SELECT 
        c.name as category,
        COUNT(p.id) as product_count,
        SUM(p.stock) as total_stock,
        AVG(p.price) as avg_price
      FROM categories c
      LEFT JOIN products p ON c.id = p.category_id
      GROUP BY c.id, c.name
      ORDER BY product_count DESC
    `);

    res.json({
      summary: summary[0],
      categoryStats,
      lowStockThreshold: LOW_STOCK_THRESHOLD
    });
  } catch (err) {
    console.error('Get inventory summary error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// ✅ Update product stock
export const updateProductStock = async (req, res) => {
  try {
    const { id } = req.params;
    const { stock, reason, movement_type } = req.body;
    const userId = req.user?.id || 1; // Get user ID from auth middleware, default to 1 if not available

    if (!stock || !reason || !movement_type) {
      return res.status(400).json({ 
        error: 'Stock, reason, and movement type are required' 
      });
    }

    if (!Object.values(STOCK_MOVEMENT_TYPES).includes(movement_type)) {
      return res.status(400).json({ error: 'Invalid movement type' });
    }

    // Get current stock (exclude deleted)
    const [currentProduct] = await pool.query(
      'SELECT stock FROM products WHERE id = ?',
      [id]
    );

    if (currentProduct.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const currentStock = currentProduct[0].stock;
    const newStock = Math.max(0, currentStock + stock); // Prevent negative stock

    // Update product stock
    await pool.query(
      'UPDATE products SET stock = ?, updated_at = NOW() WHERE id = ?',
      [newStock, id]
    );

    // Log stock movement with user_id
    await pool.query(`
      INSERT INTO stock_movements (product_id, user_id, movement_type, quantity, previous_stock, new_stock, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
    `, [id, userId, movement_type, stock, currentStock, newStock, reason]);

    console.log(`📦 Stock movement recorded: Product ${id}, Type: ${movement_type}, Quantity: ${stock}, User: ${userId}`);

    res.json({ 
      message: 'Stock updated successfully',
      previousStock: currentStock,
      newStock: newStock,
      change: stock
    });
  } catch (err) {
    console.error('Update product stock error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// ✅ Get stock movement history
export const getStockMovementHistory = async (req, res) => {
  try {
    const { product_id, movement_type, start_date, end_date, page = 1, limit = 20 } = req.query;
    
    let whereClause = 'WHERE 1=1';
    const params = [];
    
    if (product_id) {
      whereClause += ' AND sm.product_id = ?';
      params.push(product_id);
    }
    
    if (movement_type) {
      whereClause += ' AND sm.movement_type = ?';
      params.push(movement_type);
    }
    
    if (start_date) {
      whereClause += ' AND DATE(sm.created_at) >= ?';
      params.push(start_date);
    }
    
    if (end_date) {
      whereClause += ' AND DATE(sm.created_at) <= ?';
      params.push(end_date);
    }

    const offset = (page - 1) * limit;
    
    const [movements] = await pool.query(`
      SELECT 
        sm.id,
        sm.movement_type,
        sm.quantity,
        sm.previous_stock,
        sm.new_stock,
        sm.reason,
        sm.created_at,
        p.name as product_name,
        p.image as product_image
      FROM stock_movements sm
      JOIN products p ON sm.product_id = p.id
      ${whereClause}
      ORDER BY sm.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const [total] = await pool.query(`
      SELECT COUNT(*) as total
      FROM stock_movements sm
      ${whereClause}
    `, params);

    res.json({
      movements,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total[0].total,
        totalPages: Math.ceil(total[0].total / limit)
      }
    });
  } catch (err) {
    console.error('Get stock movement history error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// ✅ Get Product Sizes
export const getProductSizes = async (req, res) => {
  try {
    const { id } = req.params;

    if (!validateId(id)) {
      return res.status(400).json({ error: 'Invalid product ID' });
    }

    // Check if product exists (exclude deleted)
    const [products] = await pool.query(
      'SELECT id, name FROM products WHERE id = ? AND is_active = 1',
      [id]
    );

    if (products.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Get all sizes for this product
    const [sizes] = await pool.query(
      `SELECT id, size, stock, price, is_active 
       FROM product_sizes 
       WHERE product_id = ? AND is_active = 1
       ORDER BY 
         CASE size
           WHEN 'XS' THEN 1
           WHEN 'S' THEN 2
           WHEN 'M' THEN 3
           WHEN 'L' THEN 4
           WHEN 'XL' THEN 5
           WHEN 'XXL' THEN 6
           ELSE 7
         END`,
      [id]
    );

    res.json(sizes);
  } catch (err) {
    console.error('Get product sizes error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};
