import express from 'express';
import multer from 'multer';
import { 
  getAllUsersWithStatus, 
  toggleUserStatus, 
  updateUserProfileImage,
  getUserProfile,
  updateUserProfile,
  updateUser,
  deleteUser,
  bulkPromoteYearLevel,
  getUserDegreeShifts
} from '../controllers/user-management.controller.js';
import { verifyToken } from '../middleware/auth.middleware.js';
import { isAdmin } from '../middleware/auth.middleware.js';

const router = express.Router();

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = file.originalname.split('.').pop();
    cb(null, 'profile-' + uniqueSuffix + '.' + ext);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Accept only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// User routes (authenticated users) - MUST come before parameterized routes
router.get('/profile', verifyToken, getUserProfile);
router.put('/profile', verifyToken, updateUserProfile);
router.put('/profile/image', verifyToken, upload.single('image'), updateUserProfileImage);

// Admin routes (admin only) - parameterized routes come after specific routes
router.get('/all', verifyToken, isAdmin, getAllUsersWithStatus);
router.post('/bulk-promote', verifyToken, isAdmin, bulkPromoteYearLevel);
router.get('/:id/degree-shifts', verifyToken, isAdmin, getUserDegreeShifts);
router.put('/:id', verifyToken, isAdmin, updateUser);
router.patch('/:userId/status', verifyToken, isAdmin, toggleUserStatus);
router.delete('/:userId', verifyToken, isAdmin, deleteUser);

export default router;
