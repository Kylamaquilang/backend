-- Migration: Add size_id column to stock_movements table if it doesn't exist
-- This allows tracking which specific size was restocked/deducted
-- Run this if you have an existing database that needs the size_id column added

-- Check if the column exists, if not add it
SET @dbname = DATABASE();
SET @tablename = "stock_movements";
SET @columnname = "size_id";
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      (table_name = @tablename)
      AND (table_schema = @dbname)
      AND (column_name = @columnname)
  ) > 0,
  "SELECT 1",
  CONCAT("ALTER TABLE ", @tablename, " ADD COLUMN ", @columnname, " INT NULL AFTER product_id")
));

PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Add foreign key constraint if not exists
SET @preparedStatement2 = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE
      table_schema = @dbname
      AND table_name = @tablename
      AND column_name = @columnname
      AND constraint_name LIKE 'stock_movements_ibfk_%'
  ) > 0,
  "SELECT 1",
  CONCAT("ALTER TABLE ", @tablename, " ADD CONSTRAINT fk_stock_movements_size FOREIGN KEY (", @columnname, ") REFERENCES product_sizes(id) ON DELETE SET NULL")
));

PREPARE addFkIfNotExists FROM @preparedStatement2;
EXECUTE addFkIfNotExists;
DEALLOCATE PREPARE addFkIfNotExists;

-- Add index if not exists
SET @preparedStatement3 = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE
      table_schema = @dbname
      AND table_name = @tablename
      AND column_name = @columnname
      AND index_name = 'idx_stock_movements_size'
  ) > 0,
  "SELECT 1",
  CONCAT("CREATE INDEX idx_stock_movements_size ON ", @tablename, " (", @columnname, ")")
));

PREPARE addIndexIfNotExists FROM @preparedStatement3;
EXECUTE addIndexIfNotExists;
DEALLOCATE PREPARE addIndexIfNotExists;

SELECT 'Migration completed: size_id column added to stock_movements table (if it was missing)' as message;
















