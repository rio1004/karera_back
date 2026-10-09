import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { GamingSitesTable, GameSiteBets, GameSiteTickets, WalletTable, TransactionsTable, BetsTable, GamesTable, GameSessionsTable, UsersTable, ProfilesTable } from "../db/schema.ts";
import { sum, count, gte, lte } from "drizzle-orm";
import {and, eq, isNull, inArray} from "drizzle-orm";

const GamingSitesRoutesPlugin: FastifyPluginAsync = async (server: FastifyInstance) => {
  server.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({error: "Unauthorized Request"});
    }
  });

  server.register(
    async (r) => {
      r.addHook("preHandler", r.authenticate);
      r.get("/", {schema: getGamingSitesSchema}, getGamingSite);
      r.post("/", {schema: createGamingSiteSchema}, createGamingSite);
      r.get("/:id", {schema: getGamingSiteByIdSchema}, getGamingSiteById);
      r.patch("/:id", {schema: updateGamingSiteSchema}, updateGamingSite);
      r.delete("/:id", {schema: deleteGamingSiteSchema}, deleteGamingSite);
    },
    {prefix: "/game-site"}
  );

  server.get("/sites", {schema: getGamingSitesSchema}, getGamingSites);

  server.post("/gamesite/bet", { preHandler: server.authenticate, schema: createGameSiteBetSchema }, createGameSiteBet);
  server.post("/gamesite/bet/finalize", { preHandler: server.authenticate, schema: finalizeGameSiteBetSchema }, finalizeGameSiteBet);
  server.get("/gamesite/bet/results", { preHandler: server.authenticate, schema: getGameSiteBetResultsSchema }, getGameSiteBetResults);
  server.get("/gamesite/transactions", { preHandler: server.authenticate, schema: getGameSiteBetsTransactionSchema }, getGameSiteBetsTransaction);
  server.patch("/gamesite/:id", { preHandler: server.authenticate, schema: updateGameSiteBetStatusSchema }, updateGameSiteBetStatus);

}

interface CreateGamingSiteBody {
  name: string;
  gameSiteId: string;
  description?: string;
}

interface UpdateGamingSiteBody {
  name?: string;
  description?: string;
}

export const createGamingSiteSchema = {
  tags: ["Gaming Sites"],
  body: {
    type: "object",
    required: ["name", "gameSiteId"],
    properties: {
      name: { type: "string", minLength: 3, maxLength: 100 },
      gameSiteId: { type: "string", minLength: 1, maxLength: 100 },
      description: { type: "string", maxLength: 255 },
    },
    additionalProperties: false,
  },
  response: {
    201: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
      },
    },
    400: {
      type: "object",
      properties: { error: { type: "string" }, message: { type: "string" } },
    },
    500: {
      type: "object",
      properties: { error: { type: "string" }, message: { type: "string" } },
    },
  },
};

export const updateGamingSiteSchema = {
  tags: ["Gaming Sites"],
  body: {
    type: "object",
    properties: {
      name: { type: "string", minLength: 3, maxLength: 100 },
      description: { type: "string", maxLength: 255 },
    },
    additionalProperties: false,
  },
  response: {
    200: { type: "object", properties: { message: { type: "string" } } },
    400: { type: "object", properties: { error: { type: "string" }, message: { type: "string" } } },
    404: { type: "object", properties: { error: { type: "string" }, message: { type: "string" } } },
    500: { type: "object", properties: { error: { type: "string" }, message: { type: "string" } } },
  },
};

export const getGamingSitesSchema = {
  tags: ["Gaming Sites"],
  response: {
    200: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
        },
      },
    },
  },
};

export const getGamingSiteByIdSchema = {
  tags: ["Gaming Sites"],
  params: {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string", format: "uuid" } },
  },
  response: {
    200: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
      },
    },
    404: { type: "object", properties: { error: { type: "string" } } },
  },
};

export const deleteGamingSiteSchema = {
  tags: ["Gaming Sites"],
  params: {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string", format: "uuid" } },
  },
  response: {
    200: { type: "object", properties: { message: { type: "string" } } },
    404: { type: "object", properties: { error: { type: "string" } } },
  },
};

export const createGameSiteBetSchema = {
  tags: ["Gaming Sites"],
  body: {
    type: "object",
    required: ["representativeId", "gameSiteId", "gameSessionId", "choice", "amount"],
    properties: {
      representativeId: { type: "number" },
      gameSiteId: { type: "number" },
      gameSessionId: { type: "number" },
      choice: { type: "string", minLength: 1 },
      amount: { type: "number", minimum: 0.01 }
    },
    additionalProperties: false
  },
  response: {
    201: {
      type: "object",
      properties: {
        bet: { type: "object" , additionalProperties: true},
        ticket: { type: "object" , additionalProperties: true}
      }
    },
    400: { type: "object", properties: { error: { type: "string" }, message: { type: "string" } } },
    401: { type: "object", properties: { error: { type: "string" }, message: { type: "string" } } },
    404: { type: "object", properties: { error: { type: "string" }, message: { type: "string" } } },
    500: { type: "object", properties: { error: { type: "string" }, message: { type: "string" } } }
  }
};

export const finalizeGameSiteBetSchema = {
  tags: ["Gaming Sites"],
  body: {
    type: "object",
    required: ["representativeId", "gameSessionId"],
    properties: {
      representativeId: { type: "number" },
      gameSessionId: { type: "number" }
    },
    additionalProperties: false
  },
  response: {
    201: {
      type: "object",
      properties: {
        totals: {
          type: "object",
          properties: { A: { type: "number" }, B: { type: "number" } },
          additionalProperties: false
        },
        bets: { type: "array", items: { type: "object" , additionalProperties: true } }
      }
    },
    400: { type: "object", properties: { error: { type: "string" }, message: { type: "string" } } },
    404: { type: "object", properties: { error: { type: "string" }, message: { type: "string" } } },
    500: { type: "object", properties: { error: { type: "string" }, message: { type: "string" } } }
  }
};

export const getGameSiteBetsTransactionSchema = {
  tags: ["Gaming Sites"],
  querystring: {
    type: "object",
    properties: {
      gameSiteId: { type: "number" },
      kioskPlayerId: { type: "number" },
      gameSessionId: { type: "number" },
      status: { type: "string", enum: ["CREATED", "CLAIMED", "UNCLAIMED", "LOSE", "REFUNDED"] },
      ticketId: { type: "string" },
      startDate: { type: "string", format: "date" },
      endDate: { type: "string", format: "date" },
      limit: { type: "number", minimum: 1, maximum: 100, default: 50 },
      offset: { type: "number", minimum: 0, default: 0 }
    },
    additionalProperties: false
  },
  response: {
    200: {
      type: "object",
      properties: {
        bets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "number" },
              ticketId: { type: "string" },
              gameSiteName: { type: "string" },
              playerName: { type: "string" },
              playerMobile: { type: "string" },
              choice: { type: "string" },
              amount: { type: "string" },
              winAmount: { type: "string" },
              status: { type: "string" },
              betType: { type: "string" },
              createdAt: { type: "string" },
              updatedAt: { type: "string" },
              // Ticket information
              ticketInfo: {
                type: "object",
                properties: {
                  totalNumberOfBets: { type: "number" },
                  totalBetAmount: { type: "string" },
                  paymentAmount: { type: "string" },
                  changeAmount: { type: "string" }
                }
              }
            }
          }
        },
        summary: {
          type: "object",
          properties: {
            totalBets: { type: "number" },
            totalAmount: { type: "string" },
            totalWinAmount: { type: "string" },
            statusCounts: {
              type: "object",
              properties: {
                CREATED: { type: "number" },
                CLAIMED: { type: "number" },
                UNCLAIMED: { type: "number" },
                LOSE: { type: "number" },
                REFUNDED: { type: "number" }
              }
            }
          }
        },
        pagination: {
          type: "object",
          properties: {
            limit: { type: "number" },
            offset: { type: "number" },
            total: { type: "number" },
            hasMore: { type: "boolean" }
          }
        }
      }
    },
    400: { type: "object", properties: { error: { type: "string" }, message: { type: "string" } } },
    500: { type: "object", properties: { error: { type: "string" }, message: { type: "string" } } }
  }
};

export const updateGameSiteBetStatusSchema = {
  tags: ["Gaming Sites"],
  params: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "number" }
    }
  },
  body: {
    type: "object",
    required: ["status"],
    properties: {
      status: { type: "string", enum: ["CREATED", "CLAIMED", "UNCLAIMED", "LOSE", "REFUNDED"] },
      notes: { type: "string", maxLength: 500 }
    },
    additionalProperties: false
  },
  response: {
    200: {
      type: "object",
      properties: {
        message: { type: "string" },
        bet: {
          type: "object",
          properties: {
            id: { type: "number" },
            ticketId: { type: "string" },
            status: { type: "string" },
            amount: { type: "string" },
            winAmount: { type: "string" },
            updatedAt: { type: "string" }
          }
        }
      }
    },
    400: { type: "object", properties: { error: { type: "string" }, message: { type: "string" } } },
    404: { type: "object", properties: { error: { type: "string" }, message: { type: "string" } } },
    500: { type: "object", properties: { error: { type: "string" }, message: { type: "string" } } }
  }
};

export const updateGameSiteBetStatus = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const { id } = request.params as { id: string };
    const { status, notes } = request.body as {
      status: "CREATED" | "CLAIMED" | "UNCLAIMED" | "LOSE" | "REFUNDED";
      notes?: string;
    };

    const userId = request.user.id; 

    if (!userId) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    // ✅ Check if user is a cashier
    const [user] = await request.db
      .select({ type: UsersTable.type })
      .from(UsersTable)
      .where(eq(UsersTable.id, userId));

    if (!user || user.type !== "cashier") {
      return reply.code(403).send({ error: "Forbidden: only cashier can update bet status" });
    }

    // 🔎 Check if the bet exists
    const [existingBet] = await request.db
      .select({
        id: GameSiteBets.id,
        ticketId: GameSiteBets.ticketId,
        status: GameSiteBets.status,
        amount: GameSiteBets.amount,
        winAmount: GameSiteBets.winAmount,
        gameSiteName: GamingSitesTable.name,
        playerName: UsersTable.firstName,
        playerMobile: UsersTable.mobile
      })
      .from(GameSiteBets)
      .innerJoin(GamingSitesTable, eq(GameSiteBets.gameSiteId, GamingSitesTable.id))
      .leftJoin(UsersTable, eq(GameSiteBets.kioskPlayerId, UsersTable.id))
      .where(and(eq(GameSiteBets.id, Number(id)), isNull(GameSiteBets.deletedAt)));

    if (!existingBet) {
      return reply.code(404).send({
        error: "GameSiteBet not found",
        message: "The specified bet does not exist or has been deleted"
      });
    }

    // ✅ Validate status transition
    const currentStatus = existingBet.status;
    const validTransitions: Record<string, string[]> = {
      CREATED: ["CLAIMED", "LOSE", "REFUNDED"],
      UNCLAIMED: ["CLAIMED", "REFUNDED"],
      CLAIMED: ["REFUNDED"],
      LOSE: ["REFUNDED"],
      REFUNDED: []
    };

    if (!validTransitions[currentStatus]?.includes(status)) {
      return reply.code(400).send({
        error: "Invalid status transition",
        message: `Cannot change status from ${currentStatus} to ${status}. Valid transitions: ${validTransitions[currentStatus]?.join(", ") || "none"}`
      });
    }

    // ✅ Update the bet status
    const [updatedBet] = await request.db
      .update(GameSiteBets)
      .set({
        status,
        updatedAt: new Date(),
        ...(notes && { meta: { notes, updatedBy: userId } })
      })
      .where(eq(GameSiteBets.id, Number(id)))
      .returning({
        id: GameSiteBets.id,
        ticketId: GameSiteBets.ticketId,
        status: GameSiteBets.status,
        amount: GameSiteBets.amount,
        winAmount: GameSiteBets.winAmount,
        updatedAt: GameSiteBets.updatedAt
      });

    return reply.send({
      message: `GameSiteBet status updated successfully from ${currentStatus} to ${status}`,
      bet: updatedBet
    });

  } catch (error: any) {
    request.log.error(error);
    return reply.code(500).send({
      error: "Failed to update GameSiteBet status",
      message: error.message
    });
  }
};


export const getGameSiteBetsTransaction = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const { 
      gameSiteId, 
      kioskPlayerId, 
      gameSessionId, 
      status, 
      ticketId, 
      startDate, 
      endDate, 
      limit = 50, 
      offset = 0 
    } = request.query as {
      gameSiteId?: number;
      kioskPlayerId?: number;
      gameSessionId?: number;
      status?: "CREATED" | "CLAIMED" | "UNCLAIMED" | "LOSE" | "REFUNDED";
      ticketId?: string;
      startDate?: string;
      endDate?: string;
      limit?: number;
      offset?: number;
    };

    // Build where conditions for bets
    const betWhereConditions = [isNull(GameSiteBets.deletedAt)];
    
    if (gameSiteId) {
      betWhereConditions.push(eq(GameSiteBets.gameSiteId, Number(gameSiteId)));
    }
    
    if (kioskPlayerId) {
      betWhereConditions.push(eq(GameSiteBets.kioskPlayerId, Number(kioskPlayerId)));
    }
    
    if (gameSessionId) {
      betWhereConditions.push(eq(GameSiteBets.gameSessionId, Number(gameSessionId)));
    }
    
    if (status) {
      betWhereConditions.push(eq(GameSiteBets.status, status));
    }
    
    if (ticketId) {
      betWhereConditions.push(eq(GameSiteBets.ticketId, ticketId));
    }

    // Add date filters if provided
    if (startDate) {
      const start = new Date(startDate);
      betWhereConditions.push(gte(GameSiteBets.createdAt, start));
    }
    
    if (endDate) {
      const end = new Date(endDate);
      betWhereConditions.push(lte(GameSiteBets.createdAt, end));
    }

    // Get bets with user information and ticket information
    const bets = await request.db
      .select({
        // Bet information
        id: GameSiteBets.id,
        ticketId: GameSiteBets.ticketId,
        choice: GameSiteBets.choice,
        amount: GameSiteBets.amount,
        winAmount: GameSiteBets.winAmount,
        status: GameSiteBets.status,
        betType: GameSiteBets.betType,
        kioskPlayerId: GameSiteBets.kioskPlayerId,
        gameSessionId: GameSiteBets.gameSessionId,
        createdAt: GameSiteBets.createdAt,
        updatedAt: GameSiteBets.updatedAt,
        gameSiteName: GamingSitesTable.name,
        playerName: UsersTable.firstName,
        playerMobile: UsersTable.mobile,
        // Ticket information
        ticketTotalNumberOfBets: GameSiteTickets.totalNumberOfBets,
        ticketTotalBetAmount: GameSiteTickets.totalBetAmount,
        ticketPaymentAmount: GameSiteTickets.paymentAmount,
        ticketChangeAmount: GameSiteTickets.changeAmount
      })
      .from(GameSiteBets)
      .innerJoin(GamingSitesTable, eq(GameSiteBets.gameSiteId, GamingSitesTable.id))
      .leftJoin(UsersTable, eq(GameSiteBets.kioskPlayerId, UsersTable.id))
      .leftJoin(GameSiteTickets, eq(GameSiteBets.ticketId, GameSiteTickets.ticketId))
      .where(and(...betWhereConditions))
      .orderBy(GameSiteBets.createdAt)
      .limit(Number(limit))
      .offset(Number(offset));

    // Format the response with ticket info nested
    const formattedBets = bets.map(bet => ({
      id: bet.id,
      ticketId: bet.ticketId,
      gameSiteName: bet.gameSiteName,
      playerName: bet.playerName,
      playerMobile: bet.playerMobile,
      choice: bet.choice,
      amount: bet.amount,
      winAmount: bet.winAmount,
      status: bet.status,
      betType: bet.betType,
      createdAt: bet.createdAt,
      updatedAt: bet.updatedAt,
      ticketInfo: {
        totalNumberOfBets: bet.ticketTotalNumberOfBets,
        totalBetAmount: bet.ticketTotalBetAmount,
        paymentAmount: bet.ticketPaymentAmount,
        changeAmount: bet.ticketChangeAmount
      }
    }));

    // Get total count for pagination
    const [betCount] = await request.db
      .select({ count: count() })
      .from(GameSiteBets)
      .innerJoin(GamingSitesTable, eq(GameSiteBets.gameSiteId, GamingSitesTable.id))
      .where(and(...betWhereConditions));

    // Get status counts for summary
    const statusCounts = await request.db
      .select({
        status: GameSiteBets.status,
        count: count()
      })
      .from(GameSiteBets)
      .innerJoin(GamingSitesTable, eq(GameSiteBets.gameSiteId, GamingSitesTable.id))
      .where(and(...betWhereConditions))
      .groupBy(GameSiteBets.status);

    // Calculate summary
    const totalBets = formattedBets.length;
    const totalAmount = formattedBets.reduce((sum, bet) => sum + Number(bet.amount || 0), 0);
    const totalWinAmount = formattedBets.reduce((sum, bet) => sum + Number(bet.winAmount || 0), 0);

    // Format status counts
    const statusCountsObj = {
      CREATED: 0,
      CLAIMED: 0,
      UNCLAIMED: 0,
      LOSE: 0,
      REFUNDED: 0
    };

    statusCounts.forEach(item => {
      if (item.status && item.count) {
        statusCountsObj[item.status as keyof typeof statusCountsObj] = Number(item.count);
      }
    });

    const totalCount = Number(betCount?.count || 0);
    const hasMore = (Number(offset) + Number(limit)) < totalCount;

    return reply.send({
      bets: formattedBets,
      summary: {
        totalBets,
        totalAmount: totalAmount.toString(),
        totalWinAmount: totalWinAmount.toString(),
        statusCounts: statusCountsObj
      },
      pagination: {
        limit: Number(limit),
        offset: Number(offset),
        total: totalCount,
        hasMore
      }
    });

  } catch (error: any) {
    request.log.error(error);
    return reply.code(500).send({ error: "Failed to get bets", message: error.message });
  }
};


export const createGameSiteBet = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const { representativeId, gameSiteId, gameSessionId, choice, amount, betType = "SINGLE" } = request.body as { representativeId: number; gameSiteId: number; gameSessionId: number; choice: string; amount: number; betType: string };
    const loggedUser: any = request.user;

    const [site] = await request.db
      .select()
      .from(GamingSitesTable)
      .where(and(eq(GamingSitesTable.id, Number(gameSiteId)), isNull(GamingSitesTable.deletedAt)));
    if (!site) return reply.code(404).send({ error: "Gaming site not found" });

    let ticketId = `${site.gameSiteId}-${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    // check if ticketId is already in use then generate new one if in use. loop until ticketId is not in use
    while (true) {
      const existingTicket = await request.db.select().from(GameSiteTickets).where(eq(GameSiteTickets.ticketId, ticketId));
      if (existingTicket.length > 0) {
        ticketId = `${site.gameSiteId}-${Math.floor(1000000000 + Math.random() * 9000000000)}`;
      } else {
        break;
      }
    }

    const result = await request.db.transaction(async (trx) => {
      const [bet] = await trx
        .insert(GameSiteBets)
        .values({
          kioskPlayerId: representativeId,
          gameSiteId: site.id,
          gameSessionId: Number(gameSessionId),
          ticketId,
          choice,
          amount: amount.toString(),
          betType: betType,
        } as any)
        .returning();
     
      const [ticket] = await trx
        .insert(GameSiteTickets)
        .values({
          gameSiteName: site.name,
          ticketId,
          kioskPlayerId: representativeId,
          totalNumberOfBets: 1,
          totalBetAmount: amount.toString(),
          choice,
          betType: betType,
          paymentAmount: "0",
          changeAmount: "0",
        } as any)
        .returning();

      return { bet, ticket };
    });

    return reply.code(201).send(result);
  } catch (error: any) {
    return reply.code(500).send({ 
      error: "Internal server error", 
      message: error.message 
    });
  }
};

export const finalizeGameSiteBet = async (request: FastifyRequest, reply: FastifyReply) => {
  const { representativeId, gameSessionId } = request.body as { representativeId: number; gameSessionId: number };

  // Confirm session and get game/commission to be consistent with main bet logic
  const [session] = await request.db.select().from(GameSessionsTable).where(eq(GameSessionsTable.id, Number(gameSessionId)));
  if (!session) return reply.code(404).send({ error: "Session not found" });

  const [game] = await request.db.select().from(GamesTable).where(eq(GamesTable.id, session.gameId));
  if (!game) return reply.code(404).send({ error: "Game not found" });

  // Aggregate kiosk bets by choice
  const kioskBets = await request.db
    .select({
      choice: GameSiteBets.choice,
      total: sum(GameSiteBets.amount).mapWith(Number)
    })
    .from(GameSiteBets)
    .where(and(
      eq(GameSiteBets.kioskPlayerId, Number(representativeId)),
      eq(GameSiteBets.gameSessionId, Number(gameSessionId))
    ))
    .groupBy(GameSiteBets.choice);

  const totalA = Number(kioskBets.find(b => b.choice === "A")?.total || 0);
  const totalB = Number(kioskBets.find(b => b.choice === "B")?.total || 0);
  const grandTotal = totalA + totalB;

  if (grandTotal <= 0) return reply.code(400).send({ error: "No bets to finalize" });

  // Wallet check for kiosk player
  const [wallet] = await request.db.select().from(WalletTable).where(and(eq(WalletTable.userId, Number(representativeId)), eq(WalletTable.type, 'game'))).limit(1).for('update');
  if (!wallet) return reply.code(404).send({ error: "Wallet not found" });

  const balance = Number(wallet.balance || 0);
  const onHold = Number(wallet.onHoldBalance || 0);
  const available = balance - onHold;
  if (available < grandTotal) return reply.code(400).send({ error: "Insufficient Balance", message: `Need ${grandTotal}, available ${available}` });

  // Commission logic similar to main bet creation
  const commissionRate = Number(game.commission || 0);
  const feeA = totalA * commissionRate;
  const feeB = totalB * commissionRate;

  const result = await request.db.transaction(async (trx) => {
    // Hold funds
    await trx.update(WalletTable).set({ onHoldBalance: (onHold + grandTotal).toString(), updatedAt: new Date() }).where(eq(WalletTable.id, wallet.id));

    const createdBets: any[] = [];
    let currentAvailableBalance = available; // Track available balance as we process bets

    // Helper to create main bet per choice
    const createMainBet = async (choice: "A" | "B", amount: number, fee: number) => {
      if (amount <= 0) return null;
      const [tx] = await trx.insert(TransactionsTable).values({
        userId: Number(representativeId),
        amount: amount.toFixed(4),
        type: 'bet'
      }).returning();

      // Calculate updated balance after this bet
      const updatedBalance = currentAvailableBalance - amount;

      const [mainBet] = await trx.insert(BetsTable).values({
        choice,
        gameSessionId: Number(gameSessionId),
        amount: amount.toString(),
        fee: fee.toString(),
        meta: { 
          commission: commissionRate, 
          originalAmount: amount, 
          availableBalance: currentAvailableBalance,
          updatedBalance: updatedBalance 
        },
        transactionId: tx.id
      }).returning();

      // Update the current available balance for the next bet
      currentAvailableBalance = updatedBalance;

      // Link kiosk bets to main bet
      await trx.update(GameSiteBets).set({ mainBetId: mainBet.id }).where(and(
        eq(GameSiteBets.kioskPlayerId, Number(representativeId)),
        eq(GameSiteBets.gameSessionId, Number(gameSessionId)),
        eq(GameSiteBets.choice, choice)
      ));

      createdBets.push(mainBet);
      return mainBet;
    };

    await createMainBet("A", totalA, feeA);
    await createMainBet("B", totalB, feeB);

    return {
      totals: { A: totalA, B: totalB },
      bets: createdBets
    };
  });

  return reply.code(201).send(result);
};

export const createGamingSite = async (
  request: FastifyRequest<{ Body: CreateGamingSiteBody }>,
  reply: FastifyReply
) => {
  try {
    const [site] = await request.db
      .insert(GamingSitesTable)
      .values(request.body)
      .returning();

    return reply.code(201).send(site);
  } catch (err: any) {
    request.log.error(err);
    const pgCode = err?.code || err?.cause?.code;

    if (pgCode === "23505") {
      return reply.code(409).send({ error: "Gaming site name must be unique" });
    }

    return reply.code(500).send({ error: "Failed to create gaming site" });
  }
};

export const getGamingSite = async (request: FastifyRequest, reply: FastifyReply) => {
  const loggedUser: any = request.user;
  const userId = loggedUser?.id;

  const sites = await request.db
    .select({
      id: GamingSitesTable.id,
      name: GamingSitesTable.name,
      description: GamingSitesTable.description,
    })
    .from(GamingSitesTable)
    .innerJoin(
      ProfilesTable,
      and(
        eq(ProfilesTable.userId, userId),
        eq(ProfilesTable.gamingSite, GamingSitesTable.name)
      )
    )
    .where(isNull(GamingSitesTable.deletedAt));

  return reply.send(sites);
};

export const getGamingSites = async (request: FastifyRequest, reply: FastifyReply) => {
  const sites = await request.db.select().from(GamingSitesTable).where(
      isNull(GamingSitesTable.deletedAt)
  );

  return reply.send(sites);
};

export const getGamingSiteById = async (
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) => {
  const [site] = await request.db
    .select()
    .from(GamingSitesTable)
    .where(
      and(
        eq(GamingSitesTable.id, Number(request.params.id)),
        isNull(GamingSitesTable.deletedAt)
      )
    );

  if (!site) return reply.code(404).send({ error: "Gaming site not found" });

  return reply.send(site);
};

export const updateGamingSite = async (
  request: FastifyRequest<{ Params: { id: string }; Body: UpdateGamingSiteBody }>,
  reply: FastifyReply
) => {
  try {
    const result = await request.db
      .update(GamingSitesTable)
      .set(request.body)
      .where(
        and(
          eq(GamingSitesTable.id, Number(request.params.id)),
          isNull(GamingSitesTable.deletedAt)
        )
      )
      .returning();

    if (!result.length) return reply.code(404).send({ error: "Gaming site not found" });

    return reply.send({ message: "Gaming site updated successfully" });
  } catch (err: any) {
    request.log.error(err);
    const pgCode = err?.code || err?.cause?.code;

    if (pgCode === "23505") {
      return reply.code(400).send({ error: "Gaming site name already exists" });
    }

    return reply.code(500).send({ error: "Failed to update gaming site" });
  }
};

export const getGameSiteBetResultsSchema = {
  tags: ["Gaming Sites"],
  querystring: {
    type: "object",
    properties: {
      gameSessionId: { type: "number" },
      representativeId: { type: "number" },
      gameSiteId: { type: "number" },
      status: { type: "string", enum: ["unclaimed", "losing", "all"] }
    },
    additionalProperties: false
  },
  response: {
    200: {
      type: "object",
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "number" },
              ticketId: { type: "string" },
              choice: { type: "string" },
              amount: { type: "string" },
              winAmount: { type: "string" },
              status: { type: "string" },
              gameSiteName: { type: "string" },
              kioskPlayerId: { type: "number" },
              gameSessionId: { type: "number" },
              createdAt: { type: "string" },
              isWinner: { type: "boolean" }
            }
          }
        },
        summary: {
          type: "object",
          properties: {
            totalBets: { type: "number" },
            winningBets: { type: "number" },
            losingBets: { type: "number" },
            totalAmount: { type: "string" },
            totalWinAmount: { type: "string" }
          }
        }
      }
    },
    400: { type: "object", properties: { error: { type: "string" }, message: { type: "string" } } },
    500: { type: "object", properties: { error: { type: "string" }, message: { type: "string" } } }
  }
};

export const getGameSiteBetResults = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const { gameSessionId, representativeId, gameSiteId, status = "all" } = request.query as {
      gameSessionId?: number;
      representativeId?: number;
      gameSiteId?: number;
      status?: "unclaimed" | "losing" | "all";
    };

    // Build the where conditions for GameSiteBets
    const whereConditions = [];
    
    if (gameSessionId) {
      whereConditions.push(eq(GameSiteBets.gameSessionId, Number(gameSessionId)));
    }
    
    if (representativeId) {
      whereConditions.push(eq(GameSiteBets.kioskPlayerId, Number(representativeId)));
    }
    
    if (gameSiteId) {
      whereConditions.push(eq(GameSiteBets.gameSiteId, Number(gameSiteId)));
    }

    // Get game site bets with related data
    const gameSiteBets = await request.db
      .select({
        id: GameSiteBets.id,
        ticketId: GameSiteBets.ticketId,
        choice: GameSiteBets.choice,
        amount: GameSiteBets.amount,
        winAmount: GameSiteBets.winAmount,
        status: GameSiteBets.status,
        kioskPlayerId: GameSiteBets.kioskPlayerId,
        gameSessionId: GameSiteBets.gameSessionId,
        createdAt: GameSiteBets.createdAt,
        gameSiteName: GamingSitesTable.name,
        mainBetId: GameSiteBets.mainBetId
      })
      .from(GameSiteBets)
      .innerJoin(GamingSitesTable, eq(GameSiteBets.gameSiteId, GamingSitesTable.id))
      .where(and(...whereConditions, isNull(GameSiteBets.deletedAt)))
      .orderBy(GameSiteBets.createdAt);

    // Get main bets for this game session to determine winning choice
    const mainBets = await request.db
      .select({
        id: BetsTable.id,
        choice: BetsTable.choice,
        winAmount: BetsTable.winAmount,
        amount: BetsTable.amount,
        odds: BetsTable.odds
      })
      .from(BetsTable)
      .where(and(
        eq(BetsTable.gameSessionId, gameSessionId || 0),
        isNull(BetsTable.deletedAt)
      ));

    // Determine winning choice from main bets
    const winningChoice = mainBets.find(bet => Number(bet.winAmount) > 0)?.choice;

    // Process results and determine winners/losers based on main bets
    const results = gameSiteBets.map(bet => {
      const isWinner = bet.choice === winningChoice;
      
      return {
        id: bet.id,
        ticketId: bet.ticketId,
        choice: bet.choice,
        amount: bet.amount,
        winAmount: bet.winAmount || "0",
        status: bet.status,
        gameSiteName: bet.gameSiteName,
        kioskPlayerId: bet.kioskPlayerId,
        gameSessionId: bet.gameSessionId,
        createdAt: bet.createdAt,
        isWinner
      };
    });

    // Apply status filter
    let filteredResults = results;
    if (status === "unclaimed") {
      filteredResults = results.filter(r => r.isWinner);
    } else if (status === "losing") {
      filteredResults = results.filter(r => !r.isWinner);
    }

    // Calculate summary
    const totalBets = filteredResults.length;
    const winningBets = filteredResults.filter(r => r.isWinner).length;
    const losingBets = totalBets - winningBets;
    const totalAmount = filteredResults.reduce((sum, r) => sum + Number(r.amount || 0), 0);
    const totalWinAmount = filteredResults.reduce((sum, r) => sum + Number(r.winAmount || 0), 0);

    return reply.send({
      results: filteredResults,
      summary: {
        totalBets,
        winningBets,
        losingBets,
        totalAmount: totalAmount.toString(),
        totalWinAmount: totalWinAmount.toString()
      }
    });

  } catch (error: any) {
    request.log.error(error);
    return reply.code(500).send({ error: "Failed to get bet results", message: error.message });
  }
};

export const deleteGamingSite = async (
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) => {
  const result = await request.db
    .update(GamingSitesTable)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(GamingSitesTable.id, Number(request.params.id)),
        isNull(GamingSitesTable.deletedAt)
      )
    )
    .returning();

  if (!result.length) return reply.code(404).send({ error: "Gaming site not found" });

  return reply.send({ message: "Gaming site deleted successfully" });
};

export default GamingSitesRoutesPlugin;
