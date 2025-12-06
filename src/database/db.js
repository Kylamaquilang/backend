import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

// Database configuration
// Support both Railway's standard env vars (MYSQLHOST, MYSQLUSER, etc.) and custom ones (DB_HOST, etc.)
const dbConfig = {
  host: process.env.MYSQLHOST || process.env.DB_HOST || 'localhost',
  user: process.env.MYSQLUSER || process.env.DB_USER || 'root',
  password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || '',
  database: process.env.MYSQLDATABASE || process.env.DB_NAME || 'capstone',
  port: process.env.MYSQLPORT || process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 60000, // Time to wait for initial connection
  charset: 'utf8mb4',
};

// Create connection pool
export const pool = mysql.createPool(dbConfig);

// Test database connection
export const testConnection = async () => {
  try {
    const connection = await pool.getConnection();
    connection.release();
    return true;
  } catch (error) {
    console.error('Database connection failed:', error.message);
    return false;
  }
};

// Initialize database connection
export const initializeDatabase = async () => {
  try {
    await testConnection();
    
    await pool.query('SELECT 1 as test');
    return true;
  } catch (error) {
    console.error('Database initialization failed:', error.message);
    return false;
  }
};

// Graceful shutdown for database connections
export const closeDatabase = async () => {
  try {
    await pool.end();
  } catch (error) {
    console.error('Error closing database connections:', error.message);
  }
};

// Handle database errors
pool.on('error', (err) => {
  console.error('Database pool error:', err);
  if (err.code === 'PROTOCOL_CONNECTION_LOST') {
    // Database connection was closed
  } else if (err.code === 'ER_CON_COUNT_ERROR') {
    console.error('Database has too many connections.');
  } else if (err.code === 'ECONNREFUSED') {
    console.error('Database connection was refused.');
  }
});

// Auto-initialize on import
if (process.env.NODE_ENV !== 'test') {
  initializeDatabase();
}