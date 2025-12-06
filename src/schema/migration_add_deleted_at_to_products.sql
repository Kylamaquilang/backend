-- Migration: Add deleted_at column to products table for soft delete
-- This allows products to be deleted while preserving data for reports

-- Check if column exists, if not add it
SET @dbname = DATABASE();
SET @tablename = 'products';
SET @columnname = 'deleted_at';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      (TABLE_SCHEMA = @dbname)
      AND (TABLE_NAME = @tablename)
      AND (COLUMN_NAME = @columnname)
  ) > 0,
  'SELECT 1', -- Column exists, do nothing
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' DATETIME NULL AFTER updated_at')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Add index for deleted_at for better query performance
CREATE INDEX IF NOT EXISTS idx_deleted_at ON products(deleted_at);

