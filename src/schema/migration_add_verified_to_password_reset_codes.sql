-- =====================================================
-- MIGRATION: Add verified column to password_reset_codes table
-- =====================================================
-- This column tracks whether a verification code has been verified by the user
-- verified = 0: Code sent but not yet verified
-- verified = 1: Code verified (user entered it correctly)
-- used = 1: Code used to change password (set when password is changed)

-- Add verified column if it doesn't exist
ALTER TABLE password_reset_codes 
ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT 0;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_verified ON password_reset_codes(verified);

SELECT 'Migration completed: Added verified column to password_reset_codes table' as message;



