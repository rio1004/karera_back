import { db, pool } from '../src/db/index.ts';
import { GamesTable } from '../src/db/schema.ts';
import { eq, isNull, and } from 'drizzle-orm';

async function createGame() {
  try {
    console.log('Starting game seeder...');
    console.log('Testing database connection...');

    // Test database connection
    const client = await pool.connect();
    console.log('Database connection successful!');
    client.release();

    // Fixed game ID
    const gameId = '8bab518b-63af-4aaf-a0c0-420a032044fe';
    const gameName = 'Dos Letra Seed';
    
    console.log(`Ensuring game "${gameName}" with ID ${gameId} exists...`);

    // Check if the game already exists
    let game = await db.query.GamesTable.findFirst({
      where: and(
        eq(GamesTable.id, gameId),
        isNull(GamesTable.deletedAt)
      )
    });

    if (!game) {
      const [newGame] = await db.insert(GamesTable)
        .values({
          id: gameId,
          commission: '0.08',
          name: gameName,
          choices: ['A', 'B', 'C'],
          createdAt: new Date()
        })
        .returning();

      game = newGame;
      console.log(`Game created: ${game.name} (ID: ${game.id})`);
    } else {
      console.log(`Game already exists: ${game.name} (ID: ${game.id})`);
    }

  } catch (error) {
    console.error('Seeder error:', error);
    throw error;
  } finally {
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
