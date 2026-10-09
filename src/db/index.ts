import fs from "fs";
import { drizzle } from 'drizzle-orm/node-postgres'; // Corrected import path for drizzle
import { Pool } from 'pg';
import * as schema from './schema.ts'; // Import all schema definitions
import dotenv from 'dotenv';
dotenv.config();

const caCert = fs.readFileSync("rds-ca.pem").toString();

const pool = new Pool({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASS,
    database: process.env.DATABASE_NAME,
    ssl: process.env.DATABASE_SSL === "true" ? {
      ca:caCert,
      requestCert:true
    } : false
});

export const db = drizzle(pool, { schema });

// Example for closing the pool (useful for graceful shutdown)
process.on('SIGINT', () => {
  pool.end().then(() => {
    console.log('Database pool closed.');
    process.exit(0);
  });
});

// Ensure pool is exported
export { pool }; 
