-- Migration: Add product_images table
-- This script safely adds the product_images table if it doesn't exist

USE capstone;

-- Check if table exists, if not create it
CREATE TABLE IF NOT EXISTS product_images (
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
);

SELECT 'product_images table created successfully!' AS message;

