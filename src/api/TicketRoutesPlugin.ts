import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { FastifyPluginAsync } from "fastify";
import { BetsTable, BetTickets, GamesTable, TransactionsTable, GameSessionsTable } from "../db/schema.ts";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

interface TicketRequestPayloads {
    gameId: string;
    choice: string;
    amount: string;
}

const gamingSiteTempName = "Gaming Site - BINGONEE TAYTAY";

// const ticketObjectSchema = {
//     type: "object",/be
//     properties: {
//         transactionDate: { type: "string", format: "date-time" },
//         bets: {
//             type: "object",
//             properties: {
//                 choice: { type: "string" },
//                 amount: { type: "string" }
//             },
//             required: ["choice", "amount"],
//             additionalProperties: false
//         },
//         representativeId: { type: "string", format: "uuid" },
//         ticketNumber: { type: "string", pattern: "^SBT-\\d{10}$" },
//         siteName: { type: "string" }
//     },
//     required: [
//         "transactionDate",
//         "bets",
//         "representativeId",
//         "ticketNumber",
//         "siteName"
//     ],
//     additionalProperties: false
// };

const ticketObjectSchema = {
    type: "object",
    properties: {
        transactionDate: { type: "string", format: "date-time" },
        bets: {
            type: "object",
            properties: {
                choice: { type: "string" },
                amount: { type: "string" }
            },
            required: ["choice", "amount"],
            additionalProperties: false
        },
        ticketNumber: { type: "string", pattern: "^SBT-\\d{10}$" },
        siteName: { type: "string" },
        sessionId: { type: "string", format: 'uuid' }
    },
    required: [
        "transactionDate",
        "bets",
        "ticketNumber",
        "siteName",
        "sessionId"
    ],
    additionalProperties: false
};

export const createTicketRequestSchema = {
    tags: ["Bet Ticket"],
    body: {
        type: "object",
        properties: {
            gameId: { type: "string", format: "uuid" },
            choice: { type: "string" },
            amount: { type: "string" }
        },
        required: ["gameId", "choice", "amount"],
        additionalProperties: false
    },
    response: {
        201: {
            type: "object",
            properties: {
                ticket: ticketObjectSchema
            },
            required: ["ticket"],
            additionalProperties: false
        }
    }
};

export const getTicketSchema = {
    tags: ["Bet Ticket"],
    params: {
        type: "object",
        properties: {
            ticketNumber: { type: "string", pattern: "^SBT-\\d{10}$" }
        },
        required: ["ticketNumber"],
        additionalProperties: false
    },
    response: {
        200: {
            type: "object",
            properties: {
                ticket: ticketObjectSchema
            },
            required: ["ticket"],
            additionalProperties: false
        }
    }
};

export const getAllTicketsSchema = {
    tags: ["Bet Ticket"],
    queryString: {
        type: "object",
        properties: {
            properties: {
                sessionId: { type: "string", format: "uuid" }
            }
        },
        additionalProperties: false
    },
    response: {
        200: {
            type: "object",
            properties: {
                tickets: { type: "array", items: ticketObjectSchema }
            },
            required: ["tickets"],
            additionalProperties: false
        }
    }
};

async function findGame(db: any, gameId: string) {
    const [game] = await db.select().from(GamesTable).where(eq(GamesTable.id, gameId));
    console.log("findGame():", { gameId, game }); // debug log
    return game;
}

async function findTransactionBySession(db: any, sessionId: string) {
    const [result] = await db
        .select({
            bets: BetsTable,
            transaction: TransactionsTable
        })
        .from(BetsTable)
        .innerJoin(TransactionsTable, eq(BetsTable.transactionId, TransactionsTable.id))
        .where(eq(BetsTable.sessionId, sessionId));

    return result;
}

function buildTicketResponse(ticket: any, game: any) {
    return {
        transactionDate: ticket.createdAt,
        bets: {
            choice: ticket.choice,
            amount: ticket.amount
        },
        ticketNumber: ticket.ticketNumber,
        siteName: game.name ?? gamingSiteTempName,
        sessionId: ticket.sessionId
    };
  }

const TicketRoutesPlugin: FastifyPluginAsync = async (server: FastifyInstance) => {
    server.post("/ticket", { schema: createTicketRequestSchema }, createTicket);
    server.get("/ticket/:ticketNumber", { schema: getTicketSchema }, getTicket);
    server.get("/all-tickets", { schema: getAllTicketsSchema }, getAllTickets);
};

async function createTicket(
    request: FastifyRequest<{ Body: TicketRequestPayloads }>,
    reply: FastifyReply
) {
    try {
        const { gameId, choice, amount } = request.body;

        const game = await findGame(request.db, gameId);
        if (!game) {
            return reply.code(404).send({ error: "Game not found for this gameId" });
        }

        // const transaction = await findTransactionBySession(request.db, sessionId);
        // if (!transaction) {
        //     return reply.code(404).send({ error: "Bet not found for this sessionId" });
        // }

        // Create a session first (if you need a new one)
        const [session] = await request.db
        .insert(GameSessionsTable)
        .values({ gameId }) // or whatever fields are required
        .returning({ id: GameSessionsTable.id });

        const [newTicket] = await request.db
            .insert(BetTickets)
            .values({ gameId, choice, amount, sessionId: session.id })
            .returning();

        return reply.code(201).send({
            ticket: buildTicketResponse(newTicket, game)
        });
    } catch (err) {
        request.log.error(err);
        return reply.code(500).send({ error: "Internal server error" });
    }
}

async function getTicket(
    request: FastifyRequest<{ Params: { ticketNumber: string } }>,
    reply: FastifyReply
) {
    try {
        const { ticketNumber } = request.params;

        const [ticket] = await request.db
            .select()
            .from(BetTickets)
            .where(eq(BetTickets.ticketNumber, ticketNumber));

        if (!ticket) {
            return reply.code(404).send({ error: "Ticket not found." });
        }

        // const transaction = await findTransactionByGameId(request.db, ticket.gameId);
        // if (!transaction) {
        //     return reply.code(404).send({ error: "Bet not found for this sessionId" });
        // }

        const game = await findGame(request.db, ticket.gameId);
        if (!game) {
        return reply.code(404).send({ error: "Game not found for this ticket" });
        }

        return reply.code(200).send({
            ticket: buildTicketResponse(ticket, game)
        });
    } catch (err) {
        request.log.error(err);
        return reply.code(500).send({ error: "Internal server error" });
    }
}

async function getAllTickets(
    request: FastifyRequest<{ Querystring: { sessionId?: string } }>,
    reply: FastifyReply
) {
    try {
        const { sessionId } = request.query;

        const baseQuery = request.db.select().from(BetTickets);
        const tickets = sessionId
            ? await baseQuery.where(eq(BetTickets.sessionId, sessionId))
            : await baseQuery;

        if (!tickets || tickets.length === 0) {
            return reply.code(404).send({ error: "Tickets not found." });
        }

        const ticketsWithGame = await Promise.all(
            tickets.map(async (ticket) => {
            const game = await findGame(request.db, ticket.gameId);

            if (!game) {
                // You can choose to either skip or throw an error
                throw new Error(`Game not found for ticket ${ticket.id}`);
            }

            return buildTicketResponse(ticket, game);
            })
        );

        return reply.code(200).send({
            tickets: ticketsWithGame,
        });
    } catch (err) {
        request.log.error(err);
        return reply.code(500).send({ error: "Internal server error" });
    }
}

export default TicketRoutesPlugin;
