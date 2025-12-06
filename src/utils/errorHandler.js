// src/utils/errorHandler.js

/**
 * Centralized Error Handling Utility
 * Provides consistent error handling across the application
 */

export class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.timestamp = new Date().toISOString();
    
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message, field = null) {
    super(message, 400);
    this.field = field;
    this.type = 'VALIDATION_ERROR';
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401);
    this.type = 'AUTHENTICATION_ERROR';
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403);
    this.type = 'AUTHORIZATION_ERROR';
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404);
    this.type = 'NOT_FOUND_ERROR';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409);
    this.type = 'CONFLICT_ERROR';
  }
}

/**
 * Centralized logging utility
 */
export const logger = {
  info: (message, data = {}) => {
    console.log(`[INFO] ${new Date().toISOString()} - ${message}`, data);
  },
  
  warn: (message, data = {}) => {
    console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, data);
  },
  
  error: (message, error = {}, data = {}) => {
    console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, {
      error: error.message || error,
      stack: error.stack,
      ...data
    });
  },
  
  debug: (message, data = {}) => {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[DEBUG] ${new Date().toISOString()} - ${message}`, data);
    }
  }
};

/**
 * API Error Response Formatter
 */
export const formatErrorResponse = (error, req = null) => {
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  const response = {
    success: false,
    error: {
      message: error.message || 'An unexpected error occurred',
      type: error.type || 'UNKNOWN_ERROR',
      timestamp: error.timestamp || new Date().toISOString(),
      ...(error.field && { field: error.field })
    }
  };
  
  // Add additional debug info in development
  if (isDevelopment) {
    response.error.stack = error.stack;
    response.error.url = req?.url;
    response.error.method = req?.method;
  }
  
  return response;
};

/**
 * Async Error Wrapper
 * Wraps async functions to catch errors and pass them to error middleware
 */
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Error Handler Middleware
 */
export const errorHandler = (error, req, res, next) => {
  logger.error('Unhandled error occurred', error, {
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  
  // Default error
  let statusCode = 500;
  let message = 'Internal Server Error';
  
  if (error instanceof AppError) {
    statusCode = error.statusCode;
    message = error.message;
  } else if (error.name === 'ValidationError') {
    statusCode = 400;
    message = error.message || 'Validation Error';
  } else if (error.name === 'CastError') {
    statusCode = 400;
    message = 'Invalid ID format';
  } else if (error.code === 11000) {
    statusCode = 409;
    message = 'Duplicate field value';
  } else if (error.code === 'ER_DUP_ENTRY') {
    statusCode = 409;
    message = 'Duplicate entry';
  } else if (error.code === 'ER_NO_REFERENCED_ROW_2') {
    statusCode = 400;
    message = 'Referenced record does not exist';
  } else if (error.code === 'ER_ROW_IS_REFERENCED_2') {
    statusCode = 400;
    message = 'Cannot delete record that is referenced by other records';
  } else if (error.code === 'ER_NO_SUCH_TABLE') {
    statusCode = 500;
    message = 'Database table not found';
  } else if (error.code === 'ER_BAD_DB_ERROR') {
    statusCode = 500;
    message = 'Database connection error';
  } else if (error.message) {
    message = error.message;
  }
  
  const errorResponse = formatErrorResponse({
    ...error,
    statusCode,
    message
  }, req);
  
  res.status(statusCode).json(errorResponse);
};

/**
 * 404 Handler
 */
export const notFoundHandler = (req, res, next) => {
  const error = new NotFoundError(`Route ${req.originalUrl}`);
  next(error);
};











