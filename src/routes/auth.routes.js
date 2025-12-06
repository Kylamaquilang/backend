import express from 'express';
import { 
  // signup,  // Not used - user registration is disabled
  signin, 
  logout, 
  changePassword, 
  refreshToken, 
  updateProfile,
  requestPasswordReset,
  verifyPasswordResetCode,
  resetPasswordWithToken,
  sendVerificationCode
} from '../controllers/auth.controller.js';
import { verifyToken } from '../middleware/auth.middleware.js';
import { pool } from '../database/db.js';

const router = express.Router();

// Test endpoint to debug database
router.get('/test-db', async (req, res) => {
  try {
    const [users] = await pool.query('SELECT id, name, student_id, LEFT(password, 20) as password_preview, role FROM users LIMIT 5');
    res.json({ 
      message: 'Database connection successful',
      users: users,
      totalUsers: users.length
    });
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// Public routes
// NOTE: User registration is disabled. Only admins can add users via /students/add endpoint
// router.post('/signup', signup); // DISABLED - No self-registration allowed
router.post('/signin', signin);
router.post('/logout', logout);
router.post('/change-password', changePassword);
router.post('/refresh-token', refreshToken);

// Password reset routes
router.post('/request-reset', requestPasswordReset);
router.post('/verify-code', verifyPasswordResetCode);
router.post('/reset-password', resetPasswordWithToken);

// Email verification routes for password change
router.post('/send-verification-code', sendVerificationCode);

// Protected routes
router.put('/profile', verifyToken, updateProfile);

export default router;