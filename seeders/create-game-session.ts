import { db, pool } from '../src/db/index.ts';
import { GameSessionsTable, GamesTable, RoomsTable, StudiosTable, ModeratorsTable, UsersTable } from '../src/db/schema.ts';
import { eq, isNull, and } from 'drizzle-orm';

async function createGameSession() {
  try {
    console.log('Starting game session creation...');
    console.log('Testing database connection...');

    const client = await pool.connect();
    console.log('Database connection successful!');
    client.release();

    // Reuse any existing non-deleted session
    const existingSession = await db.query.GameSessionsTable.findFirst({
      where: isNull(GameSessionsTable.deletedAt)
    });

    if (existingSession) {
      console.log(`Game session already exists!`);
      console.log(`Session ID: ${existingSession.id}`);
      console.log(`Created at: ${existingSession.createdAt}`);
      console.log(`SESSION_ID=${existingSession.id}`);
      return;
    }

    // Ensure a game exists
    let game = await db.query.GamesTable.findFirst({
      where: isNull(GamesTable.deletedAt)
    });

    if (!game) {
      console.log('No game found. Creating a default game...');
      const [createdGame] = await db.insert(GamesTable).values({
        name: `K6 Default Game ${Date.now()}`,
        choices: ['A', 'B'],
        commission: '0.10',
        createdAt: new Date()
      }).returning();
      game = createdGame;
      console.log(`Created game: ${game.name} (ID: ${game.id})`);
    } else {
      console.log(`Found game: ${game.name} (ID: ${game.id})`);
    }

    // Ensure a room exists (FK required by gameSessions.roomId)
    let room = await db.query.RoomsTable.findFirst({
      where: isNull(RoomsTable.deletedAt)
    });

    if (!room) {
      // Ensure a studio
      let studio = await db.query.StudiosTable.findFirst({
        where: isNull(StudiosTable.deletedAt)
      });
      if (!studio) {
        const [newStudio] = await db.insert(StudiosTable).values({
          studioNo: 'DL01',
          createdAt: new Date(),
        }).returning();
        studio = newStudio;
      }

      // Ensure a moderator
      let moderator = await db.query.ModeratorsTable.findFirst({
        where: isNull(ModeratorsTable.deletedAt)
      });
      if (!moderator) {
        const [newModerator] = await db.insert(ModeratorsTable).values({
          name: `moderator-${Date.now()}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        }).returning();
        moderator = newModerator;
      }

      // Pick any existing user as creator
      const creator = await db.query.UsersTable.findFirst({});
      if (!creator) {
        console.log('No users found to set as room creator. Seed users first.');
        return;
      }

      // Create the room
      const [newRoom] = await db.insert(RoomsTable).values({
        gameId: game.id,
        moderatorId: moderator.id,
        studioNo: studio.studioNo,
        status: 'open',
        createdByUserId: creator.id,
        createdAt: new Date(),
      }).returning();
      room = newRoom;
      console.log(`Created room: ${room.id} (studio ${studio.studioNo})`);
    } else {
      console.log(`Found room: ${room.id}`);
    }

    // Create the game session with a valid roomId
    const [gameSession] = await db.insert(GameSessionsTable)
      .values({
        gameId: game.id,
        roomId: room.id,
        createdAt: new Date()
      })
      .returning();

    console.log('Game session created successfully!');
    console.log(`- Session ID: ${gameSession.id}`);
    console.log(`- Game ID: ${game.id}`);
    console.log(`- Game Name: ${game.name}`);
    console.log(`- Room ID: ${room.id}`);
    console.log(`- Created at: ${gameSession.createdAt}`);
    console.log(`SESSION_ID=${gameSession.id}`);

  } catch (error) {
    console.error('Error creating game session:', error);
    throw error;
  } finally {
    await pool.end();
    console.log('Database pool closed.');
  }
}

// Run the seeder immediately
console.log('Game session seeder script started...');
createGameSession()
  .then(() => {
    console.log('Game session seeder completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Game session seeder failed:', error);
    process.exit(1);
  });

export { createGameSession };