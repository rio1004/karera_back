import { db, pool } from '../src/db/index.ts';
import { WalletTable, UsersTable } from '../src/db/schema.ts';
import { eq, count, isNull } from 'drizzle-orm';

async function createWallets() {
  const chunkSize = 2000;
  
  try {
    console.log('Starting wallet creation...');

    // Test database connection
    const client = await pool.connect();
    client.release();

    // Quick sanity: how many users exist?
    const totalUsersResult = await db.select({ count: count() }).from(UsersTable);
    const totalUsers = Number(totalUsersResult[0]?.count || 0);
    if (totalUsers === 0) {
      console.log('No users found in database. Please run the user seeder first.');
      return;
    }
    console.log(`Users in DB: ${totalUsers}`);

    // Fetch only users who do NOT have a wallet yet
    console.log('Querying users without wallets...');
    const usersWithoutWallets = await db
      .select({ id: UsersTable.id })
      .from(UsersTable)
      .leftJoin(WalletTable, eq(WalletTable.userId, UsersTable.id))
      .where(isNull(WalletTable.userId));

    if (usersWithoutWallets.length === 0) {
      console.log('All users already have wallets. Nothing to do.');
      return;
    }

    console.log(`Creating wallets for ${usersWithoutWallets.length} users...`);

    const now = new Date();
    let created = 0;

    for (let i = 0; i < usersWithoutWallets.length; i += chunkSize) {
      const chunk = usersWithoutWallets.slice(i, i + chunkSize);
      const values = chunk.map(({ id }) => ({
        userId: id,
        balance: '0',
        status: 'active' as const,
        createdAt: now,
        updatedAt: now,
        pinHash: null,
      }));

      await db.insert(WalletTable).values(values);
      created += values.length;

      // lightweight progress log
      const done = Math.min(i + chunkSize, usersWithoutWallets.length);
      console.log(`Inserted ${done}/${usersWithoutWallets.length} wallets`);
    }

    console.log('Wallet creation completed.');
    console.log(`Total wallets created: ${created}`);
  } catch (error) {
    console.error('Error creating wallets:', error);
    throw error;
  } finally {
    await pool.end();
    console.log('Database pool closed.');
  }
}

// Run the seeder immediately
console.log('Wallet seeder script started...');
createWallets()
  .then(() => {
    console.log('Wallet seeder completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Wallet seeder failed:', error);
    process.exit(1);
  });

export { createWallets };
