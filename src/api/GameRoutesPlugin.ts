import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { GamesTable, GameSessionsTable, BetsTable, walletTypeEnum, TransactionsTable, WalletTable, UsersTable, RoomsTable, ReferralsTable, ReferralCodesTable, CommissionsTable, GameSiteBets } from '../db/schema.ts';
import { and, eq, isNull, ne, ilike, count, desc, arrayContains, or, isNotNull, sql, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'; 
import * as schema from '../db/schema.ts'; 
import { TransactionStatus } from './TransactionRoutesPlugin.ts';
import {Channel, EventManager, GameState, Message} from "./dosletra/DosLetraPlugin.js";
import { globalAuthentication } from '../app.ts';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyReply {
    jwtSign(payload: object | string, options?: object): Promise<string>;
  }
  interface FastifyRequest {
    db: NodePgDatabase<typeof schema>;
  }
}


const GameRoutesPlugin: FastifyPluginAsync = async (server: FastifyInstance, opts) => {
  globalAuthentication(server);
  
  // Game Routes
  server.post('/game', { preHandler: server.authenticate, schema: addGameSchema }, addGame);
  server.get('/game', { preHandler: server.authenticate, schema: getAllGamesSchema }, getAllGames);
  server.get('/game/:id', { preHandler: server.authenticate, schema: getGameByIdSchema }, getGameById);
  server.put('/game/:id', { preHandler: server.authenticate, schema: updateGameSchema }, updateGame);
  server.delete('/game/:id', { preHandler: server.authenticate, schema: deleteGameSchema }, deleteGame);
  server.patch("/game/:id/status", { preHandler: server.authenticate, schema: updateGameStatusSchema }, updateGameStatus);

  // Game Session Routes
  server.post('/game/session', { preHandler: server.authenticate, schema: createGameSessionSchema }, createGameSession);
  server.get('/game/session', { preHandler: server.authenticate, schema: getAllGameSessionsSchema }, getAllGameSessions);
  server.get('/game/session/:id', { preHandler: server.authenticate, schema: getGameSessionByIdSchema }, getGameSessionById);
  server.delete('/game/session/:id', { preHandler: server.authenticate, schema: deleteGameSessionSchema }, deleteGameSession);
  server.patch('/game/session/:id', { preHandler: server.authenticate, schema: updateGameSessionSchema }, updateGameSession);
  
  // Bet Routes
  server.post('/bet', { preHandler: server.authenticate, schema: createBetSchema }, createBet);
  server.get('/bet', { preHandler: server.authenticate, schema: getBetsSchema }, getBets);
  
  server.post('/win', { preHandler: server.authenticate, schema: createWinSchema }, createWin);


  // WebSocket Request Documentation
  server.post('/docs/ws/requests/Authenticate', { schema: wsAuthenticateSchema }, ()=>{});
  server.post('/docs/ws/requests/Join', { schema: wsJoinSchema }, ()=>{});
  server.post('/docs/ws/requests/Bet', { schema: wsBetSchema }, ()=>{});
  server.post('/docs/ws/requests/Open', { schema: wsOpenSchema, }, ()=>{});
  server.post('/docs/ws/requests/Rolling', { schema: wsRollingSchema }, ()=>{}); 
  server.post('/docs/ws/requests/WinnerDeclared', { schema: wsWinnerDeclaredSchema }, ()=>{}); 
  server.post('/docs/ws/requests/NewGame', { schema: wsNewGameSchema }, ()=>{}); 
  server.post('/docs/ws/requests/SendPayout', { schema: wsSendPayoutSchema }, ()=>{}); 
  
  // WebSocket Response Documentation
  server.post('/docs/ws/responses/Update', { schema: wsUpdateResponseSchema }, ()=>{}); 
  server.post('/docs/ws/responses/WinnerDeclared/WinningChoice', { schema: wsWinnerDeclaredResponseSchema }, ()=>{}); 
  server.post('/docs/ws/responses/WinnerDeclared/TopWinners', { schema: wsTopWinnersResponseSchema }, ()=>{}); 
  server.post('/docs/ws/responses/Win', { schema: wsWinResponseSchema }, ()=>{}); 
  server.post('/docs/ws/responses/Bet/success', { schema: wsBetSuccessResponseSchema }, ()=>{});
  server.post('/docs/ws/responses/Bet/error', { schema: wsBetErrorResponseSchema }, ()=>{}); 
  server.post('/docs/ws/responses/Join/success', { schema: wsJoinSuccessResponseSchema }, ()=>{}); 
  server.post('/docs/ws/responses/Join/error', { schema: wsJoinErrorResponseSchema }, ()=>{}); 
  server.post('/docs/ws/responses/PlayerCount', { schema: wsPlayerCountResponseSchema }, () => {});

  // game history routes
  server.get('/game/history/:id', { preHandler: server.authenticate, schema: getAllGameBetHistorySchema }, getAllGameBetHistory);
};

function generateRoundCode(studioNo: string, lastRound?: string): string {
  const now = new Date();
  const year = now.getFullYear().toString().slice(-2); // last 2 digits of year
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  // Initials: first letter of each word in the game name
  // const initials = gameName
  //   .split(" ")
  //   .map((word) => word[0].toUpperCase())
  //   .join("");

  let sequence = "001";

  if (lastRound) {
    const lastSeq = parseInt(lastRound.slice(-4), 10);
    sequence = String(lastSeq + 1).padStart(4, "0");
  }

  return `${year}${month}${day}${studioNo}${sequence}`;
}

// Game Handlers
async function addGame(request: FastifyRequest, reply: FastifyReply) {
  const { name, choices, commission } = request.body as { name: string, choices: string[], commission: string };
  
  try {
    // Check if a game with the same name already exists
    const existingGame = await request.db.query.GamesTable.findFirst({
      where: and(
        eq(GamesTable.name, name),
        isNull(GamesTable.deletedAt)
      )
    });
    
    if (existingGame) {
      return reply.code(409).send({ error: 'A game with this name already exists' });
    }
    
    // Create the new game
    const [game] = await request.db.insert(GamesTable)
      .values({ name, choices, commission})
      .returning();
    
    return reply.code(201).send({ ...game });
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ error: 'Failed to create game' });
  }
}

async function getAllGames(request: FastifyRequest, reply: FastifyReply) {
  const { search, limit, offset } = request.query as any;
  
  try {
    // Build query conditions
    let conditions = [isNull(GamesTable.deletedAt)];
    
    // Add search condition if provided
    if (search) {
      conditions.push(ilike(GamesTable.name, `%${search}%`));
    }
    
    // Apply conditions
    const whereClause = and(...conditions);
    
    // Get total count
    const [totalCountResult] = await request.db
      .select({ count: count() })
      .from(GamesTable)
      .where(whereClause);
    
    const total = Number(totalCountResult.count || 0);
    
    // Build base query
    let query = request.db
      .select()
      .from(GamesTable)
      .where(whereClause)
      .orderBy(GamesTable.name).$dynamic();
    
    // Add pagination if specified
    if (limit !== undefined) {
      query = query.limit(Number(limit));
    }
    
    if (offset !== undefined) {
      query = query.offset(Number(offset));
    }
    
    // Execute query
    const games = await query;
    
    return reply.code(200).send({
      data:games,
      total
    });
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ error: 'Failed to retrieve games' });
  }
}

async function getGameById(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: number };
  
  try {
    const game = await request.db.query.GamesTable.findFirst({
      where: eq(GamesTable.id, id)
    });
    
    if (!game) {
      return reply.code(404).send({ error: 'Game not found' });
    }
    
    return reply.code(200).send({ ...game });
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ error: 'Failed to retrieve game' });
  }
}

async function updateGame(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: number };
  const { name, choices } = request.body as { name: string, choices: string[] };
  
  try {
    // Check if game exists
    const existingGame = await request.db.query.GamesTable.findFirst({
      where: and(
        eq(GamesTable.id, id),
        isNull(GamesTable.deletedAt)
      )
    });
    
    if (!existingGame) {
      return reply.code(404).send({ error: 'Game not found' });
    }
    
    // Check if name is already used by another game
    const nameConflict = await request.db.query.GamesTable.findFirst({
      where: and(
        eq(GamesTable.name, name),
        isNull(GamesTable.deletedAt),
        ne(GamesTable.id, id)
      )
    });
    
    if (nameConflict) {
      return reply.code(409).send({ error: 'A game with this name already exists' });
    }
    
    // Update the game
    const [updatedGame] = await request.db
      .update(GamesTable)
      .set({ 
        name, 
        choices,
        updatedAt: new Date() 
      })
      .where(eq(GamesTable.id, id))
      .returning();
    
    return reply.code(200).send({ ...updatedGame });
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ error: 'Failed to update game' });
  }
}

async function deleteGame(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: number };
  
  try {
    // Check if game exists and not already deleted
    const existingGame = await request.db.query.GamesTable.findFirst({
      where: and(
        eq(GamesTable.id, id),
        isNull(GamesTable.deletedAt)
      )
    });
    
    if (!existingGame) {
      return reply.code(404).send({ error: 'Game not found or already deleted' });
    }
    
    // Soft delete the game
    await request.db
      .update(GamesTable)
      .set({ 
        deletedAt: new Date() 
      })
      .where(eq(GamesTable.id, id));
    
    return reply.code(200).send({ 
      success: true, 
      message: 'Game deleted successfully' 
    });
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ error: 'Failed to delete game' });
  }
}

// Game Session Handlers
async function createGameSession(request: FastifyRequest, reply: FastifyReply) {
  const { gameId } = request.body as { gameId: number };
  
  try {
    // Verify the game exists and is not deleted
    const game = await request.db.query.GamesTable.findFirst({
      where: and(
        eq(GamesTable.id, gameId),
        isNull(GamesTable.deletedAt)
      )
    });
    
    if (!game) {
      return reply.code(404).send({ error: 'Game not found or inactive' });
    }

    // Find latest session for this game (today)
    const latestSession = await request.db.query.GameSessionsTable.findFirst({
      where: and(
        eq(GameSessionsTable.gameId, gameId),
        isNotNull(GameSessionsTable.round),
        isNull(GameSessionsTable.deletedAt)
      ),
      orderBy: (sessions, { desc }) => [desc(sessions.createdAt)],
    });

    const lastRound = latestSession?.round;

    // Find room studio no
    const room = await request.db.query.RoomsTable.findFirst({
      where: and(
        eq(RoomsTable.gameId, gameId),
        isNull(RoomsTable.deletedAt)
      )
    });

    const studioNo = room?.studioNo;

    const round = generateRoundCode(studioNo, lastRound);
    
    // Create the game session
    const [gameSession] = await request.db.insert(GameSessionsTable)
      .values({ gameId, round, roomId: room.id  })
      .returning();
    
    return reply.code(201).send({ ...gameSession, gameName: game.name, gameChoices: game.choices, gameCommission: game.commission });
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ error: 'Failed to create game session', message: error.message });
  }
}

async function getAllGameSessions(request: FastifyRequest, reply: FastifyReply) {
  const { gameId, limit, offset } = request.query as any;
  
  try {
    // Build query conditions
    let conditions = [isNull(GameSessionsTable.deletedAt)];
    
    // Filter by gameId if provided
    if (gameId) {
      conditions.push(eq(GameSessionsTable.gameId, gameId));
    }
    
    // Apply conditions
    const whereClause = and(...conditions);
    
    // Get total count
    const [totalCountResult] = await request.db
      .select({ count: count() })
      .from(GameSessionsTable)
      .where(whereClause);
    
    const total = Number(totalCountResult.count || 0);
    
    // Build base query
    let query = request.db
      .select()
      .from(GameSessionsTable)
      .where(whereClause)
      .orderBy(desc(GameSessionsTable.createdAt)).$dynamic();

    // Add pagination if specified
    if (limit !== undefined) {
      query = query.limit(Number(limit));
    }
    
    if (offset !== undefined) {
      query = query.offset(Number(offset));
    }
    
    // Execute query
    const gameSessions = await query;
    
    return reply.code(200).send({
      data: gameSessions,
      total
    });
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ error: 'Failed to retrieve game sessions' });
  }
}

async function getGameSessionById(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: number };
  
  try {
    const gameSession = await request.db.query.GameSessionsTable.findFirst({
      where: eq(GameSessionsTable.id, id)
    });
    
    if (!gameSession) {
      return reply.code(404).send({ error: 'Game session not found' });
    }
    // Verify the game exists and is not deleted
    const game = await request.db.query.GamesTable.findFirst({
      where: and(
        eq(GamesTable.id, gameSession.gameId),
        isNull(GamesTable.deletedAt)
      )
    });
    
    if (!game) {
      return reply.code(404).send({ error: 'Game not found or inactive' });
    }
    
    return reply.code(200).send({ ...gameSession, gameName: game.name, gameChoices: game.choices, gameCommission: game.commission });
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ error: 'Failed to retrieve game session' });
  }
}

async function deleteGameSession(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: number };
  
  try {
    // Check if game session exists and not already deleted
    const existingGameSession = await request.db.query.GameSessionsTable.findFirst({
      where: and(
        eq(GameSessionsTable.id, id),
        isNull(GameSessionsTable.deletedAt)
      )
    });
    
    if (!existingGameSession) {
      return reply.code(404).send({ error: 'Game session not found or already deleted' });
    }
    
    // Soft delete the game session
    await request.db
      .update(GameSessionsTable)
      .set({ 
        deletedAt: new Date() 
      })
      .where(eq(GameSessionsTable.id, id));
    
    return reply.code(200).send({ 
      success: true, 
      message: 'Game session deleted successfully' 
    });
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ error: 'Failed to delete game session' });
  }
}

// Bet Handlers
async function createBet(request: FastifyRequest, reply: FastifyReply) {
  const { sessionId, amount, choice } = request.body as { sessionId: number, amount: number, choice: string };
  const loggeduser:any = request.user;
  const parsedAmount = amount;
  const userId = loggeduser?.id ?? null;

  try {
    const session = await request.db.query.GameSessionsTable.findFirst({
      where: and(eq(GameSessionsTable.id, sessionId), isNull(GameSessionsTable.deletedAt))
    });
    if (!session) return reply.code(404).send({ error: 'Game session not found or inactive' });

    const [gameChoices] = await request.db.select().from(GamesTable)
      .where(and(eq(GamesTable.id, session.gameId), arrayContains(GamesTable.choices, [choice])));
    if (!gameChoices) return reply.code(404).send({ error: 'Game or choices not found' });

    const commissionRate = Number(gameChoices.commission || 0); // e.g. 0.05 = 5%
    const netAmount = parsedAmount - (parsedAmount * commissionRate);


    const [wallet] = await request.db.select().from(WalletTable)
      .where(and(eq(WalletTable.userId, userId), eq(WalletTable.type, 'game')))
      .limit(1)
      .for('update');
    if (!wallet) return reply.code(404).send({ error: 'Wallet not found' });

    const commission = Number(gameChoices.commission);
    const balance = Number(wallet.balance || 0);
    const onHold = Number(wallet.onHoldBalance || 0);
    const availableBalance = balance - onHold;
    if (availableBalance < parsedAmount) {
      return reply.code(400).send({ error: 'Insufficient Balance' });
    }
    const fee = parsedAmount * commission;

    const previousBet = await request.db.select().from(BetsTable).innerJoin(TransactionsTable, eq(BetsTable.transactionId, TransactionsTable.id))
      .where(and(
        eq(BetsTable.choice, choice),
        eq(BetsTable.gameSessionId, session.id),
        eq(TransactionsTable.userId, userId)
      ));
    if (previousBet.length > 0) {
      return reply.code(400).send({ error: 'Bet already exists in current session' });
    }

    const result = await request.db.transaction(async (trx) => {
      const [newWallet] = await trx.update(WalletTable).set({
        onHoldBalance: (onHold + parsedAmount).toString(),
        updatedAt: new Date(),
      }).where(eq(WalletTable.id, wallet.id)).returning();

      const newBalance = parseFloat(newWallet.balance) - parseFloat(newWallet.onHoldBalance);

      const [newTx] = await trx.insert(TransactionsTable).values({
        userId,
        amount: parsedAmount.toFixed(4),
        type: 'bet',
      }).returning();

      const [bet] = await trx.insert(BetsTable).values({
        choice,
        gameSessionId: sessionId,
        amount: parsedAmount.toString(),
        fee: fee.toString(),
        meta: {
          previousBalance: availableBalance,
          updatedBalance: newBalance,
          commission: commissionRate,   // optional: store commission for audit
          originalAmount: parsedAmount  // optional: store original bet
        },
        transactionId: newTx.id
      }).returning();

      return { bet, balance: newBalance };
    });

    return reply.code(201).send(result);

  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ error: 'Failed to create bet' });
  }
}

async function getBets(request: FastifyRequest, reply: FastifyReply) {
  
  try {
    // Build base query
    const bets = await request.db
      .select()
      .from(BetsTable)
      .orderBy(desc(BetsTable.createdAt));
    
      
    return reply.code(200).send({
      data: bets
    });
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ error: 'Failed to retrieve bets' });
  }
}


// Win Handlers
async function createWin(request: FastifyRequest, reply: FastifyReply) {
  type Winners = { user: string, winAmount: number };
  const { sessionId, choice, odds, winners } = request.body as { 
    sessionId: number, 
    choice: string, 
    odds: Record<string, number>, 
    winners: Winners[] 
  };

  try {
    if (winners.length < 1) return reply.code(400).send({ error: 'Invalid Parameters' });

    const session = await request.db.query.GameSessionsTable.findFirst({
      where: and(
        eq(GameSessionsTable.id, sessionId),
        isNull(GameSessionsTable.deletedAt),
        eq(GameSessionsTable.status, GameSessionStatus.IN_PROGRESS)
      )
    });
    if (!session) return reply.code(404).send({ error: 'Game session not found / inactive / completed' });

    const [gameChoices] = await request.db.select().from(GamesTable)
      .where(and(eq(GamesTable.id, session.gameId), arrayContains(GamesTable.choices, [choice])));
    if (!gameChoices) return reply.code(404).send({ error: 'Game or choices not found' });

    const gameSessionBets = await request.db.select({
      id: BetsTable.id,
      amount: BetsTable.amount,
      choice: BetsTable.choice,
      transactionId: BetsTable.transactionId,
      userId: TransactionsTable.userId,
      meta: BetsTable.meta
    }).from(BetsTable)
      .innerJoin(TransactionsTable, eq(BetsTable.transactionId, TransactionsTable.id))
      .where(eq(BetsTable.gameSessionId, sessionId));

    if (gameSessionBets.length < 1) return reply.code(404).send({ error: 'Game session has no bets' });

    const multipleBetsFromSingleUser = gameSessionBets.filter((bet, index) =>
      gameSessionBets.some((otherBet, otherIndex) => 
        otherBet.userId === bet.userId && index !== otherIndex
      )
    );
    const usersWithMultipleBets = [...new Set(multipleBetsFromSingleUser.map(bet => bet.userId))];

    const results = await request.db.transaction(async (trx) => {
      const userBalances: Record<string, any>[] = [];

      // --- Batch fetch wallets ---
      const userIds = gameSessionBets.map(b => b.userId);

      // --- Batch fetch referrals ---
      const referrals = await trx.select().from(ReferralsTable)
        .where(inArray(ReferralsTable.playerId, userIds));

      // --- Batch fetch referral codes ---
      const referralCodeIds = referrals.map(r => r.referralCodeId);
      const referralCodes = await trx.select().from(ReferralCodesTable)
        .where(inArray(ReferralCodesTable.id, referralCodeIds));

      // --- Maps for quick access ---
      const referralMap = new Map(referrals.map(r => [r.playerId, r]));
      const referralCodeMap = new Map(referralCodes.map(rc => [rc.id, rc]));

      const dbOps: Promise<any>[] = []; // array to collect parallel DB ops

      for (const bet of gameSessionBets) {
        // need to get the updated wallet
        const [walletInfo] = await trx.select().from(WalletTable)
          .innerJoin(UsersTable, eq(WalletTable.userId, UsersTable.id))
          .where(and(eq(WalletTable.userId, bet.userId), eq(WalletTable.type, 'game')));

        if (!walletInfo) throw new Error('Wallet/User not found');

        const wallet = walletInfo.wallets;
        const user = walletInfo.users;

        let currentBalance = parseFloat(wallet.balance);
        let currentOnHold = parseFloat(wallet.onHoldBalance);
        const betAmount = parseFloat(bet.amount);

        let updatedBalance = currentBalance - betAmount;
        let updatedOnHold = currentOnHold - betAmount;
        let updatedWinnings = 0;
        let updatedMeta: any = bet.meta;

        const betWinner = winners.find(w => w.user === user.mobile);
        if (betWinner && bet.choice === choice) {
          updatedWinnings = betWinner.winAmount;
          updatedBalance += updatedWinnings;
          updatedMeta = { previousBalance: updatedMeta.updatedBalance, updatedBalance };
        }
        
        // update wallet right away for next iteration
        await trx.update(WalletTable).set({
          onHoldBalance: updatedOnHold.toString(),
          balance: updatedBalance.toString(),
          updatedAt: new Date()
        }).where(eq(WalletTable.id, wallet.id))

        dbOps.push(
          trx.update(TransactionsTable).set({
            status: TransactionStatus.COMPLETED,
            updatedAt: new Date()
          }).where(eq(TransactionsTable.id, bet.transactionId))
        );

        dbOps.push(
          trx.update(BetsTable).set({
            odds: odds[bet.choice].toString(),
            winAmount: updatedWinnings.toString(),
            meta: updatedMeta,
            updatedAt: new Date()
          }).where(eq(BetsTable.id, bet.id))
        );

        // --- Handle commissions ---
        const referral = referralMap.get(user.id);
        if (referral) {
          const refCode = referralCodeMap.get(referral.referralCodeId);
          if (refCode) {
            const opAmount = betAmount * parseFloat(refCode.pctOperator.toString());
            const rep1Amount = referral.rep1Id ? betAmount * parseFloat(refCode.pctRep1.toString()) : 0;
            const rep2Amount = referral.rep2Id ? betAmount * parseFloat(refCode.pctRep2.toString()) : 0;

            // Update wallets separately
            const commissionUpdates = [
              { userId: refCode.operatorId, amount: opAmount },
              { userId: referral.rep1Id, amount: rep1Amount },
              { userId: referral.rep2Id, amount: rep2Amount },
            ].filter(c => c.userId && c.amount > 0);

            for (const com of commissionUpdates) {
              dbOps.push((async () => {
                const comWallet = await trx.select().from(WalletTable)
                  .where(and(eq(WalletTable.userId, com.userId), eq(WalletTable.type, "commission")))
                  .limit(1);

                if (comWallet[0]) {
                  const newBalance = parseFloat(comWallet[0].balance) + com.amount;
                  await trx.update(WalletTable)
                    .set({ balance: newBalance.toString(), updatedAt: new Date() })
                    .where(eq(WalletTable.id, comWallet[0].id));
                }
              })());
            }

            // ✅ Insert one commission record per bet
            dbOps.push(trx.insert(CommissionsTable).values({
              betId: bet.id,
              operatorId: refCode.operatorId,
              rep1Id: referral.rep1Id ?? 0, // or null if your schema allows
              rep2Id: referral.rep2Id ?? 0, // or null if your schema allows
              opAmount: opAmount.toFixed(4),
              rep1Amount: rep1Amount.toFixed(4),
              rep2Amount: rep2Amount.toFixed(4),
              createdAt: new Date(),
              updatedAt: new Date(),
            }));
          }
        }

        userBalances.push({
          user: user.mobile,
          balance: Number(updatedBalance.toFixed(4)),
          winAmount: Number(updatedWinnings.toFixed(4))
        });
      }
      // --- Execute all DB operations in parallel ---
      await Promise.all(dbOps);

      // --- Update GameSiteBets using the helper function ---
      const gameSiteBetResult = await updateGameSiteBetsForSession(trx, sessionId, choice, odds);
      
      // You can optionally log the GameSiteBets update result
      console.log(`Updated ${gameSiteBetResult.updatedCount} GameSiteBets with total win amount: ${gameSiteBetResult.totalWinAmount}`);

      return userBalances;
    });

    return reply.code(201).send({ winners: results });

  } catch (error) {
    console.log(error);
    request.log.error(error);
    return reply.code(500).send({ error: 'Failed to create bet', message: error.message });
  }
}


const updateGameSession = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const { id } = request.params as { id: number };
    const { status } = request.body as { status: GameSessionStatus };

    // Find the wallet
    const [existingGameSession] = await request.db
      .select()
      .from(GameSessionsTable)
      .where(eq(GameSessionsTable.id, id));

    if (!existingGameSession) {
      return reply.code(404).send({ error: 'Game session not found' });
    }

    // Prepare update data
    const [updatedGameSession] = await request.db
      .update(GameSessionsTable)
      .set({
        status,
        updatedAt: new Date() 
      })
      .where(eq(GameSessionsTable.id, id))
      .returning();

    return reply.code(200).send(updatedGameSession);
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ error: 'Internal Server Error' });
  }
};

async function getAllGameBetHistory(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: number };
  
  try {
    const game = await request.db.query.GamesTable.findFirst({
      where: eq(GamesTable.id, id)
    });
    
    if (!game) {
      return reply.code(404).send({ error: 'Game not found or inactive' });
    }

    const gameHistory = await request.db
    .select({
      betId: BetsTable.id,
      amount: BetsTable.amount,
      choice: BetsTable.choice,
      round: GameSessionsTable.round,
      status: GameSessionsTable.status,
      createdAt: GameSessionsTable.createdAt
    })
    .from(BetsTable)
    .innerJoin(GameSessionsTable, eq(BetsTable.gameSessionId, GameSessionsTable.id))
    .where(and(
      eq(GameSessionsTable.gameId, id)
    ))
    .orderBy(desc(BetsTable.createdAt));
  
    return reply.code(200).send(gameHistory);
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ error: 'Failed to retrieve game session' });
  }
}

async function updateGameStatus(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = request.params as { id: number };
    const { status } = request.body as { status: "enable" | "disable" };

    const updated = await request.db
      .update(GamesTable)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(GamesTable.id, id), isNull(GamesTable.deletedAt)))
      .returning();

    if (!updated.length) {
      return reply.code(404).send({ error: "Game not found" });
    }

    EventManager.emit(
      "gameStatus",
      new Message(Channel.Game, GameState.GameStatus, {
        data: {
          status: updated[0].status,
        },
      })
    );

    return reply.code(200).send({ game: updated[0] });
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: "Internal server error" });
  }
}

const updateGameStatusSchema = {
  description: "Update game status (enable or disable).",
  tags: ["games"],
  params: {
    type: "object",
    required: ["id"],
    properties: { id: { type: "number" } },
  },
  body: {
    type: "object",
    required: ["status"],
    properties: {
      status: { type: "string", enum: ["enable", "disable"] },
    },
  },
  response: {
    200: {
      type: "object",
      properties: {
        game: {
          type: "object",
          properties: {
            id: { type: "number" },
            name: { type: "string" },
            status: { type: "string", enum: ["enable", "disable"] },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
      },
    },
    404: { type: "object", properties: { error: { type: "string" } } },
  },
};

async function updateGameSiteBetsForSession(
  trx: any, 
  sessionId: number, 
  winningChoice: string, 
  odds: Record<string, number>
) {
  try {
    // Get all GameSiteBets for this session
    const gameSiteBets = await trx.select()
      .from(GameSiteBets)
      .where(and(
        eq(GameSiteBets.gameSessionId, sessionId),
        isNull(GameSiteBets.deletedAt)
      ));

    if (gameSiteBets.length === 0) {
      return { updatedCount: 0, totalWinAmount: 0 };
    }

    let updatedCount = 0;
    let totalWinAmount = 0;

    // Process each GameSiteBet
    const gameSiteBetUpdates = gameSiteBets.map(async (bet: any) => {
      const betAmount = Number(bet.amount || 0);
      const betChoice = bet.choice;
      const winningOdds = odds[winningChoice] || 0;
      
      let winAmount = 0;
      let newStatus: "UNCLAIMED" | "LOSE" = "LOSE";

      // Check if this bet won
      if (betChoice === winningChoice && winningOdds > 0) {
        winAmount = betAmount * winningOdds;
        newStatus = "UNCLAIMED";
        totalWinAmount += winAmount;
      }

      // Update the GameSiteBet
      await trx.update(GameSiteBets)
        .set({
          winAmount: winAmount.toString(),
          status: newStatus,
          updatedAt: new Date()
        })
        .where(eq(GameSiteBets.id, bet.id));

      updatedCount++;
    });

    // Execute all GameSiteBet updates
    await Promise.all(gameSiteBetUpdates);

    return { updatedCount, totalWinAmount };
  } catch (error) {
    console.error('Error updating GameSiteBets:', error);
    throw error;
  }
}

// Schema definitions for Swagger documentation
const gameProperties = {
  id: { type: 'number' },
  name: { type: 'string' },
  choices: { type: 'array' },
  commission: { type: 'number' },
  status: { type: 'string' },
  createdAt: { type: 'string', format: 'date-time' },
  updatedAt: { type: 'string', format: 'date-time' },
  deletedAt: { type: 'string', format: 'date-time', nullable: true }
};

const gameSessionProperties = {
  id: { type: 'number' },
  gameId: { type: 'number' },
  round: { type: 'string' },
  roomId: { type: 'number' },
  status: { type: 'string' },
  createdAt: { type: 'string', format: 'date-time' },
  deletedAt: { type: 'string', format: 'date-time', nullable: true }
};

const errorResponse = {
  type: 'object',
  properties: { error: { type: 'string' }, message: { type: 'string' } }
};

const validationErrorResponse = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    message: { type: 'string' },
    validation: {
      type: 'array',
      items: { type: 'object' }
    }
  }
};

// Game Routes Schemas
const addGameSchema = {
  description: 'Create a new game',
  tags: ['games'],
  body: {
    type: 'object',
    required: ['name', 'choices', 'commission'],
    properties: {
      name: { type: 'string' },
      choices: {
        type: 'array',
        items: { type: 'string' }
      },
      commission: { type: 'string' }
    }
  },
  response: {
    201: {
      type: 'object',
      properties: {
        ...gameProperties
      }
    },
    400: validationErrorResponse,
    409: errorResponse,
    500: errorResponse
  }
};

const getAllGamesSchema = {
  description: 'Get all games with optional search and pagination',
  tags: ['games'],
  querystring: {
    type: 'object',
    properties: {
      search: { type: 'string' },
      limit: { type: 'number', minimum: 1 },
      offset: { type: 'number', minimum: 0 }
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: gameProperties
          }
        },
        total: { type: 'number' }
      }
    },
    500: errorResponse
  }
};

const getGameByIdSchema = {
  description: 'Get a game by ID',
  tags: ['games'],
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'number' }
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        ...gameProperties
      }
    },
    404: errorResponse,
    500: errorResponse
  }
};

const updateGameSchema = {
  description: 'Update a game by ID',
  tags: ['games'],
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'number' }
    }
  },
  body: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string' },
      choices: {
        type: 'array',
        items: { type: 'string' }
      }
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        ...gameProperties
      }
    },
    404: errorResponse,
    409: errorResponse,
    500: errorResponse
  }
};

const deleteGameSchema = {
  description: 'Soft delete a game by ID',
  tags: ['games'],
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'number' }
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' }
      }
    },
    404: errorResponse,
    500: errorResponse
  }
};

// Game Session Routes Schemas
const createGameSessionSchema = {
  description: 'Create a new game session',
  tags: ['game-sessions'],
  body: {
    type: 'object',
    required: ['gameId'],
    properties: {
      gameId: { type: 'number' }
    }
  },
  response: {
    201: {
      type: 'object',
      properties: {
        ...gameSessionProperties,
        gameName: {type: 'string'},
        gameChoices: {type: 'array'}, 
        gameCommission: { type: 'number' },
      }
    },
    404: errorResponse,
    500: errorResponse
  }
};


const getAllGameSessionsSchema = {
  description: 'Get all game sessions with optional filters',
  tags: ['game-sessions'],
  querystring: {
    type: 'object',
    properties: {
      gameId: { type: 'number' },
      limit: { type: 'number', minimum: 1 },
      offset: { type: 'number', minimum: 0 }
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: gameSessionProperties
          }
        },
        total: { type: 'number' }
      }
    },
    500: errorResponse
  }
};

const getGameSessionByIdSchema = {
  description: 'Get a game session by ID',
  tags: ['game-sessions'],
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'number' }
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        ...gameSessionProperties,
        gameName: {type: 'string'},
        gameChoices: {type: 'array'}, 
        gameCommission: { type: 'number' },
      }
    },
    404: errorResponse,
    500: errorResponse
  }
};

const deleteGameSessionSchema = {
  description: 'Soft delete a game session by ID',
  tags: ['game-sessions'],
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'number' }
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' }
      }
    },
    404: errorResponse,
    500: errorResponse
  }
};

// Add bet and win schemas
const createBetSchema = {
  description: 'Place a bet on a game session',
  tags: ['bets'],
  body: {
    type: 'object',
    required: ['sessionId', 'amount', 'choice'],
    properties: {
      sessionId: { type: 'number' },
      amount: {type: 'number'},
      choice: {type: 'string'}
    }
  },
  response: {
    201: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        transactionId: { type: 'number' },
        createdAt: { type: 'string' },
        updatedAt: { type: 'string'},
        amount: { type: 'number' },
        balance: { type: 'number' },
        deletedAt: { type: 'string' },
        gameSessionId: { type: 'number' },
        choice: { type: 'string' },
        winAmount: { type: 'number' },
        odds: { type: 'string' }
      }
    },
    400: validationErrorResponse,
    404: errorResponse,
    500: errorResponse
  }
};

const getBetsSchema = {
  description: 'Get bets with optional filtering by sessionId',
  tags: ['bets'],
  response: {
    200: {
      type: 'object',
      properties: {
        data: {
            type: 'array',
            properties: {
              id: {  type: 'number' },
              sessionId: {  type: 'number' },
              transactionId: {type:'string'},
              choice: {type: 'string'},
              createdAt: { type: 'string', format: 'date-time' }
            }
          
        }
      }
    },
    500: errorResponse
  }
};

const sendPayoutSchema = {
  description: 'Records all bet winnings',
  tags: ['payout'],
  body: {
    type: 'object',
    required: ['sessionId', 'userWinnings', 'choice'],
    properties: {
      sessionId: { type: 'number' },
      userWinnings: {type: 'object'},
      choice: {type: 'string'}
    }
  },
  response: {
    201: {
      type: 'object',
      properties: {
        userBalances: {type: 'object'},
      }
    },
    400: validationErrorResponse,
    404: errorResponse,
    500: errorResponse
  }
};

export const createWinSchema = {
  description: 'Record a winning bet and update winAmount for a game session',
  tags: ['wins'],
  body: {
    type: 'object',
    required: ['sessionId', 'choice', 'odds', 'winners'],
    properties: {
      sessionId: { type: 'number' },
      choice: { type: 'string' },
      odds: {
        type: 'object',
        additionalProperties: { type: 'number' } // allows { "B": 2.0 }, etc.
      },
      winners: {
        type: 'array',
        items: {
          type: 'object',
          required: ['user', 'winAmount'],
          properties: {
            user: { type: 'string' },      // e.g., phone number
            winAmount: { type: 'number' }  // numeric win amount
          }
        }
      }
    }
  },
  response: {
    201: {
      type: 'object',
      properties: {
        winners: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              user: { type: 'string' },
              winAmount: { type: 'number' }
            }
          }
        }
      }
    },
    400: validationErrorResponse,
    404: errorResponse,
    500: errorResponse
  }
};

const getWinsSchema = {
  description: 'Get wins with optional filtering by sessionId',
  tags: ['wins'],
  response: {
    200: {
      type: 'object',
      properties: {
        data: {
            type: 'array',
            properties: {
              id: {  type: 'number' },
              sessionId: {  type: 'number' },
              transactionId: {type:'string'},
              choice: {type: 'string'},
              createdAt: { type: 'string', format: 'date-time' }
            }
          
        }
      }
    },
    500: errorResponse
  }
};

// WebSocket Request Examples
const wsAuthenticateSchema = {
  description: 'Authenticate with WebSocket',
  tags: ['WS Game Requests'],
  summary: 'Authenticate with a JWT token',
  body: {
    type: 'object',
    properties: {
      state: { type: 'string' },
      data: { 
        type: 'object',
        properties: {
          token: { type: 'string' }
        }
      }
    }
  }
};

const wsBetSchema = {
  description: 'Place a bet via WebSocket',
  tags: ['WS Game Requests'],
  summary: 'Place a bet on the current game session',
  body: {
    type: 'object',
    properties: {
      channel: { type: 'string' },
      state: { type: 'string' },
      data: { 
        type: 'object',
        properties: {
          choice: { type: 'string' },
          amount: { type: 'number' }
        }
      }
    }
  }
};

const wsJoinSchema = {
  description: 'Join studio via WebSocket',
  tags: ['WS Game Requests'],
  summary: 'Join an existing studio',
  body: {
    type: 'object',
    properties: {
      channel: { type: 'string' },
      state: { type: 'string' },
      data: { 
        type: 'object',
        properties: {
          studioNo: { type: 'string' }
        }
      }
    }
  }
};

const wsUpdateSchema = {
  description: 'Get current game status',
  tags: ['WS Game Requests'],
  summary: 'Request current game status update',
  body: {
    type: 'object',
    properties: {
      channel: { type: 'string' },
      state: { type: 'string' },
      data: { type: 'object'}
    }
  }
};

const wsOpenSchema = {
  description: 'Open game for betting',
  tags: ['WS Game Requests'],
  summary: 'Open the current game session for betting',
  body: {
    type: 'object',
    properties: {
      channel: { type: 'string' },
      state: { type: 'string' },
      data: { type: 'object'}
    }
  }
};

const wsRollingSchema = {
  description: 'Start rolling animation',
  tags: ['WS Game Requests'],
  summary: 'Begin the rolling animation for the current game',
  body: {
    type: 'object',
    properties: {
      channel: { type: 'string' },
      state: { type: 'string' },
      data: { type: 'object' }
    }
  }
};

const wsWinnerDeclaredSchema = {
  description: 'Declare winner',
  tags: ['WS Game Requests'],
  summary: 'Declare the winning choice for the current game',
  body: {
    type: 'object',
    properties: {
      channel: { type: 'string' },
      state: { type: 'string' },
      data: { 
        type: 'object',
        properties: {
          choice: { type: 'string' }
        }
      }
    }
  }
};

const wsNewGameSchema = {
  description: 'Start a new game',
  tags: ['WS Game Requests'],
  summary: 'Start a new game session',
  body: {
    type: 'object',
    properties: {
      channel: { type: 'string' },
      state: { type: 'string' },
      data: { 
        type: 'object',
        properties: {
          gameId: { type: 'string' }
        }
      }
    }
  }
};

const wsSendPayoutSchema = {
  description: 'Process payouts',
  tags: ['WS Game Requests'],
  summary: 'Process payouts for the current game session',
  body: {
    type: 'object',
    properties: {
      channel: { type: 'string' },
      state: { type: 'string' },
      data: { type: 'object' }
    }
  }
};

// WebSocket Response Examples
const wsUpdateResponseSchema = {
  description: 'Game state update broadcast',
  tags: ['WS Game Response'],
  summary: 'Current game state with betting odds and amounts',
  body: {
    type: 'object',
    properties: {
      channel: { type: 'string' },
      state: { type: 'string' },
      data: { 
        type: 'object',
        properties: {
          commission: { type: 'number' },
          odds: { 
            type: 'object',
            properties: {
              A: { type: 'number' },
              B: { type: 'number' }
            }
          },
          net: { 
            type: 'object',
            properties: {
              A: { type: 'number' },
              B: { type: 'number' }
            }
          },
          gross: { 
            type: 'object',
            properties: {
              A: { type: 'number' },
              B: { type: 'number' }
            }
          }
        }
      }
    }
  }
};

const wsWinnerDeclaredResponseSchema = {
  description: 'Winner declaration broadcast',
  tags: ['WS Game Response'],
  summary: 'Broadcast when a winner is declared',
  body: {
    type: 'object',
    properties: {
      channel: { type: 'string' },
      state: { type: 'string' },
      data: { 
        type: 'object',
        properties: {
          choice: { type: 'string' }
        }
      }
    }
  }
};

const wsTopWinnersResponseSchema = {
  description: 'Top winners broadcast',
  tags: ['WS Game Response'],
  summary: 'List of top winners after a game ends',
  body: {
    type: 'object',
    properties: {
      channel: { type: 'string' },
      state: { type: 'string' },
      data: { 
        type: 'object',
        properties: {
          topWinners: { 
            type: 'array',
            items: {
              type: 'object',
              properties: {
                winnings: { type: 'number' },
                lastName: { type: 'string' },
                firstName: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }
};

const wsWinResponseSchema = {
  description: 'Individual winner notification',
  tags: ['WS Game Response'],
  summary: 'Notification sent to each winner',
  body: {
    type: 'object',
    properties: {
      channel: { type: 'string' },
      state: { type: 'string' },
      data: { 
        type: 'object',
        properties: {
          wins: { type: 'number' },
          balance: { type: 'string' }
        }
      }
    }
  }
};

const wsBetSuccessResponseSchema = {
  description: 'Successful bet response',
  tags: ['WS Game Response'],
  summary: 'Response when a bet is successfully placed',
  body: {
    type: 'object',
    properties: {
      channel: { type: 'string' },
      state: { type: 'string' },
      data: { 
        type: 'object',
        properties: {
          choice: { type: 'string' },
          amount: { type: 'number' },
          balance: { type: 'string' }
        }
      }
    }
  }
};

const wsBetErrorResponseSchema = {
  description: 'Failed bet response',
  tags: ['WS Game Response'],
  summary: 'Response when a bet cannot be placed',
  body: {
    type: 'object',
    properties: {
      channel: { type: 'string' },
      state: { type: 'string' },
      error: { type: 'string' }
    }
  }
};

const wsJoinSuccessResponseSchema = {
  description: 'Successful join response',
  tags: ['WS Game Response'],
  summary: 'Response when a player is successfully joined a studio',
  body: {
    type: 'object',
    properties: {
      channel: { type: 'string' },
      state: { type: 'string' },
      data: { 
        type: 'object',
        properties: {
          studioNo: { type: 'string' },
          status: { type: 'string' },
        }
      }
    }
  }
};

const wsJoinErrorResponseSchema = {
  description: 'Failed Join response',
  tags: ['WS Game Response'],
  summary: 'Response when a player cannot join the game',
  body: {
    type: 'object',
    properties: {
      channel: { type: 'string' },
      state: { type: 'string' },
      error: { type: 'string' }
    }
  }
};


const wsPlayerCountResponseSchema = {
  description: 'Broadcasted player count response',
  tags: ['WS Game Response'],
  summary: 'Response sent to all clients whenever the active player count changes',
  body: {
    type: 'object',
    properties: {
      channel: { type: "string", enum: ["Game"] },
      state: { type: "string", enum: ["PlayerCount"] },
      data: {
        type: 'object',
        properties: {
          playerCount: { type: 'integer' }
        },
        required: ['count']
      }
    },
    required: ['channel', 'state', 'data']
  }
};

export enum GameSessionStatus {
  IN_PROGRESS = 'in progress',
  COMPLETED = 'completed',
}

const updateGameSessionSchema = {
  description: 'Update game session status',
  tags: ['game-sessions'],
  body: {
    type: 'object',
    properties: {
      status: { type: 'string' },
    }
  },
  response: {
    200: {
      description: 'Updated game session details',
      ...gameSessionProperties
    },
    400: {
      description: 'Bad Request',
      type: 'object',
      properties: {
        error: { type: 'string' }
      }
    },
    404: {
      description: 'Game session not found',
      type: 'object',
      properties: {
        error: { type: 'string' }
      }
    },
    500: {
      description: 'Internal Server Error',
      type: 'object',
      properties: {
        error: { type: 'string' }
      }
    }
  }
};

const gameBetsProperties = {
  betId: { type: 'number' },
  amount: { type: 'number' },
  choice: { type: 'string' },
  round: { type: 'string' },
  status: { type: 'string' },
  createdAt: { type: 'string', format: 'date-time' }
};

const getAllGameBetHistorySchema = {
  description: 'Get a game bets history by game id',
  tags: ['game-history'],
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'number' }
    }
  },
  response: {
    200: {
      type: 'array',
      items: {
        type: 'object',
        properties: gameBetsProperties
      }
    },
    404: errorResponse,
    500: errorResponse
  }
};

export default GameRoutesPlugin;