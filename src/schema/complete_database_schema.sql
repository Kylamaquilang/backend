-- =====================================================
-- CPC ESSEN CAPSTONE PROJECT - COMPLETE DATABASE SCHEMA
-- =====================================================
-- This file contains the complete database schema for the CPC Essen system
-- Includes: Users, Products, Orders, Stock Management, Payments, Notifications
-- Last Updated: 2025-01-14
-- =====================================================

-- Drop existing database and create new one
DROP DATABASE IF EXISTS capstone;
CREATE DATABASE capstone CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE capstone;

-- =====================================================
-- 1. USERS TABLE
-- =====================================================
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role ENUM('admin', 'student', 'staff') NOT NULL DEFAULT 'student',
    student_id VARCHAR(50) UNIQUE,
    address TEXT,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    middle_name VARCHAR(100),
    suffix VARCHAR(20),
    degree ENUM('BEED', 'BSED', 'BSIT', 'BSHM'),
    year_level ENUM('1st Year', '2nd Year', '3rd Year', '4th Year'),
    section VARCHAR(10),
    status ENUM('regular', 'irregular') DEFAULT 'regular',
    contact_number VARCHAR(20),
    profile_image VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    must_change_password BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_student_id (student_id),
    INDEX idx_role (role),
    INDEX idx_degree (degree),
    INDEX idx_status (status)
);

-- =====================================================
-- 2. CATEGORIES TABLE
-- =====================================================
CREATE TABLE categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- =====================================================
-- 3. PRODUCTS TABLE
-- =====================================================
CREATE TABLE products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    price DECIMAL(10,2) NOT NULL,
    original_price DECIMAL(10,2),
    stock INT DEFAULT 0,
    base_stock INT DEFAULT 0,
    category_id INT,
    image VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    reorder_point INT DEFAULT 10,
    max_stock INT,
    last_restock_date DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
    INDEX idx_category (category_id),
    INDEX idx_name (name),
    INDEX idx_price (price),
    INDEX idx_stock (stock),
    INDEX idx_is_active (is_active)
);

-- =====================================================
-- 4. PRODUCT SIZES TABLE (for products with multiple sizes)
-- =====================================================
CREATE TABLE product_sizes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    size VARCHAR(20) NOT NULL,
    stock INT DEFAULT 0,
    base_stock INT DEFAULT 0,
    price DECIMAL(10,2),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    UNIQUE KEY unique_product_size (product_id, size),
    INDEX idx_product_id (product_id),
    INDEX idx_size (size)
);

-- =====================================================
-- 5. STOCK MANAGEMENT TABLES
-- =====================================================

-- Stock Transactions (Main ledger)
CREATE TABLE stock_transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    transaction_type ENUM('IN','OUT','ADJUSTMENT') NOT NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    reference_no VARCHAR(100),
    batch_no VARCHAR(100),
    expiry_date DATE,
    source VARCHAR(100),
    note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INT,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_product_id (product_id),
    INDEX idx_transaction_type (transaction_type),
    INDEX idx_created_at (created_at),
    INDEX idx_reference_no (reference_no)
);

-- Stock Balance (Cached summary for performance)
CREATE TABLE stock_balance (
    product_id INT PRIMARY KEY,
    qty INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- Stock Items (Batch tracking for FIFO)
CREATE TABLE stock_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    batch_no VARCHAR(100),
    expiry_date DATE,
    initial_quantity INT NOT NULL,
    remaining_quantity INT NOT NULL,
    unit_cost DECIMAL(10,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    INDEX idx_product_batch (product_id, batch_no),
    INDEX idx_expiry (expiry_date),
    INDEX idx_remaining_qty (remaining_quantity)
);

-- =====================================================
-- 6. CART MANAGEMENT
-- =====================================================
CREATE TABLE cart_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    product_id INT NOT NULL,
    size VARCHAR(20),
    quantity INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_product_size (user_id, product_id, size),
    INDEX idx_user_id (user_id),
    INDEX idx_product_id (product_id)
);

-- =====================================================
-- 7. ORDERS MANAGEMENT
-- =====================================================
CREATE TABLE orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_number VARCHAR(50) UNIQUE NOT NULL,
    user_id INT NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL,
    status ENUM('pending', 'processing', 'ready_for_pickup', 'claimed', 'completed', 'cancelled', 'refunded') DEFAULT 'pending',
    payment_status ENUM('pending', 'paid', 'failed', 'refunded') DEFAULT 'pending',
    payment_method VARCHAR(50),
    pay_at_counter BOOLEAN DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_status (status),
    INDEX idx_payment_status (payment_status),
    INDEX idx_order_number (order_number),
    INDEX idx_created_at (created_at)
);

-- Order Items
-- IMPORTANT: unit_price stores the price at the time of transaction (checkout time).
-- This price is captured when the order is created and will NOT change even if the product price is updated later.
-- This ensures historical sales records maintain accurate pricing information at the time of purchase.
-- When displaying orders, always use order_items.unit_price, NOT products.price or product_sizes.price.
CREATE TABLE order_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    product_id INT,
    product_name VARCHAR(200) NOT NULL,
    size VARCHAR(20),
    size_id INT,
    quantity INT NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL COMMENT 'Price at transaction time - do not reference current product price',
    unit_cost DECIMAL(10,2) DEFAULT 0,
    total_price DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
    FOREIGN KEY (size_id) REFERENCES product_sizes(id) ON DELETE SET NULL,
    INDEX idx_order_id (order_id),
    INDEX idx_product_id (product_id),
    INDEX idx_size_id (size_id)
);

-- Order Status Logs (Audit trail)
CREATE TABLE order_status_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    old_status VARCHAR(50),
    new_status VARCHAR(50) NOT NULL,
    admin_id INT,
    notes TEXT,
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_order_id (order_id),
    INDEX idx_created_at (created_at)
);

-- =====================================================
-- 8. PAYMENT MANAGEMENT
-- =====================================================
CREATE TABLE payment_transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    transaction_id VARCHAR(100) UNIQUE,
    amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'PHP',
    payment_method VARCHAR(50),
    status ENUM('pending', 'completed', 'failed', 'cancelled', 'refunded') DEFAULT 'pending',
    gateway_response TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    INDEX idx_order_id (order_id),
    INDEX idx_transaction_id (transaction_id),
    INDEX idx_status (status)
);

-- =====================================================
-- 9. INVENTORY MOVEMENTS (Legacy - for backward compatibility)
-- =====================================================
CREATE TABLE inventory_movements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    movement_type ENUM('stock_in', 'stock_out') NOT NULL,
    quantity INT NOT NULL,
    reason VARCHAR(255),
    supplier VARCHAR(255),
    user_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_product_id (product_id),
    INDEX idx_movement_type (movement_type),
    INDEX idx_created_at (created_at)
);

-- =====================================================
-- 10. NOTIFICATIONS SYSTEM
-- =====================================================
CREATE TABLE notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type ENUM('info', 'success', 'warning', 'error') DEFAULT 'info',
    is_read BOOLEAN DEFAULT FALSE,
    related_id INT,
    related_type VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_is_read (is_read),
    INDEX idx_created_at (created_at),
    INDEX idx_type (type)
);

-- =====================================================
-- 11. PASSWORD RESET SYSTEM
-- =====================================================
CREATE TABLE password_reset_codes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    code VARCHAR(6) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_code (code),
    INDEX idx_expires_at (expires_at)
);

-- =====================================================
-- 12. STORED PROCEDURES
-- =====================================================

-- Generate Order Number
DELIMITER //
CREATE PROCEDURE GenerateOrderNumber()
BEGIN
    DECLARE order_num VARCHAR(50);
    DECLARE counter INT DEFAULT 1;
    
    REPEAT
        SET order_num = CONCAT('ORD-', DATE_FORMAT(NOW(), '%Y%m%d'), '-', LPAD(counter, 4, '0'));
        SET counter = counter + 1;
    UNTIL NOT EXISTS (SELECT 1 FROM orders WHERE order_number = order_num) END REPEAT;
    
    SELECT order_num as order_number;
END //
DELIMITER ;

-- Stock In Procedure
DELIMITER //
CREATE PROCEDURE sp_stock_in(
    IN p_product_id INT,
    IN p_quantity INT,
    IN p_reference_no VARCHAR(100),
    IN p_batch_no VARCHAR(100),
    IN p_expiry_date DATE,
    IN p_source VARCHAR(100),
    IN p_note TEXT,
    IN p_user_id INT
)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;
    
    START TRANSACTION;
    
    -- Insert transaction record
    INSERT INTO stock_transactions (
        product_id, transaction_type, quantity, reference_no, 
        batch_no, expiry_date, source, note, created_by
    ) VALUES (
        p_product_id, 'IN', p_quantity, p_reference_no,
        p_batch_no, p_expiry_date, p_source, p_note, p_user_id
    );
    
    -- Update stock balance
    INSERT INTO stock_balance (product_id, qty) 
    VALUES (p_product_id, p_quantity)
    ON DUPLICATE KEY UPDATE qty = qty + p_quantity;
    
    -- Update product stock
    UPDATE products SET stock = stock + p_quantity WHERE id = p_product_id;
    
    -- Insert/Update stock items for batch tracking
    IF p_batch_no IS NOT NULL THEN
        INSERT INTO stock_items (
            product_id, batch_no, expiry_date, initial_quantity, 
            remaining_quantity, unit_cost
        ) VALUES (
            p_product_id, p_batch_no, p_expiry_date, p_quantity, 
            p_quantity, 0
        ) ON DUPLICATE KEY UPDATE 
            initial_quantity = initial_quantity + p_quantity,
            remaining_quantity = remaining_quantity + p_quantity;
    END IF;
    
    COMMIT;
END //
DELIMITER ;

-- Stock Out Procedure
DELIMITER //
CREATE PROCEDURE sp_stock_out(
    IN p_product_id INT,
    IN p_quantity INT,
    IN p_reference_no VARCHAR(100),
    IN p_source VARCHAR(100),
    IN p_note TEXT,
    IN p_user_id INT
)
BEGIN
    DECLARE v_remaining_qty INT DEFAULT p_quantity;
    DECLARE v_batch_qty INT;
    DECLARE v_batch_no VARCHAR(100);
    DECLARE done INT DEFAULT FALSE;
    DECLARE batch_cursor CURSOR FOR
        SELECT batch_no, remaining_quantity
        FROM stock_items
        WHERE product_id = p_product_id AND remaining_quantity > 0
        ORDER BY created_at ASC, expiry_date ASC;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;
    
    START TRANSACTION;
    
    -- Check if sufficient stock available
    SELECT COALESCE(sb.qty, p.stock, 0) INTO @total_available
    FROM products p
    LEFT JOIN stock_balance sb ON p.id = sb.product_id
    WHERE p.id = p_product_id;
    
    IF @total_available < p_quantity THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Insufficient stock available';
    END IF;
    
    -- Insert main transaction record
    INSERT INTO stock_transactions (
        product_id, transaction_type, quantity, reference_no, 
        source, note, created_by
    ) VALUES (
        p_product_id, 'OUT', p_quantity, p_reference_no,
        p_source, p_note, p_user_id
    );
    
    -- Update stock balance
    UPDATE stock_balance SET qty = qty - p_quantity WHERE product_id = p_product_id;
    
    -- Update product stock
    UPDATE products SET stock = stock - p_quantity WHERE id = p_product_id;
    
    -- FIFO batch allocation
    OPEN batch_cursor;
    batch_loop: LOOP
        FETCH batch_cursor INTO v_batch_no, v_batch_qty;
        IF done THEN
            LEAVE batch_loop;
        END IF;
        
        IF v_remaining_qty <= 0 THEN
            LEAVE batch_loop;
        END IF;
        
        IF v_batch_qty >= v_remaining_qty THEN
            -- This batch can fulfill the remaining quantity
            UPDATE stock_items 
            SET remaining_quantity = remaining_quantity - v_remaining_qty
            WHERE product_id = p_product_id AND batch_no = v_batch_no;
            SET v_remaining_qty = 0;
        ELSE
            -- Use entire batch
            UPDATE stock_items 
            SET remaining_quantity = 0
            WHERE product_id = p_product_id AND batch_no = v_batch_no;
            SET v_remaining_qty = v_remaining_qty - v_batch_qty;
        END IF;
    END LOOP;
    CLOSE batch_cursor;
    
    COMMIT;
END //
DELIMITER ;

-- Stock Adjustment Procedure
DELIMITER //
CREATE PROCEDURE sp_stock_adjustment(
    IN p_product_id INT,
    IN p_physical_count INT,
    IN p_reason VARCHAR(100),
    IN p_note TEXT,
    IN p_user_id INT
)
BEGIN
    DECLARE v_current_stock INT;
    DECLARE v_adjustment_qty INT;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;
    
    START TRANSACTION;
    
    -- Get current stock
    SELECT COALESCE(sb.qty, p.stock, 0) INTO v_current_stock
    FROM products p
    LEFT JOIN stock_balance sb ON p.id = sb.product_id
    WHERE p.id = p_product_id;
    
    -- Calculate adjustment quantity
    SET v_adjustment_qty = p_physical_count - v_current_stock;
    
    -- Insert adjustment transaction
    INSERT INTO stock_transactions (
        product_id, transaction_type, quantity, reference_no, 
        source, note, created_by
    ) VALUES (
        p_product_id, 'ADJUSTMENT', ABS(v_adjustment_qty), 
        CONCAT('ADJ-', DATE_FORMAT(NOW(), '%Y%m%d-%H%i%s')),
        'adjustment', CONCAT(p_reason, ': ', p_note), p_user_id
    );
    
    -- Update stock balance
    INSERT INTO stock_balance (product_id, qty) 
    VALUES (p_product_id, p_physical_count)
    ON DUPLICATE KEY UPDATE qty = p_physical_count;
    
    -- Update product stock
    UPDATE products SET stock = p_physical_count WHERE id = p_product_id;
    
    COMMIT;
END //
DELIMITER ;

-- =====================================================
-- 13. TRIGGERS
-- =====================================================

-- Trigger to generate order number
DELIMITER //
CREATE TRIGGER tr_orders_before_insert
BEFORE INSERT ON orders
FOR EACH ROW
BEGIN
    IF NEW.order_number IS NULL OR NEW.order_number = '' THEN
        CALL GenerateOrderNumber();
        SET NEW.order_number = (SELECT order_number FROM (SELECT order_number FROM orders ORDER BY id DESC LIMIT 1) AS temp);
    END IF;
END //
DELIMITER ;

-- Trigger to update stock balance when stock_items change
DELIMITER //
CREATE TRIGGER tr_stock_items_after_update
AFTER UPDATE ON stock_items
FOR EACH ROW
BEGIN
    UPDATE stock_balance 
    SET qty = (
        SELECT SUM(remaining_quantity) 
        FROM stock_items 
        WHERE product_id = NEW.product_id
    )
    WHERE product_id = NEW.product_id;
END //
DELIMITER ;

-- Trigger to log inventory movements
DELIMITER //
CREATE TRIGGER tr_inventory_movements_after_insert
AFTER INSERT ON inventory_movements
FOR EACH ROW
BEGIN
    -- Update product stock
    IF NEW.movement_type = 'stock_in' THEN
        UPDATE products SET stock = stock + NEW.quantity WHERE id = NEW.product_id;
    ELSE
        UPDATE products SET stock = stock - NEW.quantity WHERE id = NEW.product_id;
    END IF;
END //
DELIMITER ;

-- =====================================================
-- 14. VIEWS
-- =====================================================

-- Order Summary View
CREATE VIEW v_order_summary AS
SELECT 
    o.id,
    o.order_number,
    o.user_id,
    u.name as user_name,
    u.student_id,
    o.total_amount,
    o.status,
    o.payment_status,
    o.created_at,
    COUNT(oi.id) as item_count
FROM orders o
JOIN users u ON o.user_id = u.id
LEFT JOIN order_items oi ON o.id = oi.order_id
GROUP BY o.id;

-- Product Inventory View
CREATE VIEW v_product_inventory AS
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
    END as stock_status
FROM products p
LEFT JOIN categories c ON p.category_id = c.id
LEFT JOIN stock_balance sb ON p.id = sb.product_id
WHERE p.is_active = TRUE;

-- Sales Summary View
CREATE VIEW v_sales_summary AS
SELECT 
    DATE(o.created_at) as sale_date,
    COUNT(*) as total_orders,
    SUM(o.total_amount) as total_revenue,
    AVG(o.total_amount) as average_order_value
FROM orders o
WHERE o.status IN ('completed', 'claimed')
GROUP BY DATE(o.created_at)
ORDER BY sale_date DESC;

-- Current Stock View
CREATE VIEW v_current_stock AS
SELECT 
    p.id,
    p.name,
    p.category_id,
    c.name as category_name,
    COALESCE(sb.qty, p.stock, 0) as current_stock,
    p.reorder_point,
    p.max_stock,
    CASE 
        WHEN COALESCE(sb.qty, p.stock, 0) = 0 THEN 'CRITICAL'
        WHEN COALESCE(sb.qty, p.stock, 0) <= p.reorder_point THEN 'LOW'
        ELSE 'GOOD'
    END as stock_status
FROM products p
LEFT JOIN categories c ON p.category_id = c.id
LEFT JOIN stock_balance sb ON p.id = sb.product_id
WHERE p.is_active = TRUE;

-- Low Stock Products View
CREATE VIEW v_low_stock_products AS
SELECT 
    p.id,
    p.name,
    c.name as category_name,
    COALESCE(sb.qty, p.stock, 0) as current_stock,
    p.reorder_point,
    CASE 
        WHEN COALESCE(sb.qty, p.stock, 0) = 0 THEN 'CRITICAL'
        WHEN COALESCE(sb.qty, p.stock, 0) <= p.reorder_point THEN 'LOW'
        ELSE 'GOOD'
    END as alert_level
FROM products p
LEFT JOIN categories c ON p.category_id = c.id
LEFT JOIN stock_balance sb ON p.id = sb.product_id
WHERE p.is_active = TRUE 
  AND COALESCE(sb.qty, p.stock, 0) <= p.reorder_point;

-- Stock History View
CREATE VIEW v_stock_history AS
SELECT 
    st.id,
    st.product_id,
    p.name as product_name,
    st.transaction_type,
    st.quantity,
    st.reference_no,
    st.batch_no,
    st.expiry_date,
    st.source,
    st.note,
    st.created_at,
    u.name as created_by_name
FROM stock_transactions st
LEFT JOIN products p ON st.product_id = p.id
LEFT JOIN users u ON st.created_by = u.id
ORDER BY st.created_at DESC;

-- =====================================================
-- 15. INDEXES FOR PERFORMANCE
-- =====================================================

-- Additional indexes for better performance
CREATE INDEX idx_orders_user_status ON orders(user_id, status);
CREATE INDEX idx_orders_created_at ON orders(created_at);
CREATE INDEX idx_order_items_order_product ON order_items(order_id, product_id);
CREATE INDEX idx_stock_transactions_product_type ON stock_transactions(product_id, transaction_type);
CREATE INDEX idx_stock_transactions_created_at ON stock_transactions(created_at);
CREATE INDEX idx_notifications_user_read ON notifications(user_id, is_read);
CREATE INDEX idx_cart_items_user_product ON cart_items(user_id, product_id);

-- =====================================================
-- 16. INITIAL DATA
-- =====================================================

-- Insert Default Admin Account
-- Email: acounting.office.cpc@gmail.com
-- Password: accountingoffice (hashed with bcrypt)
INSERT INTO users (
  name,
  email, 
  password, 
  role, 
  first_name, 
  last_name,
  created_at
) VALUES (
  'accounting office',
  'acounting.office.cpc@gmail.com',
  '$2b$10$q5TO2hXTQ/wm5qd6klvA6uJ/ZnY..BSd67XYfXIgIYI/zF9pKVa1m',  -- Password: accountingoffice
  'admin',
  'Accounting',
  'Office',
  NOW()
);

-- =====================================================
-- 17. GRANTS AND PERMISSIONS
-- =====================================================

-- Create application user (if needed)
-- CREATE USER 'capstone_user'@'localhost' IDENTIFIED BY 'capstone_password';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON capstone.* TO 'capstone_user'@'localhost';
-- FLUSH PRIVILEGES;

-- =====================================================
-- SCHEMA COMPLETION MESSAGE
-- =====================================================
SELECT 'CPC ESSEN DATABASE SCHEMA CREATED SUCCESSFULLY!' as message;
SELECT 'Tables created: users, categories, products, product_sizes, stock_transactions, stock_balance, stock_items, cart_items, orders, order_items, order_status_logs, payment_transactions, inventory_movements, notifications, password_reset_codes' as tables;
SELECT 'Stored procedures: GenerateOrderNumber, sp_stock_in, sp_stock_out, sp_stock_adjustment' as procedures;
SELECT 'Views: v_order_summary, v_product_inventory, v_sales_summary, v_current_stock, v_low_stock_products, v_stock_history' as views;
SELECT 'No sample data inserted - database is empty and ready for use' as sample_data;
