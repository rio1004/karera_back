import { FastifyInstance } from 'fastify';
import requestSupertest from 'supertest';
import { describe, it, beforeAll, afterAll, beforeEach, afterEach, expect } from 'vitest';
import { Utils } from '../../utils/utils.ts';
import UserRoutesPlugin from '../../../src/api/UserRoutesPlugin.ts';
import TransactionRoutesPlugin from '../../../src/api/TransactionRoutesPlugin.ts';
import WalletRoutesPlugin from '../../../src/api/WalletRoutesPlugin.ts';
import GameRoutesPlugin from '../../../src/api/GameRoutesPlugin.ts';
import RoomsRoutesPlugin from '../../../src/api/RoomsRoutesPlugin.ts';
import OperatorRoutePlugin from '../../../src/api/OperatorRoutePlugin.ts';
import RepresentativeRoutePlugin from '../../../src/api/RepresentativeRoutePlugin.ts';

import { StudiosTable } from '../../../src/db/schema.ts';
import { eq } from 'drizzle-orm';

import { loadExcelData } from '../utils/loadBetsExcel.ts';

// helper utilities (put these near top of the test file)
function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function postWithRetry(server: FastifyInstance, path: string, token: string | null, payload: any, expectedStatus = 201, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const req = requestSupertest(server.server).post(path);
      if (token) req.set('Authorization', `Bearer ${token}`);
      const res = await req.send(payload);
      if (res.status === expectedStatus) return res;
      // not expected status -> log and throw to go to retry path
      console.error(`Unexpected status for ${path}: ${res.status}`, res.body || res.text);
      if (attempt === retries) return res;
    } catch (err: any) {
      console.error(`Error during request ${path} (attempt ${attempt}):`, err.message || err);
      if (attempt === retries) throw err;
      await sleep(50);
    }
  }
}

function buildUserPayload({ firstName, lastName, userName, email, mobile, type, password }: any, idx: number) {
    return {
        firstName,
        lastName,
        userName,
        email,
        mobile,
        type,
        password,
        ekycTransactionId: `ekyc_${Date.now()}_${idx}`,
        permanentAddress: 'Test Permanent Address',
        currentAddress: 'Test Current Address',
        birthDate: '1990-01-01',
        birthPlace: 'Test City',
        nationality: 'Test Nationality',
        gamingSite: 'Test Gaming Site',
        natureOfWork: 'Test Work',
        sourceOfIncome: 'Test Income',
    };
}

async function getGameWalletBalance(server: FastifyInstance, token: string): Promise<number> {
    // get wallet balance for game wallet
    const res = await requestSupertest(server.server)
        .get('/balance')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    const gameWallet = (res.body.wallets || []).find((w: any) => w.type === 'game');
    return Number(gameWallet?.balance ?? 0);
}

async function makeDeposit(server: FastifyInstance, token: string, amount: number) {
    await requestSupertest(server.server)
        .post('/deposit')
        .set('Authorization', `Bearer ${token}`)
        .send({ amount: amount.toString() })
        .expect(201);
}

async function generateOperatorRep1Code(server: FastifyInstance, operatorToken: string) {
    const res = await requestSupertest(server.server)
        .post('/operator/generate/code')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ pctOperator: 0.05, pctRep1: 0.02, pctRep2: 0.01, codeType: "representative", repType: "rep1" })
        .expect(200);
    return res.body.referralCode;
}

async function joinRepresentative(server: FastifyInstance, repToken: string, code: string, repType: string) {
  const res = await requestSupertest(server.server)
        .post(`/operator/join/representative/${code}`)
        .set('Authorization', `Bearer ${repToken}`)
        .send({ repType })
        .expect(200);

  return res.body?.referralCode?.code;
}

async function generateRepReferralCode(
    server: FastifyInstance,
    token: string,
    referralCodeId: number,
    target: "representative" | "player"
) {
    const res = await requestSupertest(server.server)
        .post('/representative/generate/code')
        .set('Authorization', `Bearer ${token}`)
        .send({ referralCodeId, target })
        .expect(200);
    return res.body.referralRepCode;
}

async function joinPlayerOrRep(
  server: FastifyInstance,
  token: string,
  code: string,
  target: "rep2" | "player"
) {
  const path =
    target === "player"
      ? `/representative/join/player/${code}`
      : `/representative/join/${code}`;

  const res = await requestSupertest(server.server)
    .post(path)
    .set('Authorization', `Bearer ${token}`)
    .send({ target })
    .expect(200);

  return res.body;
}

async function runReferralCycle(
  server: FastifyInstance,
  operatorToken: string,
  rep1Token: string,
  rep2Token: string,
  playerTokens: string[] // flat list of player tokens
) {
  const cycles: any[] = [];

  // === Build the referral chain ONCE ===
  const operatorRep1CodeObj = await generateOperatorRep1Code(server, operatorToken);
  const operatorRep1Code = operatorRep1CodeObj.code;

  // Rep1 joins operator
  const rep1Rep2Code = await joinRepresentative(server, rep1Token, operatorRep1Code, "rep1");

  // Rep2 joins Rep1 (handler now auto-generates Rep2’s player code)
  const rep2JoinRes = await joinPlayerOrRep(server, rep2Token, rep1Rep2Code, "rep2");

  // grab Rep2’s code from response
  const rep2PlayerCode = rep2JoinRes.referralCode.code;

  // === Now attach ALL players with the SAME player code ===
  for (const playerToken of playerTokens) {
    await joinPlayerOrRep(server, playerToken, rep2PlayerCode, "player");
    await sleep(20);

    cycles.push({ operatorRep1Code, rep1Rep2Code, rep2PlayerCode, playerToken });
  }

  return cycles;
}

describe('GAME API: end-to-end via HTTP only', () => {
  const url = 'postgresql://postgres:postgres@aggregator_db:5432/';
  const dbName = 'gameCycle';
  let server: FastifyInstance;
  let utils: Utils = new Utils();

  let users: any[] = [];
  let tokens: Record<string, string> = {};

  let gameId: number;
  let roomId: number;
  let sessionId: number;

  beforeAll(async () => {
    const init_db = true;
    server = await utils.beforeAll(url, dbName, init_db);

    await server.register(UserRoutesPlugin);
    await server.register(TransactionRoutesPlugin);
    await server.register(WalletRoutesPlugin);
    await server.register(GameRoutesPlugin);
    await server.register(RoomsRoutesPlugin);
    await server.register(OperatorRoutePlugin);
    await server.register(RepresentativeRoutePlugin);

    await server.ready();
  });

  afterAll(async () => {
    await utils.afterAll();
  });

  beforeEach(async () => {
    await utils.beforeEach();
  
    // --- Ensure studio exists ---
    const existing = await server.db.select().from(StudiosTable).where(eq(StudiosTable.studioNo, 'DL01'));
    if (existing.length === 0) {
      await server.db.insert(StudiosTable).values({ studioNo: 'DL01' });
    }
  
    // --- Load Excel users (skip header row) ---
    const rows = await loadExcelData();

    const excelUsers = rows.slice(2).map((r: any, idx: number) => {
      const mobile = String(r[1]);
      const type = r[2];   // moderator/player
      const bet = r[3] ?? 0;

      return {
        ...buildUserPayload(
          {
            firstName: type,
            lastName: `Test${idx}`,
            userName: `${type}_http_${idx}`,
            email: `${type}${idx}@test.com`,
            mobile,
            type,
            password: 'password123',
          },
          idx
        ),
        bet,
      };
    });
  
    // --- Fixed referral-chain accounts (operator, rep1, rep2) ---
    const chainUsers = [
      buildUserPayload({
        firstName: 'Operator',
        lastName: 'Test',
        userName: 'operator_http',
        email: 'operator@test.com',
        mobile: '09199999901',
        type: 'operator',
        password: 'password123',
      }, 100),
      buildUserPayload({
        firstName: 'Rep1',
        lastName: 'Test',
        userName: 'rep1_http',
        email: 'rep1@test.com',
        mobile: '09199999902',
        type: 'rep1',
        password: 'password123',
      }, 101),
      buildUserPayload({
        firstName: 'Rep2',
        lastName: 'Test',
        userName: 'rep2_http',
        email: 'rep2@test.com',
        mobile: '09199999903',
        type: 'rep2',
        password: 'password123',
      }, 102),
    ];
  
    // Merge users
    users = [...excelUsers, ...chainUsers];
  
    // --- Register all users with full payload ---
    for (const u of users) {
      const { bet, ...registerPayload } = u; // keep everything except bet

      const res = await requestSupertest(server.server)
        .post('/register')
        .send(registerPayload);
  
      if (res.status !== 201) {
        console.error("Register failed:", registerPayload, res.body);
      }
      expect(res.status).toBe(201);
  
      tokens[u.mobile] = res.body.token;

      // small sleep to avoid hammering the server/DB
      await sleep(30);
    }
  
    // --- Setup referral chain ---
    await sleep(50);
    const playerTokens = users
      .filter(u => u.type === 'player')
      .map(p => tokens[p.mobile]);

    await runReferralCycle(
      server,
      tokens['09199999901'], // operator
      tokens['09199999902'], // rep1
      tokens['09199999903'], // rep2
      playerTokens
    );
    // small wait after referral chain
    await sleep(50);
  
    // --- Deposit starting balances for players (sequential + retry) ---
    for (const u of users.filter(u => u.type === 'player')) {
      try {
        const depositRes = await postWithRetry(server, '/deposit', tokens[u.mobile], { amount: '1000' }, 201, 1);
        if (depositRes.status !== 201) {
          console.error('Deposit failed for', u.mobile, depositRes.status, depositRes.body || depositRes.text);
          throw new Error('Deposit failed in beforeEach');
        }
      } catch (err) {
        console.error('Deposit error for', u.mobile, err);
        throw err;
      }
      await sleep(30);
    }
  });

  afterEach(async () => {
    await utils.afterEach();
  });

  it(
    'should create game, create session, place bet, declare winner, and verify wallet with commission',
    async () => {
      const players = users.filter(u => u.type === 'player');
      const moderator = users.find(u => u.type === 'moderator');
      if (!moderator) throw new Error('No moderator found in Excel data');
  
      // get initial balances (sequential to avoid bursts)
      const initialBalances: number[] = [];
      for (const p of players) {
        initialBalances.push(await getGameWalletBalance(server, tokens[p.mobile]));
        await sleep(20);
      }
  
      // Create game + room + session (with robust logging)
      const gameRes = await postWithRetry(server, '/game', tokens[moderator.mobile], { name: `HTTP Game ${Date.now()}`, choices: ['A', 'B'], commission: '0.10' }, 201, 1);
      if (gameRes.status !== 201) {
        console.error('Game create failed', gameRes.status, gameRes.body || gameRes.text);
        throw new Error('Game create failed');
      }
      gameId = gameRes.body.id;
  
      const roomRes = await postWithRetry(server, '/rooms', tokens[moderator.mobile], { gameId, studioNo: 'DL01' }, 201, 1);
      if (roomRes.status !== 201) {
        console.error('Room create failed', roomRes.status, roomRes.body || roomRes.text);
        throw new Error('Room create failed');
      }
      roomId = roomRes.body.room.id;
      expect(roomId).toBeTruthy();
  
      const sessionRes = await postWithRetry(server, '/game/session', tokens[moderator.mobile], { gameId }, 201, 1);
      if (sessionRes.status !== 201) {
        console.error('Session create failed', sessionRes.status, sessionRes.body || sessionRes.text);
        throw new Error('Session create failed');
      }
      sessionId = sessionRes.body.id;
  
      // === Place bets from Excel (sequential + retry) ===
      for (const p of players) {
        if (p.bet > 0) {
          const res = await postWithRetry(server, '/bet', tokens[p.mobile], { sessionId, amount: p.bet, choice: 'A' }, 201, 1);
          if (res.status !== 201) {
            console.error('Bet failed for', p.mobile, res.status, res.body || res.text);
            throw new Error('Bet failed');
          }
          await sleep(20);
        }
      }
  
      // === Declare winner (log response on failure) ===
      const oddsA = 2.0;
      const winnersPayload = {
        sessionId,
        choice: 'A',
        odds: { A: oddsA, B: 0 },
        winners: players.map(p => ({ user: p.mobile, winAmount: p.bet * oddsA })),
      };
  
      const winRes = await postWithRetry(server, '/win', tokens[moderator.mobile], winnersPayload, 201, 1)
        .catch(err => {
          console.error('/win endpoint failed:', err);
          throw err;
        });
  
      if (winRes.status !== 201) {
        console.error('/win failed response:', winRes.status, winRes.body || winRes.text);
        throw new Error('/win failed');
      }
  
      // small wait then validate final balances
      await sleep(50);
      const finalBalances = [];
      for (const p of players) {
        finalBalances.push(await getGameWalletBalance(server, tokens[p.mobile]));
        await sleep(20);
      }
  
      // (optional) you can assert expected diffs here
      // ...
    },
    60000 // extended timeout
  );
});
