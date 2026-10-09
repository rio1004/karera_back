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
import { db } from "../../src/db/index.ts";
import { StudiosTable } from "../../src/db/schema.ts";
import { eq } from "drizzle-orm";

const port = 3002;

describe('MODERATOR: Game Cycle Test', () => {
  const url = "postgresql://postgres:postgres@aggregator_db:5432/";
  const dbName = "gameCycleTest";
  let server: FastifyInstance;
  let utils: Utils = new Utils();

  // Test users
  let moderator: User;
  let player1: User;
  let player2: User;
  let host: User;
  let moderatorToken: string;
  let player1Token: string;
  let player2Token: string;
  let moderatorId: string;
  let player1Id: string;
  let player2Id: string;
  let hostId: string;
  let studioNo: string;
  let gameId: string;
  let roomId: string;
  let gameSessionId: string;
  let hostToken: string;

  // WebSocket connections
  let moderatorWs: WebSocket;
  let player1Ws: WebSocket;
  let player2Ws: WebSocket;

  // Track initial balances
  let initialPlayer1Balance: number;
  let initialPlayer2Balance: number;

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
    if (moderatorWs && moderatorWs.readyState === WebSocket.OPEN) moderatorWs.close();
    if (player1Ws && player1Ws.readyState === WebSocket.OPEN) player1Ws.close();
    if (player2Ws && player2Ws.readyState === WebSocket.OPEN) player2Ws.close();

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

  // Fixed deposit function
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

    // minimal user objects, we'll enrich them at registration call
    moderator = {
      firstName: "Moderator",
      lastName: "Test",
      userName: "moderator001",
      email: "moderator@test.com",
      mobile: "09000000001",
      type: "moderator",
      password: "password123",
    };

    host = {
      firstName: "Host",
      lastName: "Test",
      userName: "host001",
      email: "host@test.com",
      mobile: "09000000004",
      type: "host",
      password: "password123",
    };

    player1 = {
      firstName: "Player",
      lastName: "One",
      userName: "player001",
      email: "player1@test.com",
      mobile: "09000000002",
      type: "player",
      password: "password123",
    };

    player2 = {
      firstName: "Player",
      lastName: "Two",
      userName: "player002",
      email: "player2@test.com",
      mobile: "09000000003",
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
        ekycTransactionId: `ekyc_${Date.now()}_${i}`,
        permanentAddress: 'Test Permanent Address',
        currentAddress: 'Test Current Address',
        birthDate: '1990-01-01',
        birthPlace: 'Test City',
        nationality: 'Test Nationality',
        gamingSite: 'Test Gaming Site',
        natureOfWork: 'Test Work',
        sourceOfIncome: 'Test Income',
      };
      const res = await requestSupertest(server.server).post('/register').send(payload).expect(201);
      return res.body;
    };
    // create studio DL01 if not exists
    const studio = await db.select().from(StudiosTable).where(eq(StudiosTable.studioNo, 'DL01')); 
    if (studio.length === 0) {
      await db.insert(StudiosTable).values({ studioNo: 'DL01' });
    }
    studioNo = 'DL01';

    const moderatorResponse = await registerComplete(moderator, 0);
    const player1Response = await registerComplete(player1, 1);
    const player2Response = await registerComplete(player2, 2);
    const hostResponse = await registerComplete(host, 3);

    moderatorToken = moderatorResponse.token;
    player1Token = player1Response.token;
    player2Token = player2Response.token;
    hostToken = hostResponse.token;

    // Store user IDs for room creation
    moderatorId = moderatorResponse.user.id;
    player1Id = player1Response.user.id;
    player2Id = player2Response.user.id;
    hostId = hostResponse.user.id;

    // Make deposits using the fixed function
    await makeDeposit(moderatorToken, 10000);
    await makeDeposit(player1Token, 10000);
    await makeDeposit(player2Token, 10000);

    // Wait a moment for deposits to be processed
    await Utils.delay(1000);

    // Get initial balances after deposits
    initialPlayer1Balance = await Utils.getPlayerWalletBalance(server, player1Token);
    initialPlayer2Balance = await Utils.getPlayerWalletBalance(server, player2Token);
  });

  afterEach(async () => {
    await utils.afterEach();
    await server.clearDosLetraRedis();
  });

  // Improved WebSocket connection function
  const connectWebSocket = async (user: User, token: string): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}/`);
      
      ws.on('open', () => {
        const authMessage = new Message(Channel.Game, GameState.Authenticate, {
          data: { token }
        });
        ws.send(JSON.stringify(authMessage));
      });

      const messageHandler = (data: WebSocket.RawData) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.channel === Channel.Game && 
              message.state === GameState.Authenticate && 
              message.data === "Success") {
            ws.off('message', messageHandler);
            resolve(ws);
          }
        } catch (e) {
          console.error(`Error parsing message for ${user.userName}:`, e);
        }
      };

      ws.on('message', messageHandler);

      ws.on('error', (error) => {
        console.error(`WebSocket error for ${user.userName}:`, error);
        reject(error);
      });

      ws.on('close', () => {
        // log close if needed
      });

      setTimeout(() => {
        ws.off('message', messageHandler);
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
        reject(new Error(`WebSocket connection timeout for ${user.userName}`));
      }, 10000);
    });
  };

  // Helper function to wait for specific game state with timeout
  const waitForGameState = (ws: WebSocket, expectedState: GameState, user: string, timeoutMs: number = 10000): Promise<void> => {
    return new Promise((resolve, reject) => {
      const messageHandler = (data: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.channel === Channel.Game && msg.state === expectedState) {
            clearTimeout(timeoutId);
            ws.off('message', messageHandler);
            resolve();
          }
        } catch (e) {
          console.error(`Error parsing message for ${user}:`, e);
        }
      };

      const timeoutId = setTimeout(() => {
        ws.off('message', messageHandler);
        reject(new Error(`waitForGameState exceeded ${timeoutMs}ms waiting for ${expectedState} for ${user}`));
      }, timeoutMs);

      ws.on('message', messageHandler);
    });
  };

  // Helper function to wait for bet confirmation
  const waitForBetConfirmation = (ws: WebSocket, user: string, timeoutMs: number = 5000): Promise<any> => {
    return new Promise((resolve, reject) => {
      const messageHandler = (data: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.channel === Channel.Game && msg.state === GameState.Bet) {
            clearTimeout(timeoutId);
            ws.off('message', messageHandler);
            resolve(msg);
          }
        } catch (e) {
          console.error(`Error parsing bet response for ${user}:`, e);
        }
      };

      const timeoutId = setTimeout(() => {
        ws.off('message', messageHandler);
        reject(new Error(`waitForBetConfirmation exceeded ${timeoutMs}ms for ${user}`));
      }, timeoutMs);

      ws.on('message', messageHandler);
    });
  };

  function roundTo(num: number, decimals = 4) {
    return Number(num.toFixed(decimals));
  }

  it('should complete full game cycle and settle wallets based on final odds', async () => {
    // Create a game (aligning with reference flow)
    gameId = await Utils.createInitialGame(server, moderatorToken);

    // Optional: create a room (kept to preserve moderator scenario)
    const roomResponse = await requestSupertest(server.server)
      .post('/rooms')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({
        gameId: gameId,
        hostId: hostId,
        studioNo: studioNo,
      });
    roomId = roomResponse.body.room.id;

    // Create a game session
    const sessionResponse = await requestSupertest(server.server)
      .post('/game/session')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({
        gameId: gameId,
      })
      .expect(201);

    gameSessionId = sessionResponse.body.id;

    // Connect all users via WebSocket
    moderatorWs = await connectWebSocket(moderator, moderatorToken);
    player1Ws = await connectWebSocket(player1, player1Token);
    player2Ws = await connectWebSocket(player2, player2Token);

    // Start new game
    Utils.sendGameState(moderatorWs, GameState.NewGame, {
      data: { gameId }
    });
    await waitForGameState(moderatorWs, GameState.NewGame, 'moderator');

    // Open for betting (pause play while placing bets)
    Utils.sendGameState(moderatorWs, GameState.Open, { data: { play: false } });
    await waitForGameState(moderatorWs, GameState.Open, 'moderator');

    // Place bets sequentially with confirmation
    const p1BetAmount = 100;
    const p2BetAmount = 200;

    Utils.sendGameState(player1Ws, GameState.Bet, { data: { choice: 'A', amount: p1BetAmount } });
    const p1BetResp = await waitForBetConfirmation(player1Ws, 'player1');
    if (p1BetResp?.data?.error) {
      throw new Error(`Bet failed for player1: ${p1BetResp.data.error}`);
    }

    Utils.sendGameState(player2Ws, GameState.Bet, { data: { choice: 'B', amount: p2BetAmount } });
    const p2BetResp = await waitForBetConfirmation(player2Ws, 'player2');
    if (p2BetResp?.data?.error) {
      throw new Error(`Bet failed for player2: ${p2BetResp.data.error}`);
    }

    // Wait for odds to be calculated
    const finalOdds = await Utils.waitForOdds(moderatorWs, GameState.Bet);

    // Resume play
    Utils.sendGameState(moderatorWs, GameState.Open, { data: { play: true } });

    // Close betting
    Utils.sendGameState(moderatorWs, GameState.Closed, {});
    await waitForGameState(moderatorWs, GameState.Closed, 'moderator');

    // Rolling
    Utils.sendGameState(moderatorWs, GameState.Rolling, {});
    await waitForGameState(moderatorWs, GameState.Rolling, 'moderator');

    // Declare winner: A
    Utils.sendGameState(moderatorWs, GameState.WinnerDeclared, { data: { choice: 'A' } });
    await waitForGameState(moderatorWs, GameState.WinnerDeclared, 'moderator');

    // Send payout
    Utils.sendGameState(moderatorWs, GameState.SendPayout, {});
    await waitForGameState(moderatorWs, GameState.SendPayout, 'moderator');

    // Allow async processing to complete
    await Utils.delay(3000);

    // Get final balances
    const finalPlayer1Balance = await Utils.getPlayerWalletBalance(server, player1Token);
    const finalPlayer2Balance = await Utils.getPlayerWalletBalance(server, player2Token);

    // Compute expected balances based on odds
    const expectedP1 = initialPlayer1Balance - p1BetAmount + (p1BetAmount * (finalOdds?.A ?? 1.0));
    const expectedP2 = initialPlayer2Balance - p2BetAmount;

    // Assert with small epsilon to avoid float noise
    const epsilon = 0.01;
    if (Math.abs(Number(finalPlayer1Balance) - expectedP1) > epsilon) {
      throw new Error(`Player1 balance mismatch. Expected ${expectedP1}, got ${finalPlayer1Balance}.`);
    }
    if (Math.abs(Number(finalPlayer2Balance) - expectedP2) > epsilon) {
      throw new Error(`Player2 balance mismatch. Expected ${expectedP2}, got ${finalPlayer2Balance}.`);
    }
  }, 30000);
});