import fs from "fs";
import type { Config } from 'drizzle-kit';
import * as dotenv from 'dotenv';
dotenv.config();

const caCert = process.env.DATABASE_SSL === "true"
  ? fs.readFileSync("rds-ca.pem", "utf8")
  : undefined;

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',

  dbCredentials: {
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASS,
    database: process.env.DATABASE_NAME,
    ssl: process.env.DATABASE_SSL === "true" ? {
      ca:caCert,
      requestCert:true
    } : false
  },
} satisfies Config;