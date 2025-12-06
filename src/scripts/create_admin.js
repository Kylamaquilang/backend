import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import bcrypt from 'bcrypt';

dotenv.config();

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  port: process.env.DB_PORT || 3306,
  database: 'capstone',
  charset: 'utf8mb4',
};

async function createAdmin() {
  let connection;
  
  try {
    console.log('🚀 Creating admin user...');
    
    // Connect to database
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ Connected to database');
    
    // Get admin credentials from command line or use defaults
    const email = process.argv[2] || 'acounting.office.cpc@gmail.com';
    const password = process.argv[3] || 'accountingoffice';
    const name = process.argv[4] || 'System Administrator';
    
    console.log(`📝 Creating admin with email: ${email}`);
    
    // Hash the password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    // Check if admin already exists
    const [existingAdmin] = await connection.execute(
      'SELECT id FROM users WHERE email = ? OR (role = "admin" AND student_id IS NULL)',
      [email]
    );
    
    if (existingAdmin.length > 0) {
      // Update existing admin
      await connection.execute(
        'UPDATE users SET password = ?, name = ?, email = ? WHERE id = ?',
        [hashedPassword, name, email, existingAdmin[0].id]
      );
      console.log('✅ Admin password updated successfully!');
    } else {
      // Create new admin
      await connection.execute(
        'INSERT INTO users (student_id, name, email, password, role) VALUES (?, ?, ?, ?, ?)',
        [null, name, email, hashedPassword, 'admin']
      );
      console.log('✅ Admin user created successfully!');
    }
    
    console.log('\n🎉 Admin credentials:');
    console.log(`📧 Email: ${email}`);
    console.log(`🔑 Password: ${password}`);
    console.log(`👤 Name: ${name}`);
    console.log('\n💡 You can now login to the admin panel!');
    
    await connection.end();
    
  } catch (error) {
    console.error('❌ Failed to create admin:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.log('\n💡 Make sure MySQL server is running');
    } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.log('\n💡 Check your database credentials in .env file');
    }
    
    process.exit(1);
  }
}

// Run the script
createAdmin();



















