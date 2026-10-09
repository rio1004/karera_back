import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();  // Load environment variables

async function recreateTables() {
  const pool = new Pool({
    user: process.env.DATABASE_USER || 'postgres',
    host: process.env.DATABASE_HOST || 'localhost',
    password: process.env.DATABASE_PASS || 'postgres',
    port: parseInt(process.env.DATABASE_PORT || '5432'),
  });

  try {
    const client = await pool.connect();
    console.log('Connected to default database for operations');

    const targetDatabase = process.env.DATABASE_NAME || 'karera';

    // Drop the database if it exists
    await client.query(`DROP DATABASE IF EXISTS ${targetDatabase};`);
    console.log(`Database ${targetDatabase} dropped.`);

    // Create the new database
    await client.query(`CREATE DATABASE ${targetDatabase};`);
    console.log(`Database ${targetDatabase} created.`);

    console.log('Database recreated successfully. Run your migrations next to rebuild the schema.');
    process.exit(0); // Force immediate exit on success
  } catch (error) {
    console.error('Error recreating database:', error);
    process.exit(1); // Exit with a non-zero code on error
  } finally {
    await pool.end(); // This line will not be reached due to process.exit()
  }
}

(async () => {
  const success = await recreateTables();
  // The line below is now redundant as process.exit is called within recreateTables
  // process.exit(0);
})();
