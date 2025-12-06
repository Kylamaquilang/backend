import express from 'express'
import {
  getUserOrders,
  getUserOrderDetails,
  getAllOrders,
  getOrderItems,
  getOrderById,
  updateOrderStatus,
  updateOrderPaymentMethod,
  getOrderStats,
  getSalesPerformance,
  getDetailedSalesReport,
  getProductSalesReport,
  confirmOrderReceipt,
  userConfirmOrderReceipt,
  confirmOrderReceiptNotification,
  testNotification,
  confirmOrderReceiptPublic,
  userCancelOrder
} from '../controllers/order.controller.js'
import { verifyToken, isAdmin } from '../middleware/verifyToken.js'

const router = express.Router()

// Test endpoint to check database connection (MUST come first)
router.get('/test-db', async (req, res) => {
  try {
    const { pool } = await import('../database/db.js')
    const [rows] = await pool.query('SELECT 1 as test')
    res.json({ 
      success: true, 
      message: 'Database connected successfully',
      test: rows[0]
    })
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Database connection failed',
      message: error.message 
    })
  }
})

// Analytics and reporting routes (MUST come before parameterized routes)
router.get('/stats', verifyToken, isAdmin, getOrderStats)
router.get('/sales-performance', verifyToken, isAdmin, getSalesPerformance)
router.get('/detailed-sales-report', verifyToken, isAdmin, getDetailedSalesReport)
router.get('/product-sales-report', verifyToken, isAdmin, getProductSalesReport)

// Public sales data endpoint for testing (remove in production)
router.get('/sales-performance/public', getSalesPerformance)

// Test notification endpoint (for debugging)
router.post('/test-notification', testNotification)

// User order routes
router.get('/student', verifyToken, getUserOrders)
router.get('/user/:id', verifyToken, getUserOrderDetails)

// Admin order routes
router.get('/admin', verifyToken, isAdmin, getAllOrders)

// Parameterized routes (MUST come after named routes to avoid conflicts)
router.get('/:id', verifyToken, isAdmin, getOrderById)
router.get('/:id/items', verifyToken, getOrderItems)
router.patch('/:id/status', verifyToken, isAdmin, updateOrderStatus)
router.patch('/:id/payment-method', verifyToken, isAdmin, updateOrderPaymentMethod)
router.post('/:id/confirm-receipt', verifyToken, isAdmin, confirmOrderReceipt)
router.post('/:id/user-confirm', verifyToken, userConfirmOrderReceipt)
router.post('/:id/cancel', verifyToken, userCancelOrder)
router.post('/:orderId/confirm-notification', verifyToken, confirmOrderReceiptNotification)

// Public endpoint for email confirmation (no auth required)
router.get('/:orderId/confirm-receipt', confirmOrderReceiptPublic)

export default router
