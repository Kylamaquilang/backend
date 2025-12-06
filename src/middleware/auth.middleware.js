import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key_here';

// Public routes that don't require authentication
const publicRoutes = [
  '/health',
  '/api/health',
  '/favicon.ico',
  '/api/auth/login',
  '/api/auth/register'
];

// Middleware: Verify JWT token
export const verifyToken = (req, res, next) => {
  // Skip auth for public routes
  const isPublicRoute = publicRoutes.some(route => 
    req.url === route || 
    req.path === route || 
    req.originalUrl === route ||
    req.url.startsWith(route) ||
    req.path.startsWith(route) ||
    req.originalUrl.startsWith(route)
  );
  
  if (isPublicRoute) {
    return next();
  }

  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('❌ Auth middleware - No token provided:', {
      url: req.originalUrl,
      path: req.path,
      method: req.method,
      headers: req.headers
    });
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'No token provided. Please log in to continue.' 
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    console.log('✅ Auth middleware - Token verified for user:', decoded.id);
    next();
  } catch (err) {
    console.error('❌ Token verification failed:', {
      error: err.message,
      url: req.originalUrl,
      path: req.path,
      method: req.method
    });
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'Invalid or expired token. Please log in again.' 
    });
  }
};

// Middleware: Admin-only access
export const isAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access only.' });
  }
  next();
};

// Optional: Role-based access (flexible version)
export const requireRole = (role) => (req, res, next) => {
  if (!req.user || req.user.role !== role) {
    return res.status(403).json({ message: `Access restricted to ${role}s only.` });
  }
  next();
};
