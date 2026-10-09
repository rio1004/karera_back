import { db, pool } from '../src/db/index.ts';
import { 
  TransactionsTable, 
  UsersTable, 
  GamesTable, 
  GameSessionsTable, 
  BetsTable, 
  WinsTable,
  SitesTable 
} from '../src/db/schema.ts';
import { eq, isNull, and } from 'drizzle-orm';

// Sample data from the table provided
const sampleData = [
  { date: '6/1/2025', betAmount: 0.00, winAmount: 0.00 },
  { date: '6/2/2025', betAmount: 0.00, winAmount: 0.00 },
  { date: '6/3/2025', betAmount: 0.00, winAmount: 0.00 },
  { date: '6/4/2025', betAmount: 0.00, winAmount: 0.00 },
  { date: '6/5/2025', betAmount: 451.00, winAmount: 414.92 },
  { date: '6/6/2025', betAmount: 0.00, winAmount: 0.00 },
  { date: '6/7/2025', betAmount: 2338.00, winAmount: 2150.96 },
  { date: '6/8/2025', betAmount: 120.00, winAmount: 110.40 },
  { date: '6/9/2025', betAmount: 130.00, winAmount: 119.60 },
  { date: '6/10/2025', betAmount: 192.00, winAmount: 176.64 },
  { date: '6/11/2025', betAmount: 100.00, winAmount: 92.00 },
  { date: '6/12/2025', betAmount: 0.00, winAmount: 0.00 },
  { date: '6/13/2025', betAmount: 545.00, winAmount: 501.40 },
  { date: '6/14/2025', betAmount: 683.00, winAmount: 628.36 },
  { date: '6/15/2025', betAmount: 196.00, winAmount: 180.32 },
  { date: '6/16/2025', betAmount: 120.00, winAmount: 110.40 },
  { date: '6/17/2025', betAmount: 0.00, winAmount: 0.00 },
  { date: '6/18/2025', betAmount: 286.00, winAmount: 263.12 },
  { date: '6/19/2025', betAmount: 10.00, winAmount: 9.20 },
  { date: '6/20/2025', betAmount: 423.00, winAmount: 389.16 },
  { date: '6/21/2025', betAmount: 591.00, winAmount: 543.72 },
  { date: '6/22/2025', betAmount: 262.00, winAmount: 241.04 },
  { date: '6/23/2025', betAmount: 160.00, winAmount: 147.20 },
  { date: '6/24/2025', betAmount: 260.00, winAmount: 239.20 },
  { date: '6/25/2025', betAmount: 0.00, winAmount: 0.00 },
  { date: '6/26/2025', betAmount: 210.00, winAmount: 193.20 },
  { date: '6/27/2025', betAmount: 276.00, winAmount: 253.92 },
  { date: '6/28/2025', betAmount: 0.00, winAmount: 0.00 },
  { date: '6/29/2025', betAmount: 245.00, winAmount: 225.40 },
  { date: '6/30/2025', betAmount: 20.00, winAmount: 18.40 }
];

async function seedTransactionReportData() {
  try {
    console.log('Starting transaction report data seeding...');
    console.log('Testing database connection...');

    // Test database connection
    const client = await pool.connect();
    console.log('Database connection successful!');
    client.release();

    // Get or create required entities
    console.log('Setting up required entities...');
    
    // Get a user
    const user = await db.query.UsersTable.findFirst({
      where: eq(UsersTable.type, 'player')
    });
    
    if (!user) {
      console.log('No users found! Please run the user seeder first.');
      return;
    }

    // Get or create a game
    let game = await db.query.GamesTable.findFirst({
      where: and(
        eq(GamesTable.name, 'Dos Letra Seed'),
        isNull(GamesTable.deletedAt)
      )
    });

    if (!game) {
      console.log('Creating game...');
      game = ((await db.insert(GamesTable)
        .values({
          name: 'Dos Letra Seed',
          choices: ['A', 'B'],
          commission: '0.08',
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .returning()) as any[])[0];
    }

    // Get or create a site
    let site = await db.query.SitesTable.findFirst({
      where: and(
        eq(SitesTable.name, 'Main Site'),
        isNull(SitesTable.deletedAt)
      )
    });

    if (!site) {
      console.log('Creating site...');
      site = ((await db.insert(SitesTable)
        .values({
          name: 'Main Site',
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .returning()) as any[])[0];
    }

    console.log('Creating transactions for June 2025...');

    const transactions = [];
    const bets = [];
    const wins = [];
    const gameSessions = [];

    for (const data of sampleData) {
      if (data.betAmount === 0) continue; // Skip days with no activity

      // Parse date (6/5/2025 format)
      const [month, day, year] = data.date.split('/');
      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      
      // Create game session for this day
      const gameSession = ((await db.insert(GameSessionsTable)
        .values({
          gameId: game.id,
          sessionNo: `SESSION-${year}${month.padStart(2, '0')}${day.padStart(2, '0')}`,
          createdAt: date
        })
        .returning()) as any[])[0];

      gameSessions.push(gameSession);

      // Create bet transaction
      const betTransaction = ((await db.insert(TransactionsTable)
        .values({
          userId: user.id,
          receiverId: user.id,
          type: 'bet',
          amount: data.betAmount.toString(),
          status: 'completed',
          gameId: game.id,
          siteId: site.id,
          gameSessionId: gameSession.id,
          playerType: 'player',
          recordType: 'bet',
          createdAt: date,
          updatedAt: date
        })
        .returning()) as any[])[0];

      // Create bet record
      const bet = ((await db.insert(BetsTable)
        .values({
          sessionId: gameSession.id,
          userId: user.id,
          choice: 'A',
          amount: data.betAmount.toString(),
          status: 'completed',
          odds: '1.92', // Approximate odds
          transactionId: betTransaction.id,
          createdAt: date,
          updatedAt: date
        })
        .returning()) as any[])[0];

      bets.push(bet);

      // Create win transaction if there are winnings
      if (data.winAmount > 0) {
        const winTransaction = ((await db.insert(TransactionsTable)
          .values({
            userId: user.id,
            receiverId: user.id,
            type: 'win',
            amount: data.winAmount.toString(),
            status: 'completed',
            gameId: game.id,
            siteId: site.id,
            gameSessionId: gameSession.id,
            playerType: 'player',
            recordType: 'win',
            createdAt: date,
            updatedAt: date
          })
          .returning()) as any[])[0];

        // Create win record
        const win = ((await db.insert(WinsTable)
          .values({
            sessionId: gameSession.id,
            transactionId: winTransaction.id,
            choice: 'A',
            createdAt: date
          })
          .returning()) as any[])[0];

        wins.push(win);
      }

      console.log(`Created data for ${data.date}: Bet ${data.betAmount}, Win ${data.winAmount}`);
    }

    console.log('Transaction report data seeding completed!');
    console.log(`- Created ${gameSessions.length} game sessions`);
    console.log(`- Created ${bets.length} bets`);
    console.log(`- Created ${wins.length} wins`);
    console.log(`- Total bet amount: ${sampleData.reduce((sum, d) => sum + d.betAmount, 0)}`);
    console.log(`- Total win amount: ${sampleData.reduce((sum, d) => sum + d.winAmount, 0)}`);

  } catch (error) {
    console.error('Error seeding transaction report data:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    throw error;
  } finally {
    await pool.end();
    console.log('Database pool closed.');
  }
}

// Run the seeder
console.log('Transaction report data seeder script started...');
seedTransactionReportData()
  .then(() => {
    console.log('Transaction report data seeder completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Transaction report data seeder failed:', error);
    process.exit(1);
  });

export { seedTransactionReportData };