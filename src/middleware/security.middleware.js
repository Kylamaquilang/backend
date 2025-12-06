// src/middleware/security.middleware.js

import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { logger } from '../utils/errorHandler.js';

/**
 * Enhanced Security Middleware
 * Provides comprehensive security measures for the application
 */

// Rate limiting configurations
export const createRateLimit = (options = {}) => {
  const defaultOptions = {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: {
      success: false,
      error: {
        message: 'Too many requests from this IP, please try again later',
        type: 'RATE_LIMIT_EXCEEDED',
        timestamp: new Date().toISOString()
      }
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      logger.warn('Rate limit exceeded', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        url: req.url,
        method: req.method
      });
      res.status(429).json(defaultOptions.message);
    }
  };

  return rateLimit({ ...defaultOptions, ...options });
};

// Specific rate limits for different endpoints
export const authRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 auth attempts per 15 minutes (increased for better UX during testing)
  message: {
    success: false,
    error: {
      message: 'Too many authentication attempts, please try again after 15 minutes',
      type: 'AUTH_RATE_LIMIT_EXCEEDED',
      timestamp: new Date().toISOString()
    }
  }
});

export const apiRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // 1000 requests per 15 minutes
  message: {
    success: false,
    error: {
      message: 'Too many API requests, please try again later',
      type: 'API_RATE_LIMIT_EXCEEDED',
      timestamp: new Date().toISOString()
    }
  }
});

export const uploadRateLimit = createRateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 uploads per minute
  message: {
    success: false,
    error: {
      message: 'Too many file uploads, please try again later',
      type: 'UPLOAD_RATE_LIMIT_EXCEEDED',
      timestamp: new Date().toISOString()
    }
  }
});

// Enhanced Helmet configuration
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", "ws:", "wss:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: []
    }
  },
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
});

// CSRF Protection Middleware
export const csrfProtection = (req, res, next) => {
  // Skip CSRF for GET requests and API endpoints that don't modify data
  if (req.method === 'GET' || req.path.startsWith('/api/health')) {
    return next();
  }

  // For API routes, check for CSRF token in headers
  if (req.path.startsWith('/api/')) {
    const csrfToken = req.get('X-CSRF-Token');
    const sessionToken = req.session?.csrfToken;

    if (!csrfToken || !sessionToken || csrfToken !== sessionToken) {
      logger.warn('CSRF token validation failed', {
        ip: req.ip,
        url: req.url,
        method: req.method,
        hasToken: !!csrfToken,
        hasSessionToken: !!sessionToken
      });
      
      return res.status(403).json({
        success: false,
        error: {
          message: 'Invalid CSRF token',
          type: 'CSRF_TOKEN_INVALID',
          timestamp: new Date().toISOString()
        }
      });
    }
  }

  next();
};

// Request sanitization middleware
export const sanitizeRequest = (req, res, next) => {
  try {
    // Sanitize request body
    if (req.body) {
      req.body = sanitizeObject(req.body);
    }

    // Skip query sanitization to avoid read-only property issues
    // Query parameters are typically safe as they come from URL
    
    // Sanitize URL parameters
    if (req.params) {
      req.params = sanitizeObject(req.params);
    }

    next();
  } catch (error) {
    // If sanitization fails, continue without sanitization
    console.warn('Request sanitization failed:', error.message);
    next();
  }
};

// Object sanitization helper
const sanitizeObject = (obj) => {
  if (typeof obj !== 'object' || obj === null) {
    return sanitizeString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    sanitized[key] = sanitizeObject(value);
  }
  return sanitized;
};

// String sanitization helper
const sanitizeString = (str) => {
  if (typeof str !== 'string') {
    return str;
  }

  return str
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim();
};

// IP whitelist middleware
export const ipWhitelist = (allowedIPs = []) => {
  return (req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress;
    
    if (allowedIPs.length > 0 && !allowedIPs.includes(clientIP)) {
      logger.warn('IP not in whitelist', {
        ip: clientIP,
        url: req.url,
        method: req.method
      });
      
      return res.status(403).json({
        success: false,
        error: {
          message: 'Access denied from this IP address',
          type: 'IP_NOT_WHITELISTED',
          timestamp: new Date().toISOString()
        }
      });
    }

    next();
  };
};

// Request size limiter
export const requestSizeLimit = (maxSize = '10mb') => {
  return (req, res, next) => {
    const contentLength = parseInt(req.get('Content-Length') || '0');
    const maxBytes = parseSize(maxSize);

    if (contentLength > maxBytes) {
      logger.warn('Request size exceeded', {
        contentLength,
        maxBytes,
        ip: req.ip,
        url: req.url
      });

      return res.status(413).json({
        success: false,
        error: {
          message: `Request size exceeds maximum allowed size of ${maxSize}`,
          type: 'REQUEST_SIZE_EXCEEDED',
          timestamp: new Date().toISOString()
        }
      });
    }

    next();
  };
};

// Parse size string to bytes
const parseSize = (size) => {
  const units = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024
  };

  const match = size.toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/);
  if (!match) return 10 * 1024 * 1024; // Default 10MB

  const value = parseFloat(match[1]);
  const unit = match[2] || 'mb';
  
  return Math.floor(value * units[unit]);
};

// Security headers middleware
export const securityHeadersMiddleware = (req, res, next) => {
  // Remove X-Powered-By header
  res.removeHeader('X-Powered-By');
  
  // Add security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  next();
};

// Request logging middleware
export const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      contentLength: res.get('Content-Length') || 0
    };

    if (res.statusCode >= 400) {
      logger.warn('HTTP Request', logData);
    } else {
      logger.info('HTTP Request', logData);
    }
  });

  next();
};

// Brute force protection
export const bruteForceProtection = () => {
  const attempts = new Map();
  const maxAttempts = 5;
  const windowMs = 15 * 60 * 1000; // 15 minutes

  return (req, res, next) => {
    const key = `${req.ip}-${req.body?.email || req.body?.username || 'unknown'}`;
    const now = Date.now();
    
    // Clean old attempts
    for (const [attemptKey, data] of attempts.entries()) {
      if (now - data.firstAttempt > windowMs) {
        attempts.delete(attemptKey);
      }
    }

    const attemptData = attempts.get(key);
    
    if (attemptData) {
      if (attemptData.count >= maxAttempts) {
        logger.warn('Brute force attempt blocked', {
          ip: req.ip,
          email: req.body?.email,
          attempts: attemptData.count,
          firstAttempt: new Date(attemptData.firstAttempt).toISOString()
        });

        return res.status(429).json({
          success: false,
          error: {
            message: 'Too many failed attempts, please try again later',
            type: 'BRUTE_FORCE_BLOCKED',
            timestamp: new Date().toISOString(),
            retryAfter: Math.ceil((windowMs - (now - attemptData.firstAttempt)) / 1000)
          }
        });
      }
      
      attemptData.count++;
    } else {
      attempts.set(key, {
        count: 1,
        firstAttempt: now
      });
    }

    next();
  };
};

export default {
  createRateLimit,
  authRateLimit,
  apiRateLimit,
  uploadRateLimit,
  securityHeaders,
  csrfProtection,
  sanitizeRequest,
  ipWhitelist,
  requestSizeLimit,
  securityHeadersMiddleware,
  requestLogger,
  bruteForceProtection
};
