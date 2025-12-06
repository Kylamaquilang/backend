import express from 'express'
import {
  addToCart,
  getCart,
  updateCart,
  deleteCartItem,
  clearCart
} from '../controllers/cart.controller.js'

import { verifyToken } from '../middleware/auth.middleware.js'

const router = express.Router()

// Log when router is initialized
console.log('🛒 Cart router initialized');

// Debug logging middleware
const debugMiddleware = (req, res, next) => {
  console.log('🛒 Cart route hit:', {
    method: req.method,
    path: req.path,
    originalUrl: req.originalUrl,
    url: req.url,
    body: req.body,
    headers: req.headers
  });
  next();
};

// Test endpoint to verify route is accessible (no auth required for testing)
router.get('/test', (req, res) => {
  console.log('🛒 GET /test endpoint hit');
  res.json({ message: 'Cart route is accessible', path: req.path, originalUrl: req.originalUrl });
});

// Log when routes are registered
console.log('🛒 Registering POST / route for add to cart');
router.post('/', debugMiddleware, verifyToken, addToCart)
router.get('/', debugMiddleware, verifyToken, getCart)
router.put('/:id', debugMiddleware, verifyToken, updateCart)
router.delete('/:id', debugMiddleware, verifyToken, deleteCartItem)
router.delete('/', debugMiddleware, verifyToken, clearCart)

// Log all registered routes
console.log('🛒 Cart routes registered:', router.stack.map(layer => ({
  path: layer.route?.path,
  methods: layer.route?.methods
})));

export default router
