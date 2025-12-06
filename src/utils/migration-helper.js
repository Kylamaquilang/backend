import { pool } from '../database/db.js';

let deletedAtColumnChecked = false;
let productImagesTableChecked = false;

/**
 * Ensures the deleted_at column exists in the products table
 * This is called automatically on first use
 */
export const ensureDeletedAtColumn = async () => {
  if (deletedAtColumnChecked) {
    return true; // Already checked
  }

  try {
    const [columns] = await pool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'deleted_at'
    `);
    
    if (columns.length === 0) {
      console.log('🔧 Adding deleted_at column to products table...');
      await pool.query('ALTER TABLE products ADD COLUMN deleted_at DATETIME NULL AFTER updated_at');
      await pool.query('ALTER TABLE products ADD INDEX idx_deleted_at (deleted_at)');
      console.log('✅ deleted_at column added successfully.');
    }
    
    deletedAtColumnChecked = true;
    return true;
  } catch (error) {
    console.error('Error checking/adding deleted_at column:', error);
    // Don't throw - allow queries to continue (they'll handle missing column gracefully)
    return false;
  }
};

/**
 * Ensures the product_images table exists
 * This is called automatically on first use
 */
export const ensureProductImagesTable = async () => {
  if (productImagesTableChecked) {
    return true; // Already checked
  }

  try {
    const [tables] = await pool.query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_images'
    `);
    
    if (tables.length === 0) {
      console.log('🔧 Creating product_images table...');
      await pool.query(`
        CREATE TABLE product_images (
          id INT AUTO_INCREMENT PRIMARY KEY,
          product_id INT NOT NULL,
          image_url VARCHAR(255) NOT NULL,
          display_order INT DEFAULT 0,
          is_primary BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
          INDEX idx_product_id_images (product_id),
          INDEX idx_display_order (display_order),
          INDEX idx_is_primary (is_primary)
        )
      `);
      console.log('✅ product_images table created successfully.');
    }
    
    productImagesTableChecked = true;
    return true;
  } catch (error) {
    console.error('Error checking/creating product_images table:', error);
    // Don't throw - allow queries to continue (they'll handle missing table gracefully)
    return false;
  }
};

/**
 * Gets the deleted_at condition for WHERE clauses
 * Returns empty string if column doesn't exist, otherwise returns the condition
 */
export const getDeletedAtCondition = async () => {
  try {
    await ensureDeletedAtColumn();
    return 'AND p.deleted_at IS NULL';
  } catch (error) {
    // If column doesn't exist, return empty string (no filter)
    return '';
  }
};

/**
 * Gets the deleted_at condition for WHERE clauses (synchronous version)
 * Use this when you're sure the column exists
 */
export const getDeletedAtConditionSync = () => {
  return 'AND p.deleted_at IS NULL';
};

/**
 * Safely adds deleted_at condition to WHERE clause if column exists
 * Returns the condition string or empty string
 */
export const getDeletedAtConditionSafe = async () => {
  try {
    const [columns] = await pool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'deleted_at'
    `);
    if (columns.length > 0) {
      return 'AND p.deleted_at IS NULL';
    }
    return '';
  } catch (error) {
    return '';
  }
};

