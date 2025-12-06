-- =====================================================
-- CPC ESSEN CAPSTONE PROJECT - STORED PROCEDURES
-- =====================================================
-- This file contains all stored procedures for the system
-- Last Updated: 2025-01-22
-- 
-- IMPORTANT NOTES:
-- - Users CANNOT self-register. Only admins can create user accounts.
-- - User creation is done via /students/add endpoint (admin-protected).
-- - Sales are recorded when orders are marked as 'claimed' or 'completed'.
-- - Payment status is automatically set to 'paid' when order is claimed/completed.
-- =====================================================

USE capstone;

-- Drop existing procedures if they exist
DROP PROCEDURE IF EXISTS sp_user_login;
DROP PROCEDURE IF EXISTS sp_create_user_by_admin;
DROP PROCEDURE IF EXISTS sp_get_user_by_id;
DROP PROCEDURE IF EXISTS sp_get_user_by_email;
DROP PROCEDURE IF EXISTS sp_update_user_profile;
DROP PROCEDURE IF EXISTS sp_update_user_password;
DROP PROCEDURE IF EXISTS sp_update_user_status;
DROP PROCEDURE IF EXISTS sp_create_order;
DROP PROCEDURE IF EXISTS sp_get_user_orders;
DROP PROCEDURE IF EXISTS sp_get_order_details;
DROP PROCEDURE IF EXISTS sp_update_order_status;
DROP PROCEDURE IF EXISTS sp_update_order_payment;
DROP PROCEDURE IF EXISTS sp_cancel_order;
DROP PROCEDURE IF EXISTS sp_get_all_products;
DROP PROCEDURE IF EXISTS sp_get_product_by_id;
DROP PROCEDURE IF EXISTS sp_create_product;
DROP PROCEDURE IF EXISTS sp_update_product;
DROP PROCEDURE IF EXISTS sp_delete_product;
DROP PROCEDURE IF EXISTS sp_get_cart_items;
DROP PROCEDURE IF EXISTS sp_add_to_cart;
DROP PROCEDURE IF EXISTS sp_update_cart_item;
DROP PROCEDURE IF EXISTS sp_remove_from_cart;
DROP PROCEDURE IF EXISTS sp_clear_cart;
DROP PROCEDURE IF EXISTS sp_get_inventory_stock;
DROP PROCEDURE IF EXISTS sp_update_stock;
DROP PROCEDURE IF EXISTS sp_get_sales_performance;
DROP PROCEDURE IF EXISTS sp_get_all_users;
DROP PROCEDURE IF EXISTS sp_create_notification;
DROP PROCEDURE IF EXISTS sp_get_user_notifications;
DROP PROCEDURE IF EXISTS sp_mark_notifications_read;

DELIMITER $$

-- =====================================================
-- USER AUTHENTICATION PROCEDURES
-- =====================================================
-- NOTE: Users cannot register themselves. Only admins can create users.
-- Users can only log in after being added by an admin.

-- Login procedure
CREATE PROCEDURE sp_user_login(
    IN p_email VARCHAR(255)
)
BEGIN
    SELECT 
        id, name, email, password, role, student_id, address,
        first_name, last_name, middle_name, suffix, degree,
        year_level, section, status, contact_number, profile_image,
        is_active, must_change_password, created_at, updated_at
    FROM users
    WHERE email = p_email AND is_active = TRUE
    LIMIT 1;
END$$

-- Create new user (ADMIN ONLY - No self-registration)
CREATE PROCEDURE sp_create_user_by_admin(
    IN p_name VARCHAR(255),
    IN p_email VARCHAR(255),
    IN p_password VARCHAR(255),
    IN p_role VARCHAR(20),
    IN p_student_id VARCHAR(50),
    IN p_first_name VARCHAR(100),
    IN p_last_name VARCHAR(100),
    IN p_middle_name VARCHAR(100),
    IN p_suffix VARCHAR(20),
    IN p_degree VARCHAR(10),
    IN p_year_level VARCHAR(20),
    IN p_section VARCHAR(10),
    IN p_status VARCHAR(20),
    IN p_contact_number VARCHAR(20),
    IN p_must_change_password BOOLEAN
)
BEGIN
    INSERT INTO users (
        name, email, password, role, student_id, 
        first_name, last_name, middle_name, suffix, degree, 
        year_level, section, status, contact_number, 
        is_active, must_change_password
    ) VALUES (
        p_name, p_email, p_password, p_role, p_student_id,
        p_first_name, p_last_name, p_middle_name, p_suffix, p_degree,
        p_year_level, p_section, p_status, p_contact_number,
        TRUE, COALESCE(p_must_change_password, FALSE)
    );
    
    SELECT LAST_INSERT_ID() as user_id;
END$$

-- Get user by ID
CREATE PROCEDURE sp_get_user_by_id(
    IN p_user_id INT
)
BEGIN
    SELECT 
        id, name, email, role, student_id, address,
        first_name, last_name, middle_name, suffix, degree,
        year_level, section, status, contact_number, profile_image,
        is_active, must_change_password, created_at, updated_at
    FROM users
    WHERE id = p_user_id
    LIMIT 1;
END$$

-- Get user by email
CREATE PROCEDURE sp_get_user_by_email(
    IN p_email VARCHAR(255)
)
BEGIN
    SELECT 
        id, name, email, role, student_id, address,
        first_name, last_name, middle_name, suffix, degree,
        year_level, section, status, contact_number, profile_image,
        is_active, must_change_password, created_at, updated_at
    FROM users
    WHERE email = p_email
    LIMIT 1;
END$$

-- Update user profile
CREATE PROCEDURE sp_update_user_profile(
    IN p_user_id INT,
    IN p_name VARCHAR(255),
    IN p_first_name VARCHAR(100),
    IN p_last_name VARCHAR(100),
    IN p_middle_name VARCHAR(100),
    IN p_suffix VARCHAR(20),
    IN p_contact_number VARCHAR(20),
    IN p_address TEXT,
    IN p_degree VARCHAR(10),
    IN p_year_level VARCHAR(20),
    IN p_section VARCHAR(10),
    IN p_status VARCHAR(20),
    IN p_profile_image VARCHAR(255)
)
BEGIN
    UPDATE users
    SET 
        name = COALESCE(p_name, name),
        first_name = COALESCE(p_first_name, first_name),
        last_name = COALESCE(p_last_name, last_name),
        middle_name = COALESCE(p_middle_name, middle_name),
        suffix = COALESCE(p_suffix, suffix),
        contact_number = COALESCE(p_contact_number, contact_number),
        address = COALESCE(p_address, address),
        degree = COALESCE(p_degree, degree),
        year_level = COALESCE(p_year_level, year_level),
        section = COALESCE(p_section, section),
        status = COALESCE(p_status, status),
        profile_image = COALESCE(p_profile_image, profile_image),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_user_id;
    
    SELECT ROW_COUNT() as affected_rows;
END$$

-- Update user password
CREATE PROCEDURE sp_update_user_password(
    IN p_user_id INT,
    IN p_new_password VARCHAR(255)
)
BEGIN
    UPDATE users
    SET 
        password = p_new_password,
        must_change_password = FALSE,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_user_id;
    
    SELECT ROW_COUNT() as affected_rows;
END$$

-- Update user status (activate/deactivate) - ADMIN ONLY
CREATE PROCEDURE sp_update_user_status(
    IN p_user_id INT,
    IN p_is_active BOOLEAN
)
BEGIN
    UPDATE users
    SET 
        is_active = p_is_active,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_user_id;
    
    SELECT ROW_COUNT() as affected_rows;
END$$

-- =====================================================
-- PRODUCT PROCEDURES
-- =====================================================

-- Get all products
CREATE PROCEDURE sp_get_all_products()
BEGIN
    SELECT 
        p.id, p.name, p.description, p.price, p.original_price,
        p.stock, p.base_stock, p.category_id, p.image, p.is_active,
        p.reorder_point, p.max_stock, p.last_restock_date,
        p.created_at, p.updated_at,
        c.name as category_name,
        c.description as category_description
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.is_active = TRUE
    ORDER BY p.created_at DESC;
END$$

-- Get product by ID with sizes
CREATE PROCEDURE sp_get_product_by_id(
    IN p_product_id INT
)
BEGIN
    -- Get product details
    SELECT 
        p.id, p.name, p.description, p.price, p.original_price,
        p.stock, p.base_stock, p.category_id, p.image, p.is_active,
        p.reorder_point, p.max_stock, p.last_restock_date,
        p.created_at, p.updated_at,
        c.name as category_name
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.id = p_product_id
    LIMIT 1;
    
    -- Get product sizes
    SELECT 
        id, product_id, size, stock, base_stock, price, is_active,
        created_at, updated_at
    FROM product_sizes
    WHERE product_id = p_product_id AND is_active = TRUE;
END$$

-- Create new product
CREATE PROCEDURE sp_create_product(
    IN p_name VARCHAR(200),
    IN p_description TEXT,
    IN p_price DECIMAL(10,2),
    IN p_original_price DECIMAL(10,2),
    IN p_stock INT,
    IN p_category_id INT,
    IN p_image VARCHAR(255),
    IN p_reorder_point INT,
    IN p_max_stock INT
)
BEGIN
    INSERT INTO products (
        name, description, price, original_price, stock, base_stock,
        category_id, image, reorder_point, max_stock, is_active
    ) VALUES (
        p_name, p_description, p_price, p_original_price, 
        p_stock, p_stock, p_category_id, p_image, 
        p_reorder_point, p_max_stock, TRUE
    );
    
    SELECT LAST_INSERT_ID() as product_id;
END$$

-- Update product
CREATE PROCEDURE sp_update_product(
    IN p_product_id INT,
    IN p_name VARCHAR(200),
    IN p_description TEXT,
    IN p_price DECIMAL(10,2),
    IN p_original_price DECIMAL(10,2),
    IN p_category_id INT,
    IN p_image VARCHAR(255),
    IN p_reorder_point INT,
    IN p_max_stock INT,
    IN p_is_active BOOLEAN
)
BEGIN
    UPDATE products
    SET 
        name = COALESCE(p_name, name),
        description = COALESCE(p_description, description),
        price = COALESCE(p_price, price),
        original_price = COALESCE(p_original_price, original_price),
        category_id = COALESCE(p_category_id, category_id),
        image = COALESCE(p_image, image),
        reorder_point = COALESCE(p_reorder_point, reorder_point),
        max_stock = COALESCE(p_max_stock, max_stock),
        is_active = COALESCE(p_is_active, is_active),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_product_id;
    
    SELECT ROW_COUNT() as affected_rows;
END$$

-- Delete product (soft delete)
CREATE PROCEDURE sp_delete_product(
    IN p_product_id INT
)
BEGIN
    UPDATE products
    SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
    WHERE id = p_product_id;
    
    SELECT ROW_COUNT() as affected_rows;
END$$

-- =====================================================
-- ORDER PROCEDURES
-- =====================================================

-- Create new order
CREATE PROCEDURE sp_create_order(
    IN p_user_id INT,
    IN p_total_amount DECIMAL(10,2),
    IN p_payment_method VARCHAR(50),
    IN p_payment_status VARCHAR(50),
    IN p_status VARCHAR(50),
    IN p_notes TEXT
)
BEGIN
    INSERT INTO orders (
        user_id, total_amount, payment_method, payment_status,
        status, notes, created_at
    ) VALUES (
        p_user_id, p_total_amount, p_payment_method, p_payment_status,
        p_status, p_notes, CURRENT_TIMESTAMP
    );
    
    SELECT LAST_INSERT_ID() as order_id;
END$$

-- Get user orders
CREATE PROCEDURE sp_get_user_orders(
    IN p_user_id INT
)
BEGIN
    SELECT 
        o.id, o.user_id, o.total_amount, o.total_quantity,
        o.payment_method, o.payment_status, o.status, o.notes,
        o.created_at, o.updated_at,
        u.name as user_name, u.email, u.student_id, u.degree,
        u.year_level, u.section
    FROM orders o
    JOIN users u ON o.user_id = u.id
    WHERE o.user_id = p_user_id
    ORDER BY o.created_at DESC;
END$$

-- Get order details with items
CREATE PROCEDURE sp_get_order_details(
    IN p_order_id INT
)
BEGIN
    -- Get order info
    SELECT 
        o.id, o.user_id, o.total_amount, o.total_quantity,
        o.payment_method, o.payment_status, o.status, o.notes,
        o.created_at, o.updated_at,
        u.name as user_name, u.email, u.student_id, u.contact_number,
        u.degree, u.year_level, u.section, u.address
    FROM orders o
    JOIN users u ON o.user_id = u.id
    WHERE o.id = p_order_id
    LIMIT 1;
    
    -- Get order items
    SELECT 
        oi.id, oi.order_id, oi.product_id, oi.size, oi.quantity,
        oi.unit_price, oi.unit_cost, oi.total_price,
        p.name as product_name, p.image as product_image, p.description
    FROM order_items oi
    JOIN products p ON oi.product_id = p.id
    WHERE oi.order_id = p_order_id;
END$$

-- Update order status
CREATE PROCEDURE sp_update_order_status(
    IN p_order_id INT,
    IN p_status VARCHAR(50),
    IN p_notes TEXT
)
BEGIN
    DECLARE v_old_status VARCHAR(50);
    DECLARE v_user_id INT;
    DECLARE v_total_amount DECIMAL(10,2);
    DECLARE v_payment_status VARCHAR(50);
    
    -- Get current order details
    SELECT status, user_id, total_amount, payment_status
    INTO v_old_status, v_user_id, v_total_amount, v_payment_status
    FROM orders
    WHERE id = p_order_id;
    
    -- Update order status
    UPDATE orders
    SET 
        status = p_status,
        notes = COALESCE(p_notes, notes),
        payment_status = CASE 
            WHEN p_status = 'claimed' THEN 'paid'
            ELSE payment_status
        END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_order_id;
    
    -- Return updated order info
    SELECT 
        id, user_id, status, payment_status, total_amount,
        v_old_status as old_status,
        (p_status = 'claimed' AND v_payment_status != 'paid') as payment_status_updated,
        (p_status = 'claimed') as sales_logged,
        (p_status = 'cancelled' OR p_status = 'refunded') as inventory_updated
    FROM orders
    WHERE id = p_order_id;
END$$

-- Update order payment method
CREATE PROCEDURE sp_update_order_payment(
    IN p_order_id INT,
    IN p_payment_method VARCHAR(50),
    IN p_payment_status VARCHAR(50)
)
BEGIN
    UPDATE orders
    SET 
        payment_method = p_payment_method,
        payment_status = COALESCE(p_payment_status, payment_status),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_order_id;
    
    SELECT ROW_COUNT() as affected_rows;
END$$

-- Cancel order
CREATE PROCEDURE sp_cancel_order(
    IN p_order_id INT,
    IN p_user_id INT,
    IN p_cancellation_reason TEXT
)
BEGIN
    UPDATE orders
    SET 
        status = 'cancelled',
        notes = CONCAT(COALESCE(notes, ''), ' | Cancelled by user: ', p_cancellation_reason),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_order_id AND user_id = p_user_id;
    
    SELECT ROW_COUNT() as affected_rows;
END$$

-- =====================================================
-- CART PROCEDURES
-- =====================================================

-- Get cart items for user
CREATE PROCEDURE sp_get_cart_items(
    IN p_user_id INT
)
BEGIN
    SELECT 
        c.id, c.user_id, c.product_id, c.size_id, c.size, c.quantity,
        c.created_at, c.updated_at,
        p.name as product_name, p.description, p.price, p.image,
        p.stock, p.is_active,
        CASE 
            WHEN c.size_id IS NOT NULL THEN ps.stock
            ELSE p.stock
        END as available_stock,
        CASE
            WHEN c.size_id IS NOT NULL THEN ps.price
            ELSE p.price
        END as item_price,
        ps.size as size_name
    FROM cart_items c
    JOIN products p ON c.product_id = p.id
    LEFT JOIN product_sizes ps ON c.size_id = ps.id
    WHERE c.user_id = p_user_id AND p.is_active = TRUE;
END$$

-- Add item to cart
CREATE PROCEDURE sp_add_to_cart(
    IN p_user_id INT,
    IN p_product_id INT,
    IN p_size_id INT,
    IN p_quantity INT
)
BEGIN
    DECLARE v_cart_id INT;
    DECLARE v_size_name VARCHAR(20);
    
    -- Get size name if size_id is provided
    IF p_size_id IS NOT NULL THEN
        SELECT size INTO v_size_name FROM product_sizes WHERE id = p_size_id LIMIT 1;
    END IF;
    
    -- Check if item already exists in cart
    SELECT id INTO v_cart_id
    FROM cart_items
    WHERE user_id = p_user_id 
      AND product_id = p_product_id 
      AND (size_id = p_size_id OR (size_id IS NULL AND p_size_id IS NULL))
    LIMIT 1;
    
    IF v_cart_id IS NOT NULL THEN
        -- Update existing cart item
        UPDATE cart_items
        SET quantity = quantity + p_quantity, updated_at = CURRENT_TIMESTAMP
        WHERE id = v_cart_id;
        
        SELECT v_cart_id as cart_id, 'updated' as action;
    ELSE
        -- Insert new cart item
        INSERT INTO cart_items (user_id, product_id, size_id, size, quantity, created_at)
        VALUES (p_user_id, p_product_id, p_size_id, v_size_name, p_quantity, CURRENT_TIMESTAMP);
        
        SELECT LAST_INSERT_ID() as cart_id, 'created' as action;
    END IF;
END$$

-- Update cart item quantity
CREATE PROCEDURE sp_update_cart_item(
    IN p_cart_id INT,
    IN p_user_id INT,
    IN p_quantity INT
)
BEGIN
    UPDATE cart_items
    SET quantity = p_quantity, updated_at = CURRENT_TIMESTAMP
    WHERE id = p_cart_id AND user_id = p_user_id;
    
    SELECT ROW_COUNT() as affected_rows;
END$$

-- Remove item from cart
CREATE PROCEDURE sp_remove_from_cart(
    IN p_cart_id INT,
    IN p_user_id INT
)
BEGIN
    DELETE FROM cart_items
    WHERE id = p_cart_id AND user_id = p_user_id;
    
    SELECT ROW_COUNT() as affected_rows;
END$$

-- Clear entire cart
CREATE PROCEDURE sp_clear_cart(
    IN p_user_id INT
)
BEGIN
    DELETE FROM cart_items
    WHERE user_id = p_user_id;
    
    SELECT ROW_COUNT() as affected_rows;
END$$

-- =====================================================
-- INVENTORY/STOCK PROCEDURES
-- =====================================================

-- Get current inventory stock
CREATE PROCEDURE sp_get_inventory_stock()
BEGIN
    SELECT 
        p.id, p.name, p.stock, p.base_stock, p.reorder_point,
        p.max_stock, p.last_restock_date, p.price,
        c.name as category_name,
        (p.stock <= p.reorder_point) as is_low_stock,
        (p.reorder_point - p.stock) as stock_deficit
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.is_active = TRUE
    ORDER BY p.stock ASC, p.name ASC;
    
    -- Get size-specific stock
    SELECT 
        ps.id, ps.product_id, ps.size, ps.stock, ps.base_stock,
        p.name as product_name, p.reorder_point
    FROM product_sizes ps
    JOIN products p ON ps.product_id = p.id
    WHERE ps.is_active = TRUE AND p.is_active = TRUE
    ORDER BY ps.stock ASC;
END$$

-- Update product stock
CREATE PROCEDURE sp_update_stock(
    IN p_product_id INT,
    IN p_size VARCHAR(20),
    IN p_quantity_change INT,
    IN p_movement_type VARCHAR(50),
    IN p_reference_no VARCHAR(100),
    IN p_notes TEXT
)
BEGIN
    DECLARE v_old_stock INT;
    DECLARE v_new_stock INT;
    
    IF p_size IS NULL THEN
        -- Update main product stock
        SELECT stock INTO v_old_stock FROM products WHERE id = p_product_id;
        SET v_new_stock = v_old_stock + p_quantity_change;
        
        UPDATE products
        SET stock = v_new_stock,
            last_restock_date = CASE WHEN p_movement_type = 'restock' THEN CURRENT_TIMESTAMP ELSE last_restock_date END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = p_product_id;
    ELSE
        -- Update size-specific stock
        SELECT stock INTO v_old_stock 
        FROM product_sizes 
        WHERE product_id = p_product_id AND size = p_size;
        
        SET v_new_stock = v_old_stock + p_quantity_change;
        
        UPDATE product_sizes
        SET stock = v_new_stock, updated_at = CURRENT_TIMESTAMP
        WHERE product_id = p_product_id AND size = p_size;
    END IF;
    
    -- Log stock movement
    INSERT INTO inventory_movements (
        product_id, size, movement_type, quantity_change,
        old_stock, new_stock, reference_no, notes, created_at
    ) VALUES (
        p_product_id, p_size, p_movement_type, p_quantity_change,
        v_old_stock, v_new_stock, p_reference_no, p_notes, CURRENT_TIMESTAMP
    );
    
    SELECT v_old_stock as old_stock, v_new_stock as new_stock, LAST_INSERT_ID() as movement_id;
END$$

-- =====================================================
-- SALES & REPORTING PROCEDURES
-- =====================================================

-- Get sales performance
CREATE PROCEDURE sp_get_sales_performance(
    IN p_start_date DATE,
    IN p_end_date DATE,
    IN p_group_by VARCHAR(20)
)
BEGIN
    DECLARE v_group_clause VARCHAR(100);
    
    -- Determine grouping clause
    SET v_group_clause = CASE p_group_by
        WHEN 'month' THEN "DATE_FORMAT(o.created_at, '%Y-%m')"
        WHEN 'year' THEN "YEAR(o.created_at)"
        ELSE "DATE(o.created_at)"
    END;
    
    -- Sales data by period
    SET @sql = CONCAT('
        SELECT 
            ', v_group_clause, ' as period,
            COUNT(*) as orders,
            SUM(o.total_amount) as revenue,
            AVG(o.total_amount) as avg_order_value,
            COUNT(CASE WHEN LOWER(o.payment_method) = "gcash" THEN 1 END) as gcash_orders,
            COUNT(CASE WHEN LOWER(o.payment_method) = "cash" THEN 1 END) as cash_orders,
            SUM(CASE WHEN LOWER(o.payment_method) = "gcash" THEN o.total_amount ELSE 0 END) as gcash_revenue,
            SUM(CASE WHEN LOWER(o.payment_method) = "cash" THEN o.total_amount ELSE 0 END) as cash_revenue
        FROM orders o
        WHERE o.status = "claimed"
        ', IF(p_start_date IS NOT NULL, CONCAT(' AND DATE(o.created_at) >= "', p_start_date, '"'), ''), '
        ', IF(p_end_date IS NOT NULL, CONCAT(' AND DATE(o.created_at) <= "', p_end_date, '"'), ''), '
        GROUP BY ', v_group_clause, '
        ORDER BY period DESC
    ');
    
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
END$$

-- =====================================================
-- USER MANAGEMENT PROCEDURES
-- =====================================================

-- Get all users (admin)
CREATE PROCEDURE sp_get_all_users(
    IN p_role VARCHAR(20)
)
BEGIN
    IF p_role IS NULL THEN
        SELECT 
            id, name, email, role, student_id, first_name, last_name,
            degree, year_level, section, status, contact_number,
            profile_image, is_active, created_at, updated_at
        FROM users
        ORDER BY created_at DESC;
    ELSE
        SELECT 
            id, name, email, role, student_id, first_name, last_name,
            degree, year_level, section, status, contact_number,
            profile_image, is_active, created_at, updated_at
        FROM users
        WHERE role = p_role
        ORDER BY created_at DESC;
    END IF;
END$$

-- =====================================================
-- NOTIFICATION PROCEDURES
-- =====================================================

-- Create notification
CREATE PROCEDURE sp_create_notification(
    IN p_user_id INT,
    IN p_title VARCHAR(255),
    IN p_message TEXT,
    IN p_type VARCHAR(50),
    IN p_reference_type VARCHAR(50),
    IN p_reference_id INT
)
BEGIN
    INSERT INTO notifications (
        user_id, title, message, type, reference_type, reference_id,
        is_read, created_at
    ) VALUES (
        p_user_id, p_title, p_message, p_type, p_reference_type, p_reference_id,
        FALSE, CURRENT_TIMESTAMP
    );
    
    SELECT LAST_INSERT_ID() as notification_id;
END$$

-- Get user notifications
CREATE PROCEDURE sp_get_user_notifications(
    IN p_user_id INT,
    IN p_limit INT
)
BEGIN
    SELECT 
        id, user_id, title, message, type, reference_type, reference_id,
        is_read, created_at, updated_at
    FROM notifications
    WHERE user_id = p_user_id
    ORDER BY created_at DESC
    LIMIT p_limit;
END$$

-- Mark notifications as read
CREATE PROCEDURE sp_mark_notifications_read(
    IN p_user_id INT,
    IN p_notification_ids TEXT
)
BEGIN
    UPDATE notifications
    SET is_read = TRUE, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = p_user_id 
      AND FIND_IN_SET(id, p_notification_ids) > 0;
    
    SELECT ROW_COUNT() as affected_rows;
END$$

DELIMITER ;

-- =====================================================
-- GRANT EXECUTE PERMISSIONS
-- =====================================================
-- Grant execute permissions to application user
-- GRANT EXECUTE ON PROCEDURE capstone.* TO 'your_app_user'@'localhost';
-- FLUSH PRIVILEGES;

-- =====================================================
-- END OF STORED PROCEDURES
-- =====================================================

