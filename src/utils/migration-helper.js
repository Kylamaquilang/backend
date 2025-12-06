import { pool } from '../database/db.js';

let deletedAtColumnChecked = false;

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

