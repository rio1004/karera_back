import { db, pool } from '../src/db/index.ts';
import { GamesTable } from '../src/db/schema.ts';
import { eq, isNull, and } from 'drizzle-orm';

async function createGame() {
  try {
    console.log('Starting game creation...');
    console.log('Testing database connection...');

    // Test database connection
    const client = await pool.connect();
    console.log('Database connection successful!');
    client.release();

    const gameName = 'Dos Letra Seed';
    
    console.log(`Creating game: ${gameName}`);

    // Check if the game already exists
    const existingGame = await db.query.GamesTable.findFirst({
      where: and(
        eq(GamesTable.name, gameName),
        isNull(GamesTable.deletedAt)
      )
    });

    if (existingGame) {
      console.log(`Game '${gameName}' already exists!`);
      console.log(`Game ID: ${existingGame.id}`);
      console.log(`Created at: ${existingGame.createdAt}`);
      return;
    }

    // Create the new game with valid bet choices
    const [game] = await db.insert(GamesTable)
      .values({ 
        name: gameName,
        createdAt: new Date(),
        updatedAt: new Date(),
        commission: '0.08',
        choices: ['A', 'B']
      })
      .returning();

    console.log('Game created successfully!');
    console.log(`- Game ID: ${game.id}`);
    console.log(`- Game Name: ${game.name}`);
    console.log(`- Created at: ${game.createdAt}`);

  } catch (error) {
    console.error('Error creating game:', error);
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
console.log('Game seeder script started...');
createGame()
  .then(() => {
    console.log('Game seeder completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Game seeder failed:', error);
    process.exit(1);
  });

export { createGame };
