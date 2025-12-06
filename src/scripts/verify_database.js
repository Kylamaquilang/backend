#!/usr/bin/env node
// Database Verification Script
// Run this to check if your database is properly set up

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'capstone',
  port: process.env.DB_PORT || 3306,
  charset: 'utf8mb4',
};

async function verifyDatabase() {
  let connection;
  
  try {
    console.log('🔍 Verifying database setup...');
    console.log('📋 Database config:', {
      host: dbConfig.host,
      user: dbConfig.user,
      database: dbConfig.database,
      port: dbConfig.port
    });
    
    // Test connection
    console.log('🔌 Testing database connection...');
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ Database connected successfully');
    
    // Check if database exists
    console.log('🗄️ Checking database...');
    const [databases] = await connection.execute('SHOW DATABASES LIKE ?', [dbConfig.database]);
    if (databases.length === 0) {
      console.log('❌ Database "capstone" does not exist');
      console.log('💡 Run: mysql -u root -p < capstone_database_schema.sql');
      return false;
    }
    console.log('✅ Database "capstone" exists');
    
    // Check required tables
    console.log('📋 Checking required tables...');
    const requiredTables = [
      'users', 'categories', 'products', 'product_sizes', 'cart_items',
      'orders', 'order_items', 'order_status_logs', 'payment_transactions',
      'inventory_movements', 'stock_movements', 'sales_logs', 'notifications',
      'password_reset_codes'
    ];
    
    const [tables] = await connection.execute(`
      SELECT TABLE_NAME 
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
    `, [dbConfig.database]);
    
    const existingTables = tables.map(row => row.TABLE_NAME);
    const missingTables = requiredTables.filter(table => !existingTables.includes(table));
    
    if (missingTables.length > 0) {
      console.log('❌ Missing tables:', missingTables);
      console.log('💡 Run: mysql -u root -p capstone < capstone_database_schema.sql');
      return false;
    }
    
    console.log('✅ All required tables exist');
    
    // Check sample data
    console.log('📊 Checking sample data...');
    const [userCount] = await connection.execute('SELECT COUNT(*) as count FROM users');
    const [productCount] = await connection.execute('SELECT COUNT(*) as count FROM products');
    const [categoryCount] = await connection.execute('SELECT COUNT(*) as count FROM categories');
    
    console.log(`📈 Data counts:`, {
      users: userCount[0].count,
      products: productCount[0].count,
      categories: categoryCount[0].count
    });
    
    if (userCount[0].count === 0) {
      console.log('⚠️ No users found. Admin user should be created.');
    }
    
    if (productCount[0].count === 0) {
      console.log('⚠️ No products found. Sample products should be created.');
    }
    
    // Test a simple query
    console.log('🧪 Testing sample query...');
    const [testResult] = await connection.execute(`
      SELECT 
        COUNT(*) as total_orders,
        SUM(total_amount) as total_revenue
      FROM orders
    `);
    
    console.log('✅ Sample query successful:', testResult[0]);
    
    console.log('🎉 Database verification completed successfully!');
    return true;
    
  } catch (error) {
    console.error('❌ Database verification failed:', error.message);
    
    if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.log('💡 Check your database credentials in .env file');
    } else if (error.code === 'ER_BAD_DB_ERROR') {
      console.log('💡 Database does not exist. Create it first.');
    } else if (error.code === 'ECONNREFUSED') {
      console.log('💡 MySQL service is not running. Start MySQL service.');
    } else if (error.code === 'ETIMEDOUT') {
      console.log('💡 Connection timeout. Check MySQL port (should be 3306).');
    }
    
    return false;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Run verification
verifyDatabase().then(success => {
  process.exit(success ? 0 : 1);
});
