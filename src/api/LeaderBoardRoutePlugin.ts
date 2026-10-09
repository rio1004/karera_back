import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { FastifyPluginAsync } from "fastify";
import { TransactionsTable, UsersTable, BetsTable } from "../db/schema.ts";
import { sql, eq } from "drizzle-orm";

const leaderboardResponseSchema = {
  type: "object",
  properties: {
    leaderboard: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rank: { type: "integer" },
          userName: { type: "string" },
          winAmount: { type: "string" } // numeric comes back as string
        },
        required: ["rank", "userName", "winAmount"],
        additionalProperties: false
      }
    }
  },
  required: ["leaderboard"],
  additionalProperties: false
};


export const leaderboardSchema = {
    tags: ["Leaderboard"],
    querystring: {
        type: "object",
        properties: {
            limit: { type: "integer", minimum: 1, default: 10 },
            startDate: {
              type: "string",
              format: "date",   // 👈 only YYYY-MM-DD
              description: "Start date for leaderboard (inclusive)"
            },
            endDate: {
              type: "string",
              format: "date",   // 👈 only YYYY-MM-DD
              description: "End date for leaderboard (inclusive)"
            },
            gameId: {
                type: "integer",
                description: "Filter leaderboard by game ID"
            }
        },
        required: [],
        additionalProperties: false
    },
    response: {
        200: leaderboardResponseSchema
    }
};

const LeaderBoardRoutePlugin: FastifyPluginAsync = async (server: FastifyInstance) => {
  server.decorate('authenticate', async function(request: FastifyRequest, reply: FastifyReply) {
      try {
        await request.jwtVerify();
        // request.user is set by @fastify/jwt if verification succeeds
      } catch (err) {
        reply.code(401).send({ error: 'Unauthorized Request' });
      }
  });

  server.get("/leaderboard", { schema: leaderboardSchema },
    getLeaderboardHandler
  );
  server.get("/leaderboard/gift", { schema: leaderboardSchema },
    getLeaderboardHandler
  );
};

async function getLeaderboardHandler(
  request: FastifyRequest<{ Querystring: { limit?: number; startDate?: string; endDate?: string; gameId?: number } }>,
  reply: FastifyReply
) {
  try {
    const { limit = 10, startDate, endDate, gameId } = request.query;

    const now = new Date();
    const start = startDate
      ? new Date(startDate + "T00:00:00.000Z")
      : new Date(now.setHours(0, 0, 0, 0));
    const end = endDate
      ? new Date(endDate + "T23:59:59.999Z")
      : new Date();

    // build conditions
    const conditions = [
      sql`${TransactionsTable.createdAt} >= ${start}`,
      sql`${TransactionsTable.createdAt} <= ${end}`
    ];

    if (gameId !== undefined) {
      conditions.push(sql`${BetsTable.gameSessionId} = ${gameId}`);
    }

    const leaderboard = await request.db
    .select({
      userId: UsersTable.id,
      userName: UsersTable.userName,
      winAmount: sql`SUM(${BetsTable.winAmount})`.as("winAmount"),
    })
    .from(BetsTable)
    .innerJoin(TransactionsTable, eq(BetsTable.transactionId, TransactionsTable.id))
    .innerJoin(sql`"gameSessions" as gs`, sql`${BetsTable.gameSessionId} = gs.id`)
    .innerJoin(UsersTable, eq(TransactionsTable.userId, UsersTable.id))
    .where(sql.join(conditions, sql` AND `))
    .groupBy(UsersTable.id, UsersTable.userName) // ✅ group by user
    .orderBy(sql`SUM(${BetsTable.winAmount}) DESC`)
    .limit(limit);

    const rankedLeaderboard = leaderboard.map((row, index) => ({
      rank: index + 1,
      userName: row.userName,
      winAmount: row.winAmount
    }));

    return reply.code(200).send({ leaderboard: rankedLeaderboard });

  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: "Internal server error" });
  }
}

export default LeaderBoardRoutePlugin;