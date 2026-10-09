import { db, pool } from '../src/db/index.ts';
import { 
  UsersTable, 
  WalletTable, 
  GamesTable, 
  GameSessionsTable, 
  TransactionsTable, 
  BetsTable,
  WinsTable
} from '../src/db/schema.ts';
import { eq, isNull, and } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import { calculateUserBalance } from '../src/api/WalletRoutesPlugin.ts';

async function seedGameSimulation() {
  try {
    console.log('Starting comprehensive game simulation seeder...');
    console.log('Testing database connection...');

    // Test database connection
    const client = await pool.connect();
    console.log('Database connection successful!');
    client.release();

    // Step 1: Create Users
    console.log('\n=== Step 1: Creating Users ===');
    const password = 'password123';
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const users = [
      {
        firstName: 'Alice',
        lastName: 'Player',
        userName: 'aliceplayer',
        email: 'alice.player@example.com',
        mobile: '+639123456793',
        type: 'player' as const,
        hashedPassword,
      },
      {
        firstName: 'Bob',
        lastName: 'Gambler',
        userName: 'bobgambler',
        email: 'bob.gambler@example.com',
        mobile: '+639123456794',
        type: 'player' as const,
        hashedPassword,
      },
      {
        firstName: 'Charlie',
        lastName: 'Winner',
        userName: 'charliewinner',
        email: 'charlie.winner@example.com',
        mobile: '+639123456795',
        type: 'player' as const,
        hashedPassword,
      },
      {
        firstName: 'Diana',
        lastName: 'Moderator',
        userName: 'dianamoderator',
        email: 'diana.moderator@example.com',
        mobile: '+639123456796',
        type: 'moderator' as const,
        hashedPassword,
      },
      {
        firstName: 'Eve',
        lastName: 'Admin',
        userName: 'eveadmin',
        email: 'eve.admin@example.com',
        mobile: '+639123456797',
        type: 'admin' as const,
        hashedPassword,
      }
    ];

    // Check for existing users to avoid duplicates
    const existingUsers = await db.select().from(UsersTable);
    const existingUsernames = existingUsers.map(u => u.userName);
    const newUsers = users.filter(user => !existingUsernames.includes(user.userName));

    let createdUsers;
    if (newUsers.length > 0) {
      createdUsers = await db.insert(UsersTable).values(newUsers).returning();
      console.log(`Created ${createdUsers.length} new users:`);
      createdUsers.forEach(user => {
        console.log(`- ${user.firstName} ${user.lastName} (${user.userName}) - Type: ${user.type}`);
      });
    } else {
      console.log('All users already exist, using existing users');
      createdUsers = existingUsers;
    }

    // Step 2: Create Wallets
    console.log('\n=== Step 2: Creating Wallets ===');
    const existingWallets = await db.select().from(WalletTable);
    const usersWithWallets = existingWallets.map(w => w.userId);
    const usersWithoutWallets = createdUsers.filter(user => !usersWithWallets.includes(user.id));

    if (usersWithoutWallets.length > 0) {
      const walletData = usersWithoutWallets.map(user => ({
        userId: user.id,
        balance: '5000.0000', // Initial balance of 5000 PHP
        status: 'active' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        pinHash: bcrypt.hashSync(user.userName, 10)
      }));

      const createdWallets = await db.insert(WalletTable).values(walletData).returning();
      console.log(`Created ${createdWallets.length} wallets with 5000 PHP initial balance`);
    } else {
      console.log('All users already have wallets');
    }

    // Step 3: Create Game
    console.log('\n=== Step 3: Creating Game ===');
    const gameName = 'Dos Letra Simulation';
    
    const existingGame = await db.query.GamesTable.findFirst({
      where: and(
        eq(GamesTable.name, gameName),
        isNull(GamesTable.deletedAt)
      )
    });

    let game;
    if (existingGame) {
      game = existingGame;
      console.log(`Using existing game: ${game.name} (ID: ${game.id})`);
    } else {
      const [newGame] = await db.insert(GamesTable)
        .values({ 
          name: gameName,
          commission: '0.08',
          choices: ['Red', 'Blue', 'Green'], // Add game choices
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .returning();
      game = newGame;
      console.log(`Created new game: ${game.name} (ID: ${game.id})`);
    }

    // Step 4: Create Game Session
    console.log('\n=== Step 4: Creating Game Session ===');
    const existingSession = await db.query.GameSessionsTable.findFirst({
      where: and(
        eq(GameSessionsTable.gameId, game.id),
        isNull(GameSessionsTable.deletedAt)
      )
    });

    let gameSession;
    if (existingSession) {
      gameSession = existingSession;
      console.log(`Using existing game session: ${gameSession.id}`);
    } else {
      const [newSession] = await db.insert(GameSessionsTable)
        .values({ 
          gameId: game.id,
          createdAt: new Date()
        })
        .returning();
      gameSession = newSession;
      console.log(`Created new game session: ${gameSession.id}`);
    }

    // Step 5: Create Initial Deposits (only for players)
    console.log('\n=== Step 5: Creating Initial Deposits ===');
    const depositAmount = '10000.0000';
    const depositTransactions = [];

    for (const user of createdUsers) {
      if (user.type !== 'admin' && user.type !== 'moderator') {
        const [transaction] = await db.insert(TransactionsTable).values({
          userId: user.id,
          receiverId: user.id,
          type: 'deposit',
          amount: depositAmount,
          status: 'completed',
          createdAt: new Date(),
          updatedAt: new Date(),
        }).returning();

        depositTransactions.push(transaction);
        console.log(`- Created deposit for ${user.firstName} ${user.lastName}: ${depositAmount} PHP`);
      }
    }

    // Step 6: Create Betting Transactions (only for players)
    console.log('\n=== Step 6: Creating Betting Transactions ===');
    const bettingAmounts = ['500.0000', '1000.0000', '750.0000', '1500.0000', '2000.0000'];
    const bets = [];

    for (let i = 0; i < createdUsers.length; i++) {
      if (createdUsers[i].type !== 'admin' && createdUsers[i].type !== 'moderator') {
        const user = createdUsers[i];
        const betAmount = bettingAmounts[i % bettingAmounts.length];
        
        // Create bet transaction
        const [betTransaction] = await db.insert(TransactionsTable).values({
          userId: user.id,
          receiverId: user.id,
          type: 'bet',
          amount: betAmount,
          status: 'completed',
          createdAt: new Date(),
          updatedAt: new Date(),
        }).returning();

        // Create bet record
        const [bet] = await db.insert(BetsTable).values({
          sessionId: gameSession.id,
          transactionId: betTransaction.id,
          choice: 'Red', // Add random choice
          createdAt: new Date()
        }).returning();

        bets.push(bet);
        console.log(`- Created bet for ${user.firstName} ${user.lastName}: ${betAmount} PHP (Choice: A)`);
      }
    }

    // Step 7: Create Winning Transactions (only for players)
    console.log('\n=== Step 7: Creating Winning Transactions ===');
    const winningAmounts = ['1000.0000', '2000.0000', '1500.0000', '3000.0000'];
    const winningChoices = ['Red', 'Blue', 'Green']; // Different choices for wins
    const wins = [];

    for (let i = 0; i < createdUsers.length; i++) {
      if (createdUsers[i].type !== 'admin' && createdUsers[i].type !== 'moderator') {
        const user = createdUsers[i];
        const winAmount = winningAmounts[i % winningAmounts.length];
        const winChoice = winningChoices[i % winningChoices.length];
        
        // Create win transaction using 'deposit' type to add money
        const [winTransaction] = await db.insert(TransactionsTable).values({
          userId: user.id,
          receiverId: user.id,
          type: 'deposit', // Use deposit type to add money to wallet
          amount: winAmount,
          status: 'completed',
          createdAt: new Date(),
          updatedAt: new Date(),
        }).returning();

        // Create win record in WinsTable
        const [win] = await db.insert(WinsTable).values({
          sessionId: gameSession.id,
          transactionId: winTransaction.id,
          choice: winChoice, // Add win choice
          createdAt: new Date()
        }).returning();

        wins.push(win);
        console.log(`- Created win for ${user.firstName} ${user.lastName}: ${winAmount} PHP (Choice: ${winChoice})`);
      }
    }

    // Step 8: Show Final Balances
    console.log('\n=== Step 8: Final User Balances ===');
    for (const user of createdUsers) {
      const balance = await calculateUserBalance(db, user.id);
      console.log(`- ${user.firstName} ${user.lastName} (${user.userName}): ${balance.balance} PHP`);
    }

    console.log('\n=== Game Simulation Seeder Completed Successfully! ===');
    console.log(`Processed ${createdUsers.length} users with different types`);
    console.log(`Created 1 game: ${game.name}`);
    console.log(`Created 1 game session: ${gameSession.id}`);
    console.log(`Created ${depositTransactions.length} deposit transactions (players only)`);
    console.log(`Created ${bets.length} betting transactions (players only)`);
    console.log(`Created ${wins.length} winning transactions (players only)`);

  } catch (error) {
    console.error('Error in game simulation seeder:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    throw error;
  } finally {
    // Close the database pool
    await pool.end();
    console.log('Database pool closed.');
  }
}

// Run the seeder immediately
console.log('Game simulation seeder script started...');
seedGameSimulation()
  .then(() => {
    console.log('Game simulation seeder completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Game simulation seeder failed:', error);
    process.exit(1);
  });

export { seedGameSimulation };
