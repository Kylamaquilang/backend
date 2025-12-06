import { pool } from '../database/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  try {
    console.log('🔄 Starting size_id column migration for stock_movements table...\n');
    
    // Read the SQL migration file
    const sqlFilePath = path.join(__dirname, '../schema/migration_add_size_to_stock_movements.sql');
    const sqlContent = fs.readFileSync(sqlFilePath, 'utf8');
    
    // Split by semicolons and filter out empty statements
    const statements = sqlContent
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    console.log(`📝 Found ${statements.length} SQL statements to execute\n`);
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement && statement.trim().length > 0) {
        try {
          const [result] = await pool.query(statement + ';');
          console.log(`✅ Statement ${i + 1}/${statements.length} executed successfully`);
          
          // If this is the final SELECT statement, show the message
          if (statement.includes('Migration completed')) {
            console.log(`\n✨ ${result[0]?.message || 'Migration completed'}\n`);
          }
        } catch (error) {
          // Some statements might fail if the column/index already exists, that's okay
          if (error.code === 'ER_DUP_FIELDNAME' || error.code === 'ER_DUP_KEYNAME') {
            console.log(`⚠️  Statement ${i + 1}/${statements.length} skipped (already exists)`);
          } else {
            console.error(`❌ Error executing statement ${i + 1}:`, error.message);
          }
        }
      }
    }
    
    // Verify the column exists now
    console.log('\n🔍 Verifying size_id column...');
    const [columns] = await pool.query(`
      SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'stock_movements'
      AND COLUMN_NAME = 'size_id'
    `);
    
    if (columns.length > 0) {
      console.log('✅ size_id column verified:');
      console.log(`   - Type: ${columns[0].COLUMN_TYPE}`);
      console.log(`   - Nullable: ${columns[0].IS_NULLABLE}`);
      console.log(`   - Key: ${columns[0].COLUMN_KEY || 'None'}`);
    } else {
      console.log('❌ size_id column not found - migration may have failed');
    }
    
    // Check for existing data
    const [existingRecords] = await pool.query(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN size_id IS NOT NULL THEN 1 ELSE 0 END) as with_size
      FROM stock_movements
    `);
    
    console.log('\n📊 Stock movements table status:');
    console.log(`   - Total records: ${existingRecords[0].total}`);
    console.log(`   - Records with size: ${existingRecords[0].with_size}`);
    console.log(`   - Records without size: ${existingRecords[0].total - existingRecords[0].with_size}`);
    
    console.log('\n✅ Migration completed successfully!');
    console.log('\n💡 Next steps:');
    console.log('   1. Try restocking a product with a specific size');
    console.log('   2. Check the Restock Report to verify sizes are now displayed');
    console.log('   3. Existing records without sizes will show "N/A" or "No size specified"\n');
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    console.error('\nError details:', error.message);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

// Run the migration
runMigration();

