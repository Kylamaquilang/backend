-- =====================================================
-- MIGRATION: Add degree_shifts table to track program shifts
-- =====================================================
-- This table tracks when students shift from one degree program to another

-- Create degree_shifts table if it doesn't exist
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
    created_by INT, -- Admin who made the change
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_user_id (user_id),
    INDEX idx_shift_date (shift_date),
    INDEX idx_new_degree (new_degree)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;











