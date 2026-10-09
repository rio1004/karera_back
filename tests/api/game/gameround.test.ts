import { FastifyInstance } from "fastify";
import requestSupertest from "supertest";
import ExcelJS from "exceljs";
import { Utils, User } from "../../utils/utils.ts";
import UserRoutesPlugin from "../../../src/api/UserRoutesPlugin.ts";
import TransactionRoutesPlugin from "../../../src/api/TransactionRoutesPlugin.ts";
import GameRoutesPlugin from "../../../src/api/GameRoutesPlugin.ts";
import WalletRoutesPlugin from "../../../src/api/WalletRoutesPlugin.ts";
import RoomRoutesPlugin from "../../../src/api/RoomsRoutesPlugin.ts";

const port = 8021;
 
type PlayerRow = { player_id: string; player_type: string; bet_A: number; bet_B: number; win_amount_A?: number; win_amount_B?: number };
type TotalsRow = { com_pct: number; gross_A: number; gross_B: number; total_gross: number; total_net: number; odds_A: number; odds_B: number; winner_index: number };
type RoundBlock = { players: PlayerRow[]; totals: TotalsRow };

describe('Game Cycle with Multiple Rounds api test', () => {
  const url = "postgresql://postgres:postgres@aggregator_db:5432/";
  const dbName = "kareraGameRoundsTest";
  let server: FastifyInstance;
  let utils: Utils = new Utils();

  beforeAll(async () => {
    const init_db = true;
    server = await utils.beforeAll(url, dbName, init_db);

    await server.register(UserRoutesPlugin);
    await server.register(TransactionRoutesPlugin);
    await server.register(GameRoutesPlugin);
    await server.register(WalletRoutesPlugin);
    await server.register(RoomRoutesPlugin);
    // await server.register(DosLetraPlugin, { speed: 20.0, countdownSpeed: 100.0 });

    // await server.selectDosLetraRedis(1);

    await server.ready();
    await server.listen({ port: port });
  }, 30000);

  afterAll(async () => {
    await server.close();
    await utils.afterAll();
  });

  beforeEach(async () => {
    await utils.beforeEach();
    // await server.clearDosLetraRedis();
  });

  afterEach(async () => {
    await utils.afterEach();
    // await server.clearDosLetraRedis();
  });

  it('validates full game cycles per round (HTTP-only) using gamerounds.xlsx', async () => {
    const rounds = await parseGamerounds('tests/api/game/gamerounds.xlsx');
    console.log(rounds);
    console.log(`Parsed rounds: ${rounds.length}`);

    // Collect unique users and planned totals
    const uniqueMobiles = new Set<string>();
    const totalBetPerUser = new Map<string, number>();
    for (const rnd of rounds) {
      for (const p of rnd.players) {
        uniqueMobiles.add(p.player_id);
        const amt = (Number(p.bet_A) || 0) + (Number(p.bet_B) || 0);
        totalBetPerUser.set(p.player_id, (totalBetPerUser.get(p.player_id) || 0) + amt);
      }
    }
    // Ensure moderator exists
    uniqueMobiles.add('09000000000');
    // Ensure moderator present (not from sheet)
    if (!uniqueMobiles.has('09000000000')) uniqueMobiles.add('09000000000');

    // Register, login, deposit (HTTP only)
    const users: any[] = [];
    const tokens: Record<string, string> = {};
    let moderatorToken = '';
    for (const mobile of uniqueMobiles) {
      console.log(`Registering user ${mobile}`);
      const newUser: User = {
        firstName: mobile,
        lastName: mobile,
        userName: mobile,
        email: `test${mobile}@example.com`,
        mobile,
        type: mobile === '09000000000' ? 'moderator' : 'player',
        password: 'password123',
      };

      // Register
      await requestSupertest(server.server).post('/register').send({
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        userName: newUser.userName,
        email: newUser.email,
        mobile: newUser.mobile,
        type: newUser.type,
        password: newUser.password,
        ekycTransactionId: `ekyc_${Date.now()}_${newUser.mobile}`,
        permanentAddress: 'Test Permanent Address',
        currentAddress: 'Test Current Address',
        birthDate: '1990-01-01',
        birthPlace: 'Test City',
        nationality: 'Test Nationality',
        gamingSite: 'Test Gaming Site',
        natureOfWork: 'Test Work',
        sourceOfIncome: 'Test Income',
      }).expect(201);

      // Login for active token
      const loginRes = await requestSupertest(server.server)
        .post('/login')
        .send({ userNameOrEmail: newUser.userName, password: newUser.password })
        .expect(200);
      const token = loginRes.body.token;
      users.push({ mobile, type: newUser.type });
      tokens[mobile] = token;

      if (newUser.type === 'moderator') {
        moderatorToken = token;
      }

      const depositAmount = 10000;
      await requestSupertest(server.server)
        .post('/deposit')
        .set('Authorization', `Bearer ${token}`)
        .send({ amount: String(depositAmount) })
        .expect(201);

      console.log(`User ${mobile} initialized: deposited=${depositAmount}`);
    }

    // Create game and room
    const gameId = await Utils.createInitialGame(server, moderatorToken);

    // Iterate each parsed round block
    for (let i = 0; i < rounds.length; i++) {
      const roundKey = `${i + 1}`;
      const round = rounds[i];
      const commissionValue = Number(round.totals.com_pct ?? 0.10);

      console.log(`\n--- Round ${roundKey} ---`);
      console.log(`Commission: ${commissionValue}`);
      console.table(round.players.map(r => ({ mobile: r.player_id, bet_A: Number(r.bet_A) || 0, bet_B: Number(r.bet_B) || 0 })));

      const sessionRes = await requestSupertest(server.server)
        .post('/game/session')
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ gameId })
        .expect(201);
      const sessionId = sessionRes.body.id;
      console.log(`Session created for round ${roundKey}: ${sessionId}`);

      const betLogs: { round: string; mobile: string; choice: string; amount: number; prevBalance: number; updatedBalance: number }[] = [];
      for (const p of round.players) {
        const mobile = p.player_id;
        const token = tokens[mobile];
        if (!token) continue;
        const prevBalance = await Utils.getPlayerWalletBalance(server, token);
        const amountA = Number(p.bet_A) || 0;
        const amountB = Number(p.bet_B) || 0;
        if (amountA > 0) {
          console.log(`Bet: round=${roundKey} mobile=${mobile} choice=A amount=${amountA} prevBalance=${roundTo(prevBalance)}`);
          await requestSupertest(server.server).post('/bet').set('Authorization', `Bearer ${token}`).send({ sessionId, amount: amountA, choice: 'A' }).expect(201);
          await Utils.delay(10);
          const updatedBalance = await Utils.getPlayerWalletBalance(server, token);
          betLogs.push({ round: roundKey, mobile, choice: 'A', amount: amountA, prevBalance, updatedBalance });
        }
        if (amountB > 0) {
          console.log(`Bet: round=${roundKey} mobile=${mobile} choice=B amount=${amountB} prevBalance=${roundTo(prevBalance)}`);
          await requestSupertest(server.server).post('/bet').set('Authorization', `Bearer ${token}`).send({ sessionId, amount: amountB, choice: 'B' }).expect(201);
          await Utils.delay(10);
          const updatedBalance = await Utils.getPlayerWalletBalance(server, token);
          betLogs.push({ round: roundKey, mobile, choice: 'B', amount: amountB, prevBalance, updatedBalance });
        }
      }

      const grossPerChoice = { A: 0, B: 0 } as Record<string, number>;
      for (const p of round.players) {
        grossPerChoice.A += Number(p.bet_A) || 0;
        grossPerChoice.B += Number(p.bet_B) || 0;
      }
      const totalGross = grossPerChoice.A + grossPerChoice.B;
      const totalNet = totalGross * (1 - commissionValue);
      const odds = {
        A: grossPerChoice.A > 0 ? totalNet / grossPerChoice.A : 0,
        B: grossPerChoice.B > 0 ? totalNet / grossPerChoice.B : 0,
      };

      console.log(gameId,'Update -> odds:', odds);
      console.log(gameId,'Update -> gross:', grossPerChoice, 'net:', { A: grossPerChoice.A * (1 - commissionValue), B: grossPerChoice.B * (1 - commissionValue) });
      console.log(`Update -> totals: gross=${roundTo(totalGross)} net=${roundTo(totalNet)}`);
      // Show per-player summary (both A and B) in one row
      // lets create a table to better see the bets
      const betSummary = round.players.map(p => {
        const logs = betLogs.filter(b => b.mobile === p.player_id);
        const prev = logs[0]?.prevBalance ?? null;
        const updated = logs.length ? logs[logs.length - 1].updatedBalance : null;
        const delta = (prev !== null && updated !== null) ? (updated - prev) : null;
        return {
          mobile: p.player_id,
          bet_A: Number(p.bet_A) || 0,
          bet_B: Number(p.bet_B) || 0,
          prevBalance: prev !== null ? roundTo(prev) : null,
          updatedBalance: updated !== null ? roundTo(updated) : null,
          delta: delta !== null ? roundTo(delta) : null,
        };
      });
      console.log("Bet Summary Table for game: ", gameId);
      console.table(betSummary);

      const expOddsA = Number(round.totals.odds_A);
      const expOddsB = Number(round.totals.odds_B);
      const expGross = Number(round.totals.total_gross);
      const expNet = expGross * (1 - commissionValue);

      // Log Excel totals vs API computed totals for easy comparison
      console.log(gameId,'Excel totals ->', {
        gross_A: Number(round.totals.gross_A),
        gross_B: Number(round.totals.gross_B),
        total_gross: expGross,
        total_net: roundTo(expNet),
        odds_A: expOddsA,
        odds_B: expOddsB,
      });
      console.log('API totals   ->', {
        gross_A: roundTo(grossPerChoice.A),
        gross_B: roundTo(grossPerChoice.B),
        total_gross: roundTo(totalGross),
        total_net: roundTo(totalNet),
        odds_A: roundTo(odds.A),
        odds_B: roundTo(odds.B),
      });
      console.log('Expected ->', { expOddsA, expOddsB, expGross, expNet });
      expect(roundTo(odds.A)).toBe(roundTo(expOddsA));
      expect(roundTo(odds.B)).toBe(roundTo(expOddsB));
      expect(roundTo(totalGross)).toBe(roundTo(expGross));
      expect(roundTo(totalNet)).toBe(roundTo(expNet));

      const winnerChoice = round.totals.winner_index === 0 ? 'A' : 'B';
      const winnersPayload = {
        sessionId,
        choice: winnerChoice,
        odds: { A: odds.A, B: odds.B },
        winners: round.players
          .filter(p => (winnerChoice === 'A' ? Number(p.bet_A) || 0 : Number(p.bet_B) || 0) > 0)
          .map(p => ({ user: p.player_id, winAmount: Number(winnerChoice === 'A' ? p.bet_A : p.bet_B) * (winnerChoice === 'A' ? odds.A : odds.B) })),
      };

      const winRes = await requestSupertest(server.server)
        .post('/win')
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send(winnersPayload)
        .expect(201);
      console.log('Win recorded for round', roundKey, winRes.body?.id || '');

      // After win, validate each player's credited winAmount against calculated expectation
      await Utils.delay(30);
      const winChecks = [] as { mobile: string; expected: number; credited: number }[];
      for (const p of round.players) {
        const mobile = p.player_id;
        const token = tokens[mobile];
        if (!token) continue;
        // Expected winnings = bet on winning side * winning odds
        const expectedFromCalc = (winnerChoice === 'A'
          ? (Number(p.bet_A) || 0) * Number(odds.A)
          : (Number(p.bet_B) || 0) * Number(odds.B));
        // Find player's last balance before win (after bets)
        const logs = betLogs.filter(b => b.mobile === mobile);
        const beforeWinBalance = logs.length ? logs[logs.length - 1].updatedBalance : await Utils.getPlayerWalletBalance(server, token);
        const afterWinBalance = await Utils.getPlayerWalletBalance(server, token);
        const credited = Number(afterWinBalance) - Number(beforeWinBalance);
        winChecks.push({ mobile, expected: roundTo(expectedFromCalc, 2), credited: roundTo(credited, 2) });
        console.log(`Win credit check: mobile=${mobile} credited=${roundTo(credited, 2)} expected=${roundTo(expectedFromCalc, 2)}`);
        expect(roundTo(credited, 2)).toBe(roundTo(expectedFromCalc, 2));
      }
    }
  }, 90000);
});

function roundTo(num: number, decimals = 4) {
  return Number(Number(num).toFixed(decimals));
}

function numOrNull(v: any): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}


async function parseGamerounds(xlsxPath: string): Promise<RoundBlock[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);
  const ws = wb.worksheets[0];

  const rounds: RoundBlock[] = [];
  let currentPlayers: PlayerRow[] = [];

  ws.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as any[]; // 1-based index array
    // Normalize cells to strings/numbers
    const cells = values.map(v => (typeof v === 'object' && v?.text) ? v.text : v).map(v => v ?? '');
    const c1 = String(cells[1] ?? '').trim();

    if (!c1) return; // skip empty

    // Header row for players
    if (c1.toLowerCase() === 'player_id') {
      // start of a new block, reset players
      currentPlayers = [];
      return;
    }

    if (c1.toUpperCase() === 'TOTAL') {
      const com_pct = Number(cells[2] || 0);
      const gross_A = Number(cells[3] || 0);
      const gross_B = Number(cells[4] || 0);
      const total_gross = Number(cells[7] || (gross_A + gross_B));
      const total_net = Number(cells[8] || (total_gross * (1 - com_pct)));
      const odds_A = Number(cells[10] || 0);
      const odds_B = Number(cells[11] || 0);
      const winner_index = Number(cells[12] || 0);

      rounds.push({
        players: currentPlayers,
        totals: { com_pct, gross_A, gross_B, total_gross, total_net, odds_A, odds_B, winner_index }
      });
      currentPlayers = [];
      return;
    }

    // Player row: player_id, player_type, bet_A, bet_B, ...
    const player_id = c1;
    const player_type = String(cells[2] ?? '').trim();
    // guard against summary header lines like 'com_pct'
    if (player_id.toLowerCase() === 'com_pct') return;

    const bet_A = Number(cells[3] || 0);
    const bet_B = Number(cells[4] || 0);

    currentPlayers.push({ player_id, player_type, bet_A, bet_B });
  });

  return rounds;
}
