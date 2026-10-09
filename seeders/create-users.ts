import { db, pool } from '../src/db/index.ts';
import {
  UsersTable,
  ProfilesTable,
  WalletTable,
  TransactionsTable,
} from '../src/db/schema.ts';
import bcrypt from 'bcrypt';
import { and, eq, sql } from 'drizzle-orm';
import { Utils } from '../tests/utils/utils.ts';

async function createUsers() {
  const totalUsers = 10000; // you can adjust
  const batchSize = 100;

  try {
    console.log(`Starting creation of ${totalUsers} users...`);

    const client = await pool.connect();
    console.log('Database connection successful!');
    client.release();

    const password = 'password123';
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    console.log('Password hashed successfully');

    let createdCount = 0;
    const now = new Date();

    for (let batchStart = 0; batchStart < totalUsers; batchStart += batchSize) {
      await db.transaction(async (tx) => {
        const usersBatch = [];

        for (let i = 0; i < batchSize && createdCount < totalUsers; i++) {
          const id = batchStart + i + 1; // sequential ID for naming
          const type = 'player'; // can randomize if needed

          // Insert user
          const [newUser] = await tx.insert(UsersTable).values({
            firstName: `TestFirst${id}`,
            lastName: `TestLast${id}`,
            userName: `testuser${id}`,
            email: `testuser${id}@example.com`,
            mobile: `+639${String(900000000 + id).padStart(9, '0')}`,
            type,
            hashedPassword,
          }).returning();

          // eKYC
          await Utils.createEkyc(tx, {
            userId: newUser.id
          });

          // Profile
          await tx.insert(ProfilesTable).values({
            userId: newUser.id,
            permanentAddress: `Test Address ${id}`,
            currentAddress: `Test Current Address ${id}`,
            birthDate: '1995-01-01',
            birthPlace: "Test City",
            nationality: "Testland",
            gamingSite: "TestSite",
            natureOfWork: "Testing",
            sourceOfIncome: "TestSource",
            meta: { nickname: `testuser${id}` },
          });

          // Wallets
          const walletTypes: Array<'game' | 'commission' | 'load'> = ['game'];
          if (['operator', 'representative'].includes(type)) {
            walletTypes.push('commission', 'load');
          }

          const walletInsertData = walletTypes.map((walletType) => ({
            userId: newUser.id,
            balance: '0',
            onHoldBalance: '0',
            status: 'active' as const,
            type: walletType,
            createdAt: now,
            updatedAt: now,
          }));

          await tx.insert(WalletTable).values(walletInsertData);

          // Initial deposit 10,000 to game wallet
          await tx.insert(TransactionsTable).values({
            userId: newUser.id,
            type: 'deposit',
            status: 'completed',
            amount: '10000.0000',
          });

          await tx
            .update(WalletTable)
            .set({
              balance: sql`${WalletTable.balance} + ${'10000.0000'}`,
              updatedAt: now,
            })
            .where(and(eq(WalletTable.userId, newUser.id), eq(WalletTable.type, 'game')));

          createdCount++;
        }
      });

      console.log(`Inserted batch ${batchStart / batchSize + 1}`);
    }

    console.log(`✅ Successfully created ${createdCount} users`);
    console.log(`All users have password: ${password}`);

  } catch (error: any) {
    console.error('❌ Error creating users:', error);
    throw error;
  } finally {
    await pool.end();
    console.log('Database pool closed.');
  }
}

// Run seeder
console.log('Seeder script started...');
createUsers()
  .then(() => {
    console.log('Seeder completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Seeder failed:', error);
    process.exit(1);
  });

export { createUsers };