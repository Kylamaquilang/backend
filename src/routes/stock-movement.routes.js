import express from 'express';
import { 
  createStockMovement, 
  getStockMovements, 
  getStockMovementById, 
  getStockMovementSummary,
  getCurrentInventoryReport,
  getRestockReport,
  getSalesUsageReport,
  getLowStockAlertReport,
  testStockMovements,
  createStockMovementsTable
} from '../controllers/stock-movement.controller.js';
import { verifyToken } from '../middleware/verifyToken.js';
import { isAdmin } from '../middleware/auth.middleware.js';

const router = express.Router();

// Test endpoint (no auth required)
router.get('/test', testStockMovements);

// Create table endpoint (no auth required)
router.get('/create-table', createStockMovementsTable);

// All other routes require authentication
router.use(verifyToken);

// Create stock movement (admin only)
router.post('/', isAdmin, createStockMovement);

// Get stock movements (admin only)
router.get('/', isAdmin, getStockMovements);

// Get stock movement by ID (admin only)
router.get('/:id', isAdmin, getStockMovementById);

// Get stock movement summary (admin only)
router.get('/summary/overview', isAdmin, getStockMovementSummary);

// Inventory Reports (admin only)
router.get('/reports/current-inventory', isAdmin, getCurrentInventoryReport);
router.get('/reports/restock', isAdmin, getRestockReport);
router.get('/reports/sales-usage', isAdmin, getSalesUsageReport);
router.get('/reports/low-stock-alert', isAdmin, getLowStockAlertReport);

export default router;
