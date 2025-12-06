import express from 'express';
import {
  getCurrentStock,
  getProductStock,
  addStockIn,
  stockOut,
  adjustStock,
  getStockHistory,
  getStockItems,
  getMonthlyStockReport,
  getLowStockAlerts,
  getInventoryStockReport
} from '../controllers/stock.controller.js';
import { verifyToken, isAdmin } from '../middleware/auth.middleware.js';

const router = express.Router();

// Get current stock for all products
router.get('/current', verifyToken, getCurrentStock);

// Get current stock for a specific product
router.get('/current/:productId', verifyToken, getProductStock);

// Get stock items (batch tracking) for a specific product
router.get('/items/:productId', verifyToken, getStockItems);

// Get stock transaction history
router.get('/history', verifyToken, getStockHistory);

// Get monthly stock report
router.get('/report/monthly', verifyToken, getMonthlyStockReport);

// Get low stock alerts
router.get('/alerts/low-stock', verifyToken, getLowStockAlerts);

// Get inventory/stock report
router.get('/report/inventory-stock', verifyToken, isAdmin, getInventoryStockReport);

// Add stock in (Admin only)
router.post('/in', verifyToken, isAdmin, addStockIn);

// Stock out (Admin only)
router.post('/out', verifyToken, isAdmin, stockOut);

// Stock adjustment (Admin only)
router.post('/adjust', verifyToken, isAdmin, adjustStock);

export default router;
