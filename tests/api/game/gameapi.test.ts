import { FastifyInstance } from 'fastify';
import requestSupertest from 'supertest';
import { describe, it, beforeAll, afterAll, beforeEach, afterEach, expect } from 'vitest';
import { Utils } from '../../utils/utils.ts';
import UserRoutesPlugin from '../../../src/api/UserRoutesPlugin.ts';
import TransactionRoutesPlugin from '../../../src/api/TransactionRoutesPlugin.ts';
import WalletRoutesPlugin from '../../../src/api/WalletRoutesPlugin.ts';
import GameRoutesPlugin from '../../../src/api/GameRoutesPlugin.ts';
import RoomsRoutesPlugin from '../../../src/api/RoomsRoutesPlugin.ts';
import { StudiosTable } from '../../../src/db/schema.ts';
import { eq } from 'drizzle-orm';

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

describe('GAME API: end-to-end via HTTP only', () => {
	const url = 'postgresql://postgres:postgres@aggregator_db:5432/';
	const dbName = 'gameApiFlow';
	let server: FastifyInstance;
	let utils: Utils = new Utils();

	// Lets save the users and tokens in a variable to use in the test
	let moderator: any;
	let player1: any;
	let player2: any;
	let moderatorToken: string;
	let player1Token: string;
	let player2Token: string;
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

		await server.ready();
	});

	afterAll(async () => {
		await utils.afterAll();
	});

	beforeEach(async () => {
		await utils.beforeEach();

		// Fetch the studio if it exists
		// check if studio exists
		const existing = await server.db.select().from(StudiosTable).where(eq(StudiosTable.studioNo, 'DL01'));
		if (existing.length === 0) {
			await server.db.insert(StudiosTable).values({ studioNo: 'DL01' });
		}

		moderator = buildUserPayload({
			firstName: 'Moderator', lastName: 'Test', userName: 'mod_http_01',
			email: 'moderator_http@test.com', mobile: '09100000001', type: 'moderator', password: 'password123'
		}, 0);
		player1 = buildUserPayload({
			firstName: 'Player', lastName: 'One', userName: 'player_http_01',
			email: 'player1_http@test.com', mobile: '09100000002', type: 'player', password: 'password123'
		}, 1);
		player2 = buildUserPayload({
			firstName: 'Player', lastName: 'Two', userName: 'player_http_02',
			email: 'player2_http@test.com', mobile: '09100000003', type: 'player', password: 'password123'
		}, 2);

		const modRegistration = await requestSupertest(server.server).post('/register').send(moderator).expect(201);
		const p1Registration = await requestSupertest(server.server).post('/register').send(player1).expect(201);
		const p2Registration = await requestSupertest(server.server).post('/register').send(player2).expect(201);

		moderatorToken = modRegistration.body.token;
		player1Token = p1Registration.body.token;
		player2Token = p2Registration.body.token;
		await makeDeposit(server, player1Token, 1000);
		await makeDeposit(server, player2Token, 1000);
	});

	afterEach(async () => {
		await utils.afterEach();
	});

	it('should create game, create session, place bet, declare winner, and verify wallet', async () => {

		const initialP1Balance = await getGameWalletBalance(server, player1Token);
		const initialP2Balance = await getGameWalletBalance(server, player2Token);

		const gameRes = await requestSupertest(server.server)
			.post('/game')
			.set('Authorization', `Bearer ${moderatorToken}`)
			.send({ name: `HTTP Game ${Date.now()}`, choices: ['A','B'], commission: '0.10' })
			.expect(201);
		gameId = gameRes.body.id;

		const roomRes = await requestSupertest(server.server)
			.post('/rooms')
			.set('Authorization', `Bearer ${moderatorToken}`)
			.send({ gameId, studioNo: 'DL01' })
			.expect(201);
		roomId = roomRes.body.room.id;
		expect(roomId).toBeTruthy();

		const sessionRes = await requestSupertest(server.server)
			.post('/game/session')
			.set('Authorization', `Bearer ${moderatorToken}`)
			.send({ gameId })
			.expect(201);
		sessionId = sessionRes.body.id;
		expect(sessionId).toBeTruthy();

		// Players place bets
		const p1BetAmount = 100;
		const p2BetAmount = 200;
		await requestSupertest(server.server)
			.post('/bet')
			.set('Authorization', `Bearer ${player1Token}`)
			.send({ sessionId, amount: p1BetAmount, choice: 'A' })
			.expect(201);
		await requestSupertest(server.server)
			.post('/bet')
			.set('Authorization', `Bearer ${player2Token}`)
			.send({ sessionId, amount: p2BetAmount, choice: 'B' })
			.expect(201);

		// LETS GO!! declare winner for choice 'A'
		const oddsA = 2.0; // not sure about the ods but lets use 2.0
		const winRes = await requestSupertest(server.server)
			.post('/win')
			.set('Authorization', `Bearer ${moderatorToken}`)
			.send({
				sessionId,
				choice: 'A',
				odds: { A: oddsA, B: 0 },
				winners: [
					{ user: player1.mobile, winAmount: p1BetAmount * oddsA },
				],
			})
			.expect(201);
		expect(Array.isArray(winRes.body.winners)).toBe(true);

		// Verify final bal
		const finalP1 = await getGameWalletBalance(server, player1Token);
		const finalP2 = await getGameWalletBalance(server, player2Token);

		const expectedP1 = initialP1Balance - p1BetAmount + (p1BetAmount * oddsA);
		const expectedP2 = initialP2Balance - p2BetAmount;

		const epsilon = 0.01;
		expect(Math.abs(finalP1 - expectedP1)).toBeLessThanOrEqual(epsilon);
		expect(Math.abs(finalP2 - expectedP2)).toBeLessThanOrEqual(epsilon);
		console.log(`initialP1Balance: ${initialP1Balance}, initialP2Balance: ${initialP2Balance}, finalP1: ${finalP1}, finalP2: ${finalP2}, expectedP1: ${expectedP1}, expectedP2: ${expectedP2}`);
	}, 30000);
});
