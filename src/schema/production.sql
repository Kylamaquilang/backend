USE railway;

-- ============================================================
-- USERS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
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

-- ============================================================
-- CATEGORIES
-- ============================================================

CREATE TABLE IF NOT EXISTS categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ============================================================
-- PRODUCTS
-- ============================================================

CREATE TABLE IF NOT EXISTS products (
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
    deleted_at DATETIME NULL,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
    INDEX idx_category (category_id),
    INDEX idx_name (name),
    INDEX idx_price (price),
    INDEX idx_stock (stock),
    INDEX idx_is_active (is_active),
    INDEX idx_deleted_at (deleted_at)
);

-- ============================================================
-- PRODUCT SIZES
-- ============================================================

CREATE TABLE IF NOT EXISTS product_sizes (
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

-- ============================================================
-- STOCK TRANSACTIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS stock_transactions (
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

-- ============================================================
-- STOCK BALANCE
-- ============================================================

CREATE TABLE IF NOT EXISTS stock_balance (
    product_id INT PRIMARY KEY,
    qty INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- ============================================================
-- STOCK ITEMS
-- ============================================================

CREATE TABLE IF NOT EXISTS stock_items (
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

-- ============================================================
-- STOCK MOVEMENTS
-- ============================================================

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
    CONSTRAINT chk_movement_quantity CHECK (quantity > 0),
    INDEX idx_stock_movements_product (product_id),
    INDEX idx_stock_movements_size (size_id),
    INDEX idx_stock_movements_user (user_id),
    INDEX idx_stock_movements_type (movement_type),
    INDEX idx_stock_movements_date (created_at),
    CONSTRAINT fk_stock_movements_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    CONSTRAINT fk_stock_movements_size FOREIGN KEY (size_id) REFERENCES product_sizes(id) ON DELETE SET NULL,
    CONSTRAINT fk_stock_movements_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================================
-- CART ITEMS
-- ============================================================

CREATE TABLE IF NOT EXISTS cart_items (
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

-- ============================================================
-- ORDERS
-- ============================================================

CREATE TABLE IF NOT EXISTS orders (
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
    INDEX idx_created_at (created_at),
    INDEX idx_orders_user_status (user_id, status),
    INDEX idx_orders_created_at (created_at)
);

-- ============================================================
-- ORDER ITEMS
-- ============================================================

CREATE TABLE IF NOT EXISTS order_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    product_id INT,
    product_name VARCHAR(200) NOT NULL,
    size VARCHAR(20),
    size_id INT,
    quantity INT NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    unit_cost DECIMAL(10,2) DEFAULT 0,
    total_price DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_order_id (order_id),
    INDEX idx_product_id (product_id),
    INDEX idx_size_id (size_id),
    INDEX idx_order_items_order_product (order_id, product_id),
    CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
    CONSTRAINT fk_order_items_size FOREIGN KEY (size_id) REFERENCES product_sizes(id) ON DELETE SET NULL
);

-- ============================================================
-- ORDER STATUS LOGS
-- ============================================================

CREATE TABLE IF NOT EXISTS order_status_logs (
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

-- ============================================================
-- PAYMENT TRANSACTIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS payment_transactions (
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

-- ============================================================
-- INVENTORY MOVEMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS inventory_movements (
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

-- ============================================================
-- NOTIFICATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
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
    INDEX idx_type (type),
    INDEX idx_notifications_user_read (user_id, is_read)
);

-- ============================================================
-- PASSWORD RESET CODES
-- ============================================================

CREATE TABLE IF NOT EXISTS password_reset_codes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    code VARCHAR(6) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    verified BOOLEAN DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_code (code),
    INDEX idx_expires_at (expires_at),
    INDEX idx_verified (verified)
);

-- ============================================================
-- DEGREE SHIFTS
-- ============================================================

CREATE TABLE IF NOT EXISTS degree_shifts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    previous_degree ENUM('BEED', 'BSED', 'BSIT', 'BSHM'),
    new_degree ENUM('BEED', 'BSED', 'BSIT', 'BSHM') NOT NULL,
    previous_year_level ENUM('1st Year', '2nd Year', '3rd Year', '4th Year'),
    new_year_level ENUM('1st Year', '2nd Year', '3rd Year', '4th Year'),
    previous_section VARCHAR(10),
    new_section VARCHAR(10),
    shift_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    created_by INT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_user_id (user_id),
    INDEX idx_shift_date (shift_date),
    INDEX idx_new_degree (new_degree)
);

-- ============================================================
-- DEFAULT INDEXES
-- ============================================================

CREATE INDEX idx_stock_transactions_product_type ON stock_transactions(product_id, transaction_type);
CREATE INDEX idx_stock_transactions_created_at ON stock_transactions(created_at);
CREATE INDEX idx_cart_items_user_product ON cart_items(user_id, product_id);

-- ============================================================
-- INSERT DEFAULT ADMIN
-- ============================================================

INSERT INTO users (name, email, password, role, first_name, last_name, created_at)
VALUES (
  'accounting office',
  'acounting.office.cpc@gmail.com',
  '$2b$10$q5TO2hXTQ/wm5qd6klvA6uJ/ZnY..BSd67XYfXIgIYI/zF9pKVa1m',
  'admin',
  'Accounting',
  'Office',
  NOW()
) ON DUPLICATE KEY UPDATE email=email;

-- ============================================================
-- VIEWS
-- ============================================================

CREATE OR REPLACE VIEW v_order_summary AS
SELECT 
    o.id,
    o.order_number,
    o.user_id,
    u.name AS user_name,
    u.student_id,
    o.total_amount,
    o.status,
    o.payment_status,
    o.created_at,
    COUNT(oi.id) AS item_count
FROM orders o
JOIN users u ON o.user_id = u.id
LEFT JOIN order_items oi ON o.id = oi.order_id
GROUP BY o.id;

CREATE OR REPLACE VIEW v_product_inventory AS
SELECT 
    p.id,
    p.name,
    p.category_id,
    c.name AS category_name,
    COALESCE(sb.qty, p.stock, 0) AS current_stock,
    p.reorder_point,
    p.max_stock,
    CASE 
        WHEN COALESCE(sb.qty, p.stock, 0) <= p.reorder_point THEN 'LOW'
        WHEN COALESCE(sb.qty, p.stock, 0) <= (p.reorder_point * 2) THEN 'MEDIUM'
        ELSE 'GOOD'
    END AS stock_status
FROM products p
LEFT JOIN categories c ON p.category_id = c.id
LEFT JOIN stock_balance sb ON p.id = sb.product_id
WHERE p.is_active = TRUE AND p.deleted_at IS NULL;

CREATE OR REPLACE VIEW v_sales_summary AS
SELECT 
    DATE(o.created_at) AS sale_date,
    COUNT(*) AS total_orders,
    SUM(o.total_amount) AS total_revenue,
    AVG(o.total_amount) AS average_order_value
FROM orders o
WHERE o.status IN ('completed', 'claimed')
GROUP BY DATE(o.created_at)
ORDER BY sale_date DESC;

CREATE OR REPLACE VIEW v_current_stock AS
SELECT 
    p.id,
    p.name,
    p.category_id,
    c.name AS category_name,
    COALESCE(sb.qty, p.stock, 0) AS current_stock,
    p.reorder_point,
    p.max_stock,
    CASE 
        WHEN COALESCE(sb.qty, p.stock, 0) = 0 THEN 'CRITICAL'
        WHEN COALESCE(sb.qty, p.stock, 0) <= p.reorder_point THEN 'LOW'
        ELSE 'GOOD'
    END AS stock_status
FROM products p
LEFT JOIN categories c ON p.category_id = c.id
LEFT JOIN stock_balance sb ON p.id = sb.product_id
WHERE p.is_active = TRUE AND p.deleted_at IS NULL;

CREATE OR REPLACE VIEW v_low_stock_products AS
SELECT 
    p.id,
    p.name,
    c.name AS category_name,
    COALESCE(sb.qty, p.stock, 0) AS current_stock,
    p.reorder_point,
    CASE 
        WHEN COALESCE(sb.qty, p.stock, 0) = 0 THEN 'CRITICAL'
        WHEN COALESCE(sb.qty, p.stock, 0) <= p.reorder_point THEN 'LOW'
        ELSE 'GOOD'
    END AS alert_level
FROM products p
LEFT JOIN categories c ON p.category_id = c.id
LEFT JOIN stock_balance sb ON p.id = sb.product_id
WHERE p.is_active = TRUE 
  AND p.deleted_at IS NULL
  AND COALESCE(sb.qty, p.stock, 0) <= p.reorder_point;

CREATE OR REPLACE VIEW v_stock_history AS
SELECT 
    st.id,
    st.product_id,
    p.name AS product_name,
    st.transaction_type,
    st.quantity,
    st.reference_no,
    st.batch_no,
    st.expiry_date,
    st.source,
    st.note,
    st.created_at,
    u.name AS created_by_name
FROM stock_transactions st
LEFT JOIN products p ON st.product_id = p.id
LEFT JOIN users u ON st.created_by = u.id
ORDER BY st.created_at DESC;

-- ============================================================
-- STORED PROCEDURE (Railway Safe)
-- ============================================================

DROP PROCEDURE IF EXISTS GenerateOrderNumber;

-- ============================================================
-- CONFIRMATION
-- ============================================================

SELECT 'CPC ESSEN DATABASE SCHEMA CREATED SUCCESSFULLY!' AS message;
SELECT 'Default admin created: acounting.office.cpc@gmail.com' AS admin_info;
SELECT 'Stored Procedure Created: GenerateOrderNumber()' AS procedure_info;
