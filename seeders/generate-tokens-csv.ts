import { db, pool } from '../src/db/index.ts';
import { UsersTable } from '../src/db/schema.ts';
import { count } from 'drizzle-orm';
import { create_app } from '../src/app.ts';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

async function generateTokensCsv() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, '..', '..'); // ../../../GameAggregator
  dotenv.config({ path: path.join(repoRoot, '.env') });  // ensure JWT keys are loaded

  const batchSize = 1000;
  const outDir = path.resolve(__dirname, 'source');
  const outFile = path.join(outDir, '10000_tokens.csv');

  try {
    console.log('Starting token CSV generation for all users...');
    console.log(`Writing to: ${outFile}`);
    fs.mkdirSync(outDir, { recursive: true });

    const app = create_app(true);
    await app.ready();
    const signer: any = (app as any).jwt;
    if (!signer?.sign) {
      throw new Error('JWT signer not available. Check JWT_PRIVATE_KEY/JWT_PUBLIC_KEY env vars.');
    }

    const totalUsersResult = await db.select({ count: count() }).from(UsersTable);
    const totalUsers = Number(totalUsersResult[0]?.count || 0);
    if (totalUsers === 0) {
      console.log('No users found.');
      return;
    }

    const stream = fs.createWriteStream(outFile, { encoding: 'utf8' });
    stream.write('userName,token\n');

    let processed = 0;
    for (let offset = 0; offset < totalUsers; offset += batchSize) {
      const users = await db.select().from(UsersTable).limit(batchSize).offset(offset);
      for (const u of users) {
        const payload = {
          id: u.id,
          userName: u.userName,
          email: u.email,
          firstName: u.firstName,
          lastName: u.lastName,
          mobile: u.mobile,
          type: u.type,
        };
        const token: string = signer.sign(payload);
        stream.write(`${u.userName},${token}\n`);
        processed += 1;
      }
      console.log(`Generated tokens for ${processed}/${totalUsers} users...`);
    }

    await new Promise((resolve) => stream.end(resolve)); // wait flush
    await app.close();
    console.log(`Tokens CSV written: ${outFile}`);
  } catch (error) {
    console.error('Error generating tokens CSV:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

console.log('Token CSV generator started...');
generateTokensCsv()
  .then(() => { console.log('Token CSV generator done'); process.exit(0); })
  .catch((e) => { console.error('Generator failed:', e); process.exit(1); });