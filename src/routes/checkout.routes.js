import express from 'express'
import { checkout } from '../controllers/checkout.controller.js'
import { verifyToken } from '../middleware/auth.middleware.js'

const router = express.Router()

// Log when router is initialized
console.log('🛒 Checkout router initialized');

// Test endpoint to verify route is accessible (no auth required for testing)
router.get('/test', (req, res) => {
  console.log('🛒 GET /test endpoint hit');
  res.json({ message: 'Checkout route is accessible', path: req.path, originalUrl: req.originalUrl });
});

// Debug logging middleware
const debugMiddleware = (req, res, next) => {
  console.log('🛒 Checkout route hit:', {
    method: req.method,
    path: req.path,
    originalUrl: req.originalUrl,
    url: req.url,
    body: req.body,
    headers: req.headers
  });
  next();
};

// Log when POST route is registered
console.log('🛒 Registering POST / route');
router.post('/', debugMiddleware, verifyToken, checkout)

// Log all registered routes
console.log('🛒 Checkout routes registered:', router.stack.map(layer => ({
  path: layer.route?.path,
  methods: layer.route?.methods
})));

export default router
