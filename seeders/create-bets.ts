import { db, pool } from '../src/db/index.ts';
import { BetsTable, GamesTable, GameSessionsTable, TransactionsTable, UsersTable } from '../src/db/schema.ts';
import { count, eq } from 'drizzle-orm';

async function createBets() {
  const chunkSize = 2000;

  try {
    console.log('Starting bet creation...');

    // Test DB connection
    const client = await pool.connect();
    client.release();

    // Sanity check: count users
    const totalUsersResult = await db.select({ count: count() }).from(UsersTable);
    const totalUsers = Number(totalUsersResult[0]?.count || 0);
    if (totalUsers === 0) {
      console.log('No users found. Please run the user seeder first.');
      return;
    }

    // Fetch game sessions (with their linked games)
    const gameSessions = await db
      .select({
        id: GameSessionsTable.id,
        gameId: GameSessionsTable.gameId,
      })
      .from(GameSessionsTable);

    if (gameSessions.length === 0) {
      console.log('No game sessions found. Please seed gameSessions first.');
      return;
    }

    // Fetch all games
    const games = await db.select().from(GamesTable);

    if (games.length === 0) {
      console.log('No games found. Please seed games first.');
      return;
    }

    // Fetch transactions
    const transactions = await db.select().from(TransactionsTable);
    if (transactions.length === 0) {
      console.log('No transactions found. Please seed transactions first.');
      return;
    }

    console.log(
      `Users: ${totalUsers}, Games: ${games.length}, Sessions: ${gameSessions.length}, Transactions: ${transactions.length}`
    );

    const now = new Date();
    let created = 0;

    const fakeBetAmount = 1000; // baseline bet

    for (let i = 0; i < totalUsers; i += chunkSize) {
      const usersChunk = await db
        .select({ id: UsersTable.id })
        .from(UsersTable)
        .limit(chunkSize)
        .offset(i);

      const values = usersChunk.map((user, idx) => {
        // Pick matching session + transaction by index
        const session = gameSessions[idx % gameSessions.length];
        const transaction = transactions[idx % transactions.length];

        // Find game info for this session
        const game = games.find((g) => g.id === session.gameId);
        if (!game) {
          throw new Error(`Game not found for sessionId ${session.id}`);
        }

        // Commission logic
        const commissionRate = Number(game.commission ?? 0);
        const finalAmount = fakeBetAmount - (fakeBetAmount * commissionRate);

        // Random choice from array
        const randomChoice = game.choices[Math.floor(Math.random() * game.choices.length)];

        // Random odds (between 1.1 and 3.0 for example)
        const randomOdds = (Math.random() * (3 - 1.1) + 1.1).toFixed(4);

        return {
          transactionId: transaction.id,
          gameSessionId: session.id,
          choice: randomChoice,
          amount: finalAmount.toFixed(4),
          winAmount: '0',
          odds: randomOdds,
          meta: { userId: user.id, originalBet: fakeBetAmount, commissionRate },
          createdAt: now,
          updatedAt: now,
        };
      });

      await db.insert(BetsTable).values(values);
      created += values.length;

      const done = Math.min(i + chunkSize, totalUsers);
      console.log(`Inserted ${done}/${totalUsers} bets`);
    }

    console.log('Bet creation completed.');
    console.log(`Total bets created: ${created}`);
  } catch (error) {
    console.error('Error creating bets:', error);
    throw error;
  } finally {
    await pool.end();
    console.log('Database pool closed.');
  }
}

// Run seeder
console.log('Bet seeder script started...');
createBets()
  .then(() => {
    console.log('Bet seeder completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Bet seeder failed:', error);
    process.exit(1);
  });

export { createBets };
