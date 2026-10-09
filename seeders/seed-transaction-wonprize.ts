import { db } from "../src/db/index.ts";
import { TransactionsTable, UsersTable, GamesTable } from "../src/db/schema.ts";

async function createTransactions() {
    try {
        console.log("Fetching users...");
        const users = await db.select().from(UsersTable).limit(10);

        console.log("Fetching games...");
        const games = await db.select().from(GamesTable);
        const gameIds = games.map(game => game.id);

        const today = new Date();
        const transactions = [];

        for (const user of users) {
            for (let i = 0; i < 5; i++) {
                const daysAgo = Math.floor(Math.random() * 7);
                const createdAt = new Date();
                createdAt.setDate(today.getDate() - daysAgo);

                const randomGameId = gameIds[Math.floor(Math.random() * gameIds.length)];

                transactions.push({
                    userId: user.id,
                    receiverId: null,
                    type: 'wonPrize',
                    amount: parseFloat((Math.random() * 1000).toFixed(4)),
                    status: 'completed',
                    meta: {
                        prize: 'Free Spins',
                        source: 'Promo Campaign',
                        winNumber: i + 1,
                    },
                    gameId: randomGameId,
                    siteId: null,
                    gameSessionId: null,
                    betId: null,
                    playerType: 'player',
                    operatorCommissionId: null,
                    userCommissionType: 0,
                    operatorIdOrTicketNo: `TICKET-${Math.floor(Math.random() * 100000)}`,
                    recordType: 'credit',
                    createdAt,
                    updatedAt: createdAt,
                    deletedAt: null,
                });
            }
        }

        console.log(`Inserting ${transactions.length} transactions...`);
        await db.insert(TransactionsTable).values(transactions);

        console.log("✅ Transaction seeding completed.");
    } catch (error) {
        console.error("❌ Error creating transactions:", error);
    }
}

createTransactions()
  .then(() => {
    console.log("✅ Transaction seeder completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Transaction seeder failed:", error);
    process.exit(1);
  });