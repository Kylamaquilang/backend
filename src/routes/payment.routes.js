import express from 'express';
import {
  selectGCashPayment,
  getPaymentStatus,
  getGCashStats,
  cancelPayment
} from '../controllers/payment.controller.js';
import { verifyToken } from '../middleware/auth.middleware.js';

const router = express.Router();

// GCash payment selection routes
router.post('/gcash/select', verifyToken, selectGCashPayment);
router.get('/status/:orderId', verifyToken, getPaymentStatus);

// Payment cancellation route
router.post('/cancel/:orderId', verifyToken, cancelPayment);

// Admin routes for GCash statistics
router.get('/gcash/stats', verifyToken, getGCashStats);

export default router;
