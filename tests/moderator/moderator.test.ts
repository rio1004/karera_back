import { FastifyInstance } from "fastify";
import { Utils, User } from "../utils/utils.ts";
import UserRoutesPlugin from "../../src/api/UserRoutesPlugin.ts";
import DosLetraPlugin, { GameState, Channel, Message } from "../../src/api/dosletra/DosLetraPlugin.ts";
import WebSocket from 'ws';
import TransactionRoutesPlugin from "../../src/api/TransactionRoutesPlugin.ts";
import GameRoutesPlugin from "../../src/api/GameRoutesPlugin.ts";
import WalletRoutesPlugin from "../../src/api/WalletRoutesPlugin.ts";
import RoomsRoutesPlugin from "../../src/api/RoomsRoutesPlugin.ts";
import requestSupertest from 'supertest';
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { StudiosTable } from "../../src/db/schema.ts";
import { db } from "../../src/db/index.ts";

const port = 3003;

describe('MODERATOR: Individual Workflow Tests', () => {
  const url = "postgresql://postgres:postgres@aggregator_db:5432/";
  const dbName = "moderatorTest";
  let server: FastifyInstance;
  let utils: Utils = new Utils();

  // Test users
  let moderator: User;
  let host: User;
  let player: User;
  let moderatorToken: string;
  let hostToken: string;
  let playerToken: string;
  let moderatorId: string;
  let hostId: string;
  let playerId: string;

  beforeAll(async () => {
    const init_db = true;
    server = await utils.beforeAll(url, dbName, init_db);

    await server.register(UserRoutesPlugin);
    await server.register(TransactionRoutesPlugin);
    await server.register(GameRoutesPlugin);
    await server.register(WalletRoutesPlugin);
    await server.register(RoomsRoutesPlugin);
    await server.register(DosLetraPlugin, { speed: 10.0, countdownSpeed: 100.0 });

    await server.redis.dosletra.select(1);

    await server.ready();
    await server.listen({ port: port });
  }, 30000);

  afterAll(async () => {
    if (server && server.authenticatedSockets) {
      server.authenticatedSockets.forEach(socket => {
        if (socket.ws && socket.ws.readyState === WebSocket.OPEN) {
          socket.ws.close();
        }
      });
    }
    await server.close();
    await utils.afterAll();
  });

  // Fixed deposit function aligned with current API
  const makeDeposit = async (token: string, amount: number): Promise<void> => {
    await requestSupertest(server.server)
      .post('/deposit')
      .set('Authorization', `Bearer ${token}`)
      .send({
        amount: amount.toString(),
      })
      .expect(201);
  };

  beforeEach(async () => {
    await utils.beforeEach();
    await server.clearDosLetraRedis();

    await server.db.execute(sql`
      INSERT INTO studios ("studioNo", "createdAt")
      VALUES ('DL05', NOW())
      ON CONFLICT ("studioNo") DO NOTHING
    `);

    // create studio DL01 if not exists
    const studio = await db.select().from(StudiosTable).where(eq(StudiosTable.studioNo, 'DL05')); 
    if (studio.length === 0) {
      await db.insert(StudiosTable).values({ studioNo: 'DL05' });
    }

    // Generate unique timestamp for this test run
    const timestamp = Date.now();
    const randomSuffix = Math.floor(Math.random() * 1000);

    // Create user objects with unique data
    moderator = {
      firstName: "Moderator",
      lastName: "Test",
      userName: `moderator${timestamp}${randomSuffix}`,
      email: `moderator${timestamp}${randomSuffix}@test.com`,
      mobile: `0900000${String(timestamp).slice(-4)}${randomSuffix}`,
      type: "moderator",
      password: "password123",
    };

    host = {
      firstName: "Host",
      lastName: "Test",
      userName: `host${timestamp}${randomSuffix}`,
      email: `host${timestamp}${randomSuffix}@test.com`,
      mobile: `0900001${String(timestamp).slice(-4)}${randomSuffix}`,
      type: "host",
      password: "password123",
    };

    player = {
      firstName: "Player",
      lastName: "One",
      userName: `player${timestamp}${randomSuffix}`,
      email: `player${timestamp}${randomSuffix}@test.com`,
      mobile: `0900002${String(timestamp).slice(-4)}${randomSuffix}`,
      type: "player",
      password: "password123",
    };

    // Register users with full payload required by /register schema
    const registerComplete = async (base: User, i: number) => {
      const payload = {
        firstName: base.firstName,
        lastName: base.lastName,
        userName: base.userName,
        email: base.email,
        mobile: base.mobile,
        type: base.type,
        password: base.password,
        ekycTransactionId: `ekyc_${timestamp}_${i}_${randomSuffix}`,
        permanentAddress: 'Test Permanent Address',
        currentAddress: 'Test Current Address',
        birthDate: '1990-01-01',
        birthPlace: 'Test City',
        nationality: 'Test Nationality',
        gamingSite: 'Test Gaming Site',
        natureOfWork: 'Test Work',
        sourceOfIncome: 'Test Income',
      };
      
      try {
        const res = await requestSupertest(server.server).post('/register').send(payload).expect(201);
        return res.body;
      } catch (error) {
        console.error(`Registration failed for ${base.userName}:`, error.response?.body || error.message);
        throw error;
      }
    };

    const moderatorResponse = await registerComplete(moderator, 0);
    const hostResponse = await registerComplete(host, 1);
    const playerResponse = await registerComplete(player, 2);

    moderatorToken = moderatorResponse.token;
    hostToken = hostResponse.token;
    playerToken = playerResponse.token;
    
    // Store user IDs for room creation
    moderatorId = moderatorResponse.user.id;
    hostId = hostResponse.user.id;
    playerId = playerResponse.user.id;

    // If needed in future tests, deposit can be called:
    // await makeDeposit(moderatorToken, 10000);
    // await makeDeposit(hostToken, 10000);
    // await makeDeposit(playerToken, 10000);

    await Utils.delay(500);
  });

  afterEach(async () => {
    await utils.afterEach();
    await server.clearDosLetraRedis();
  });

  it('should register moderator and host successfully', async () => {
    expect(moderatorToken).toBeDefined();
    expect(moderatorId).toBeDefined();
    expect(moderator.type).toBe('moderator');

    expect(hostToken).toBeDefined();
    expect(hostId).toBeDefined();
    expect(host.type).toBe('host');

    expect(playerToken).toBeDefined();
    expect(playerId).toBeDefined();
    expect(player.type).toBe('player');

    const moderatorProfile = await requestSupertest(server.server)
      .get('/verify-login')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);

    const hostProfile = await requestSupertest(server.server)
      .get('/verify-login')
      .set('Authorization', `Bearer ${hostToken}`)
      .expect(200);

    expect(moderatorProfile.body.user.type).toBe('moderator');
    expect(hostProfile.body.user.type).toBe('host');
  });

  it('should create a room and select host', async () => {
    const gameResponse = await requestSupertest(server.server)
      .post('/game')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({
        name: `Test Game ${Date.now()}`,
        choices: ['A', 'B'],
        commission: 0.10,
      })
      .expect(201);

    const gameId = gameResponse.body.id;

    const roomResponse = await requestSupertest(server.server)
      .post('/rooms')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({
        gameId: gameId,
        hostId: hostId,
        studioNo: "DL01",
      })
      .expect(201);

    const roomId = roomResponse.body.room.id;

    expect(roomResponse.body.room.gameId).toBe(gameId);
    expect(String(roomResponse.body.room.hostId)).toBe(String(hostId));
    expect(roomResponse.body.room.id).toBeDefined();

    // Test getting the room
    const getRoomResponse = await requestSupertest(server.server)
      .get(`/rooms/${roomId}`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);

    expect(getRoomResponse.body.room.id).toBe(roomId);
    expect(String(getRoomResponse.body.room.hostId)).toBe(String(hostId));
  });

  it('should create a game with gamesession successfully', async () => {
    const gameResponse = await requestSupertest(server.server)
      .post('/game')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({
        name: `Moderator Test Game ${Date.now()}`,
        choices: ['A', 'B'],
        commission: 0.10,
      })
      .expect(201);

    const gameId = gameResponse.body.id;

    expect(gameResponse.body.name).toContain('Moderator Test Game');
    expect(gameResponse.body.choices).toEqual(['A', 'B']);
    expect(gameResponse.body.commission).toBe(0.10);
    expect(gameResponse.body.id).toBeDefined();

    // Ensure room exists for the game before creating session
    const roomResponse = await requestSupertest(server.server)
      .post('/rooms')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({
        gameId,
        hostId,
        studioNo: "DL01",
      })
      .expect(201);
    expect(roomResponse.body.room?.id).toBeDefined();

    const getGameResponse = await requestSupertest(server.server)
      .get(`/game/${gameId}`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);

    expect(getGameResponse.body.id).toBe(gameId);
    expect(getGameResponse.body.name).toContain('Moderator Test Game');

    const sessionResponse = await requestSupertest(server.server)
      .post('/game/session')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({
        gameId: gameId,
      })
      .expect(201);

    const gameSessionId = sessionResponse.body.id;

    expect(sessionResponse.body.gameId).toBe(gameId);
    expect(sessionResponse.body.id).toBeDefined();
  });

  it('should create a game session for an existing game', async () => {
    const gameResponse = await requestSupertest(server.server)
      .post('/game')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({
        name: `Moderator Test Game ${Date.now()}`,
        choices: ['A', 'B'],
        commission: 0.08,
      })
      .expect(201);
  
    const gameId = gameResponse.body.id;

    // Create a room for that game (since createGameSession relies on room studioNo)
    const roomResponse = await requestSupertest(server.server)
      .post('/rooms')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({
        gameId: gameId,
        hostId: hostId,
        studioNo: "DL05",
      })
      .expect(201);
  
    expect(roomResponse.body.room.id).toBeDefined();
  
    const sessionResponse = await requestSupertest(server.server)
      .post('/game/session')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({ gameId: Number(gameId) })
      .expect(201);
  
    expect(Number(sessionResponse.body.gameId)).toBe(Number(gameId));
    expect(sessionResponse.body.round).toMatch(new RegExp(`^\\d{6}DL05\\d{3,4}$`));
    expect(sessionResponse.body.gameName).toContain('Moderator Test Game');
    expect(sessionResponse.body.gameChoices).toEqual(['A', 'B']);
    expect(Number(sessionResponse.body.gameCommission)).toBe(0.08);
  
    const getSession = await requestSupertest(server.server)
      .get(`/game/session/${sessionResponse.body.id}`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);
  
    expect(getSession.body.id).toBe(sessionResponse.body.id);
    expect(getSession.body.gameId).toBe(gameId);
    expect(getSession.body.round).toBe(sessionResponse.body.round);
  });
});