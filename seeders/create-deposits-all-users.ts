import { db, pool } from '../src/db/index.ts';
import { TransactionsTable, UsersTable, WalletTable } from '../src/db/schema.ts';
import { count, eq, sql } from 'drizzle-orm';

async function createDepositsForAllUsers() {
  const batchSize = 1000;
  const depositAmount = '10000.0000';

  try {
    console.log('Starting deposit creation for all users...');
    const client = await pool.connect();
    console.log('Database connection successful!');
    client.release();

    const totalUsersResult = await db.select({ count: count() }).from(UsersTable);
    const totalUsers = Number(totalUsersResult[0]?.count || 0);
    if (totalUsers === 0) {
      console.log('No users found.');
      return;
    }

    let processed = 0;
    let created = 0;

    for (let offset = 0; offset < totalUsers; offset += batchSize) {
      const users = await db.select().from(UsersTable).limit(batchSize).offset(offset);

      for (const user of users) {
        try {
          // Create the deposit transaction
          await db.insert(TransactionsTable).values({
            userId: user.id,
            receiverId: user.id,
            type: 'deposit',
            amount: depositAmount,
            status: 'completed',
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          // Directly increment wallet balance atomically in SQL
          await db
            .update(WalletTable)
            .set({
              // balance = balance + depositAmount
              balance: sql`${WalletTable.balance} + ${depositAmount}`,
              updatedAt: new Date(),
            })
            .where(eq(WalletTable.userId, user.id));

          created += 1;
        } catch (e) {
          console.error(`Failed deposit/balance update for user ${user.userName}:`, e);
        }
        processed += 1;
      }
      console.log(`Processed ${processed}/${totalUsers} users...`);
    }

    console.log(`Done. Created ${created} deposits of ${depositAmount}`);
  } catch (error) {
    console.error('Error creating deposits for all users:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

console.log('All-users deposit seeder started...');
createDepositsForAllUsers()
  .then(() => { console.log('All-users deposit seeder done'); process.exit(0); })
  .catch((e) => { console.error('Seeder failed:', e); process.exit(1); });

export { createDepositsForAllUsers };


