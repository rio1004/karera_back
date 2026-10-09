import { FastifyInstance, FastifyReply, FastifyRequest, FastifyPluginAsync } from 'fastify';
import { UsersTable, CreditsTable, WalletTable, TransactionsTable, UserSessionTable } from "../db/schema.ts";
import { eq, and, or, gte, lte, asc, desc, sql } from 'drizzle-orm';
import { globalAuthentication } from '../app.ts';

// =================
// ROUTES PLUGIN
// =================
const CreditRoutesPlugin: FastifyPluginAsync = async (server: FastifyInstance, opts) => {
  globalAuthentication(server);

  server.post(
    '/credits',
    { preHandler: server.authenticate, schema: sendCreditSchema },
    sendCredit
  );

  server.get(
    '/credits/history',
    { preHandler: server.authenticate, schema: getCreditHistorySchema },
    getCreditHistory
  );
};

// =================
// SCHEMAS
// =================
const errorResponse = {
  type: 'object',
  properties: { error: { type: 'string' } }
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

export const sendCreditSchema = {
  description: 'Transfer credit to an operator or representative from commission or load wallet only',
  tags: ['credits'],
  body: {
    type: 'object',
    required: ['mobile', 'wallet', 'transferTo', 'amount'],
    properties: {
      mobile: { 
        type: 'string', 
        description: 'Mobile number of the recipient' 
      },
      amount: { 
        type: 'number', 
        description: 'Amount of credit to transfer' 
      },
      wallet: { 
        type: 'string', 
        enum: ['commission', 'load'],
        description: 'Type of wallet to deduct the credit from (must be commission or load)' 
      },
      transferTo: { 
        type: 'string', 
        enum: ['game', 'commission', 'load'],
        description: 'Wallet type that will receive the credit (must be game, commission, or load)' 
      },
    }
  },
  response: {
    201: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'ID of the credit transfer record' },
        mobile: { type: 'string', description: 'Mobile number of the recipient' },
        transactionId: { type: 'integer', description: 'Associated transaction ID' },
        status: { type: 'string', description: 'Status of the transfer' },
        balance: { type: 'string', description: 'Updated balance of the recipient wallet' },
      },
      required: [
        'id',
        'mobile',
        'transactionId',
        'status',
        'balance',
      ]
    },
    400: validationErrorResponse,
    409: errorResponse,
    500: errorResponse
  }
}

export const getCreditHistorySchema = {
  description: "Get credit history with pagination, sorting, and filtering",
  tags: ["credits"],
  querystring: {
    type: "object",
    properties: {
      sortBy: { type: "string", enum: ["date", "amount"], default: "date" },
      order: { type: "string", enum: ["asc", "desc"], default: "desc" },
      type: { type: "string", enum: ["load", "credit"], description: "Filter by transaction type (default: both)" },
      from: { type: "string", format: "date" },
      to: { type: "string", format: "date" },
      minAmount: { type: "number" },
      maxAmount: { type: "number" },
      page: { type: "number", minimum: 1, default: 1 },
      limit: { type: "number", minimum: 1, maximum: 100, default: 10 },
    },
    additionalProperties: false,
  },  
  response: {
    200: {
      type: "object",
      properties: {
        data: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "number" },
              transactionId: { type: "number" },
              amount: { type: "number" },
              status: { type: "string" },
              createdAt: { type: "string", format: "date-time" },
              direction: { type: "string", enum: ["sent", "received"] },
            },
            required: ["id", "transactionId", "amount", "status", "createdAt", "direction"],
          },
        },
        page: { type: "number" },
        total: { type: "number" },
        totalPages: { type: "number" },
      },
      required: ["data", "page", "total", "totalPages"],
    },
    500: {
      type: "object",
      properties: { error: { type: "string" } },
      required: ["error"],
    },
  },
};

// =================
// HANDLER
// =================
async function sendCredit(request: FastifyRequest, reply: FastifyReply) {
  const { mobile, amount, wallet: walletType } = request.body as { 
    mobile: string; 
    amount: number; 
    wallet: string;
  };
  
  const loggeduser: any = request.user;
  const parsedAmount = amount;
  const userId = loggeduser?.id ?? null;
  const userType = loggeduser?.type ?? null;

  try {
    if (!["operator", "representative", "rep1", "rep2"].includes(userType)) {
      return reply.code(403).send({ error: "Only operators or representatives are allowed to send credits" });
    }

    const receiverExists = await request.db.query.UsersTable.findFirst({
      where: eq(UsersTable.mobile, mobile)
    });
    if (!receiverExists) {
      return reply.code(400).send({ error: "Recipient not found" });
    }

    if (!["commission", "load"].includes(walletType)) {
      return reply.code(400).send({ error: "Credits can only be sent from commission or load wallets" });
    }

    const wallet = await request.db.query.WalletTable.findFirst({
      where: and(
        eq(WalletTable.userId, userId),
        eq(WalletTable.type, walletType)
      )
    });

    if (!wallet) {
      return reply.code(400).send({ error: `No ${walletType} wallet found for this user` });
    }

    const parsedBalance = parseFloat(wallet.balance);
    const parsedHoldBalance = parseFloat(wallet.onHoldBalance);
    const newBalance = (parsedBalance - parsedHoldBalance) - parsedAmount;

    if (newBalance <= 0) {
      return reply.code(400).send({ error: "Insufficient Balance" });
    }

    const creditsWithTransaction = await request.db.transaction(async (tx) => {
      const [newWallet] = await tx.update(WalletTable).set({
        balance: (newBalance).toFixed(4),
        updatedAt: new Date(),
      }).where(eq(WalletTable.id, wallet.id)).returning();

      const [transaction] = await tx.insert(TransactionsTable).values({
        userId,
        amount: parsedAmount.toFixed(4),
        type: 'credit',
        status: 'completed'
      }).returning();

      const [credit] = await tx.insert(CreditsTable).values({
        mobile,
        transactionId: transaction.id,
        amount: parsedAmount.toFixed(4),
        status: "completed"
      }).returning();

      const updatedBalance = (parseFloat(wallet.balance) - parseFloat(wallet.onHoldBalance) - parsedAmount).toFixed(4);

      return { ...credit, balance: updatedBalance };
    });

    return reply.code(201).send(creditsWithTransaction);
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ error: 'Failed to send credit' });
  }
}

async function getCreditHistory(request: FastifyRequest, reply: FastifyReply) {
  const loggeduser: any = request.user;
  const mobile = loggeduser?.mobile ?? null;
  const userId = loggeduser?.id ?? null;
  const userType = loggeduser?.type ?? null;

  if (!mobile) return reply.code(401).send({ error: "Unauthorized" });

  if (!["operator", "representative", "rep1", "rep2"].includes(userType)) {
    return reply.code(403).send({ error: "Only operators or representatives are allowed to view this request" });
  }

  const {
    sortBy = "date",
    order = "desc",
    type,
    from,
    to,
    minAmount,
    maxAmount,
    page = 1,
    limit = 10,
  } = request.query as any;

  try {
    const orderFn = order === "asc" ? asc : desc;

    let sortColumn;
    switch (sortBy) {
      case "date":
        sortColumn = CreditsTable.createdAt;
        break;
      case "amount":
        sortColumn = TransactionsTable.amount;
        break;
      default:
        sortColumn = CreditsTable.createdAt;
    }

    const offset = (page - 1) * limit;

    let query = request.db
      .select({
        id: CreditsTable.id,
        transactionId: CreditsTable.transactionId,
        amount: TransactionsTable.amount,
        status: CreditsTable.status,
        createdAt: CreditsTable.createdAt,
        senderId: TransactionsTable.userId,
      })
      .from(CreditsTable)
      .leftJoin(TransactionsTable, eq(TransactionsTable.id, CreditsTable.transactionId))
      .leftJoin(UsersTable, eq(UsersTable.mobile, CreditsTable.mobile))
      .where(
        or(
          eq(CreditsTable.mobile, mobile),
          eq(TransactionsTable.userId, userId)
        )
      )
      .where(
        type
          ? eq(TransactionsTable.type, type)
          : eq(TransactionsTable.type, "credit")
      );

    if (from) query = query.where(gte(CreditsTable.createdAt, new Date(from)));
    if (to) query = query.where(lte(CreditsTable.createdAt, new Date(to)));
    if (minAmount !== undefined) query = query.where(gte(TransactionsTable.amount, minAmount));
    if (maxAmount !== undefined) query = query.where(lte(TransactionsTable.amount, maxAmount));

    const totalResult = await request.db
      .select({ count: sql<number>`count(*)` })
      .from(CreditsTable)
      .leftJoin(TransactionsTable, eq(TransactionsTable.id, CreditsTable.transactionId))
      .where(
        or(
          eq(CreditsTable.mobile, mobile),
          eq(TransactionsTable.userId, userId)
        )
      )
      .where(eq(TransactionsTable.type, "credit"));

    const total = totalResult[0]?.count ?? 0;

    const rawCredits = await query
      .orderBy(orderFn(sortColumn))
      .offset(offset)
      .limit(limit);

    const credits = rawCredits.map(c => ({
      id: c.id,
      transactionId: c.transactionId,
      amount: c.amount,
      status: c.status,
      createdAt: c.createdAt,
      direction: c.senderId === userId ? "sent" : "received",
    }));

    return reply.code(200).send({
      data: credits,
      page,
      total: Number(total),
      totalPages: Math.ceil(Number(total) / limit),
    });
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ error: "Failed to fetch credit history" });
  }
}

export default CreditRoutesPlugin;
