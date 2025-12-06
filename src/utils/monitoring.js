// src/utils/monitoring.js

/**
 * Application Monitoring and Logging System
 * Provides comprehensive monitoring, logging, and analytics
 */

import { logger } from './errorHandler.js';

/**
 * Performance Monitoring
 */
export class PerformanceMonitor {
  constructor() {
    this.metrics = new Map();
    this.startTimes = new Map();
  }

  startTimer(name) {
    this.startTimes.set(name, Date.now());
  }

  endTimer(name) {
    const startTime = this.startTimes.get(name);
    if (!startTime) {
      logger.warn(`Timer '${name}' was not started`);
      return null;
    }

    const duration = Date.now() - startTime;
    this.startTimes.delete(name);
    
    // Store metric
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    this.metrics.get(name).push(duration);

    logger.info(`Performance metric: ${name}`, { duration: `${duration}ms` });
    return duration;
  }

  getAverageTime(name) {
    const times = this.metrics.get(name) || [];
    if (times.length === 0) return 0;
    
    return times.reduce((sum, time) => sum + time, 0) / times.length;
  }

  getMetrics() {
    const result = {};
    for (const [name, times] of this.metrics.entries()) {
      result[name] = {
        count: times.length,
        average: this.getAverageTime(name),
        min: Math.min(...times),
        max: Math.max(...times),
        total: times.reduce((sum, time) => sum + time, 0)
      };
    }
    return result;
  }

  reset() {
    this.metrics.clear();
    this.startTimes.clear();
  }
}

/**
 * API Request Monitoring
 */
export class APIRequestMonitor {
  constructor() {
    this.requests = new Map();
    this.endpoints = new Map();
  }

  startRequest(req) {
    const requestId = `${req.method}-${req.path}-${Date.now()}`;
    const requestData = {
      id: requestId,
      method: req.method,
      path: req.path,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      startTime: Date.now(),
      userId: req.user?.id || null
    };

    this.requests.set(requestId, requestData);
    return requestId;
  }

  endRequest(requestId, statusCode, responseTime) {
    const requestData = this.requests.get(requestId);
    if (!requestData) return;

    const request = {
      ...requestData,
      statusCode,
      responseTime,
      endTime: Date.now(),
      duration: Date.now() - requestData.startTime
    };

    // Update endpoint statistics
    const endpointKey = `${request.method}-${request.path}`;
    if (!this.endpoints.has(endpointKey)) {
      this.endpoints.set(endpointKey, {
        count: 0,
        totalTime: 0,
        errors: 0,
        avgResponseTime: 0
      });
    }

    const endpointStats = this.endpoints.get(endpointKey);
    endpointStats.count++;
    endpointStats.totalTime += request.duration;
    endpointStats.avgResponseTime = endpointStats.totalTime / endpointStats.count;

    if (statusCode >= 400) {
      endpointStats.errors++;
    }

    // Log request
    logger.info('API Request completed', {
      method: request.method,
      path: request.path,
      statusCode,
      duration: `${request.duration}ms`,
      userId: request.userId
    });

    this.requests.delete(requestId);
  }

  getEndpointStats() {
    const result = {};
    for (const [endpoint, stats] of this.endpoints.entries()) {
      result[endpoint] = {
        ...stats,
        errorRate: stats.count > 0 ? (stats.errors / stats.count) * 100 : 0
      };
    }
    return result;
  }

  getSlowRequests(threshold = 1000) {
    const slowRequests = [];
    for (const [requestId, request] of this.requests.entries()) {
      if (Date.now() - request.startTime > threshold) {
        slowRequests.push({
          ...request,
          currentDuration: Date.now() - request.startTime
        });
      }
    }
    return slowRequests;
  }
}

/**
 * Database Query Monitoring
 */
export class DatabaseMonitor {
  constructor() {
    this.queries = new Map();
    this.slowQueries = [];
  }

  startQuery(query, params = []) {
    const queryId = `query-${Date.now()}-${Math.random()}`;
    const queryData = {
      id: queryId,
      query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
      params: params.length,
      startTime: Date.now()
    };

    this.queries.set(queryId, queryData);
    return queryId;
  }

  endQuery(queryId, rowsAffected = 0, error = null) {
    const queryData = this.queries.get(queryId);
    if (!queryData) return;

    const duration = Date.now() - queryData.startTime;
    const queryInfo = {
      ...queryData,
      duration,
      rowsAffected,
      error: error?.message || null,
      endTime: Date.now()
    };

    // Track slow queries
    if (duration > 1000) { // Queries taking more than 1 second
      this.slowQueries.push(queryInfo);
      logger.warn('Slow database query detected', {
        query: queryInfo.query,
        duration: `${duration}ms`,
        rowsAffected
      });
    }

    // Log query
    logger.debug('Database query completed', {
      query: queryInfo.query,
      duration: `${duration}ms`,
      rowsAffected,
      error: queryInfo.error
    });

    this.queries.delete(queryId);
  }

  getSlowQueries(limit = 10) {
    return this.slowQueries
      .sort((a, b) => b.duration - a.duration)
      .slice(0, limit);
  }

  getQueryStats() {
    return {
      activeQueries: this.queries.size,
      slowQueriesCount: this.slowQueries.length,
      averageSlowQueryTime: this.slowQueries.length > 0 
        ? this.slowQueries.reduce((sum, q) => sum + q.duration, 0) / this.slowQueries.length 
        : 0
    };
  }
}

/**
 * Memory Usage Monitoring
 */
export class MemoryMonitor {
  constructor() {
    this.samples = [];
    this.maxSamples = 100;
  }

  sample() {
    const memUsage = process.memoryUsage();
    const sample = {
      timestamp: Date.now(),
      rss: memUsage.rss,
      heapTotal: memUsage.heapTotal,
      heapUsed: memUsage.heapUsed,
      external: memUsage.external,
      arrayBuffers: memUsage.arrayBuffers
    };

    this.samples.push(sample);
    
    // Keep only recent samples
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }

    // Log if memory usage is high
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
    if (heapUsedMB > 500) { // More than 500MB
      logger.warn('High memory usage detected', {
        heapUsed: `${heapUsedMB.toFixed(2)}MB`,
        heapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(2)}MB`
      });
    }

    return sample;
  }

  getMemoryStats() {
    if (this.samples.length === 0) return null;

    const latest = this.samples[this.samples.length - 1];
    const avgHeapUsed = this.samples.reduce((sum, s) => sum + s.heapUsed, 0) / this.samples.length;
    const maxHeapUsed = Math.max(...this.samples.map(s => s.heapUsed));

    return {
      current: {
        heapUsed: `${(latest.heapUsed / 1024 / 1024).toFixed(2)}MB`,
        heapTotal: `${(latest.heapTotal / 1024 / 1024).toFixed(2)}MB`,
        rss: `${(latest.rss / 1024 / 1024).toFixed(2)}MB`
      },
      average: {
        heapUsed: `${(avgHeapUsed / 1024 / 1024).toFixed(2)}MB`
      },
      peak: {
        heapUsed: `${(maxHeapUsed / 1024 / 1024).toFixed(2)}MB`
      },
      samples: this.samples.length
    };
  }
}

/**
 * Error Tracking
 */
export class ErrorTracker {
  constructor() {
    this.errors = [];
    this.errorCounts = new Map();
    this.maxErrors = 1000;
  }

  trackError(error, context = {}) {
    const errorInfo = {
      id: Date.now() + Math.random(),
      message: error.message || error,
      stack: error.stack,
      timestamp: Date.now(),
      context,
      type: error.constructor?.name || 'Error'
    };

    this.errors.push(errorInfo);
    
    // Keep only recent errors
    if (this.errors.length > this.maxErrors) {
      this.errors.shift();
    }

    // Count error types
    const errorKey = `${errorInfo.type}:${errorInfo.message}`;
    this.errorCounts.set(errorKey, (this.errorCounts.get(errorKey) || 0) + 1);

    logger.error('Error tracked', errorInfo);
  }

  getErrorStats() {
    const recentErrors = this.errors.filter(
      e => Date.now() - e.timestamp < 24 * 60 * 60 * 1000 // Last 24 hours
    );

    const errorTypes = {};
    for (const [key, count] of this.errorCounts.entries()) {
      errorTypes[key] = count;
    }

    return {
      totalErrors: this.errors.length,
      recentErrors: recentErrors.length,
      errorTypes,
      topErrors: Array.from(this.errorCounts.entries())
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .map(([error, count]) => ({ error, count }))
    };
  }
}

/**
 * System Health Monitor
 */
export class SystemHealthMonitor {
  constructor() {
    this.performanceMonitor = new PerformanceMonitor();
    this.apiMonitor = new APIRequestMonitor();
    this.dbMonitor = new DatabaseMonitor();
    this.memoryMonitor = new MemoryMonitor();
    this.errorTracker = new ErrorTracker();
    
    this.startTime = Date.now();
    this.uptime = 0;
  }

  update() {
    this.uptime = Date.now() - this.startTime;
    this.memoryMonitor.sample();
  }

  getHealthStatus() {
    const memoryStats = this.memoryMonitor.getMemoryStats();
    const errorStats = this.errorTracker.getErrorStats();
    const dbStats = this.dbMonitor.getQueryStats();
    const apiStats = this.apiMonitor.getEndpointStats();

    // Determine overall health
    let status = 'healthy';
    const issues = [];

    // Check memory usage
    if (memoryStats && parseFloat(memoryStats.current.heapUsed) > 1000) {
      status = 'warning';
      issues.push('High memory usage');
    }

    // Check error rate
    if (errorStats.recentErrors > 100) {
      status = 'warning';
      issues.push('High error rate');
    }

    // Check slow queries
    if (dbStats.slowQueriesCount > 10) {
      status = 'warning';
      issues.push('Multiple slow database queries');
    }

    return {
      status,
      uptime: this.uptime,
      timestamp: Date.now(),
      memory: memoryStats,
      errors: errorStats,
      database: dbStats,
      api: apiStats,
      issues
    };
  }

  getMetrics() {
    return {
      performance: this.performanceMonitor.getMetrics(),
      api: this.apiMonitor.getEndpointStats(),
      database: this.dbMonitor.getQueryStats(),
      memory: this.memoryMonitor.getMemoryStats(),
      errors: this.errorTracker.getErrorStats()
    };
  }
}

// Global monitoring instance
export const systemHealth = new SystemHealthMonitor();

// Start periodic monitoring
setInterval(() => {
  systemHealth.update();
}, 30000); // Update every 30 seconds

// Export individual monitors for specific use
export {
  PerformanceMonitor,
  APIRequestMonitor,
  DatabaseMonitor,
  MemoryMonitor,
  ErrorTracker
};











