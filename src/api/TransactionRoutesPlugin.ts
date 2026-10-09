import {FastifyInstance, FastifyReply, FastifyRequest} from 'fastify';
import {FastifyPluginAsync} from 'fastify';
import {
  BetsTable,
  depositsTable,
  GameSessionsTable,
  GamesTable, OperatorCommissionsTable,
  SitesTable,
  TransactionsTable,
  TransactionTypeEnum,
  WalletTable,
  withdrawsTable,
  GiftsTable,
  PromosTable, UsersTable, ProfilesTable, RoomsTable,
  UserSessionTable,
} from '../db/schema.ts';
import {and, or, ilike, gte, lte, desc, sql, eq, ne, isNull, inArray, isNotNull} from "drizzle-orm"
import {alias} from "drizzle-orm/pg-core";


import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema.ts';
import { globalAuthentication } from '../app.ts';

const TransactionRoutesPlugin: FastifyPluginAsync = async (server: FastifyInstance) => {
  globalAuthentication(server);

  server.post('/deposit', { preHandler: server.authenticate, schema: createDepositSchema}, createDepositEndpoint);
  server.post('/withdraw', { preHandler: server.authenticate, schema: createWithdrawSchema}, createWithdrawEndpoint);
  server.get('/transactions', {preHandler: server.authenticate, schema: getAllTransactionsSchema}, getAllTransaction);
  server.get('/transactions/report', { schema: getTransactionsReportSchema}, getTransactionsReport);
  server.get('/transactions/:id', { preHandler: server.authenticate, schema: getTransactionSchema}, getTransactionById);
  server.patch('/transactions/:id', { preHandler: server.authenticate, schema: updateTransactionSchema}, updateTransaction);
  server.delete('/transactions/:id', { preHandler: server.authenticate, schema: deleteTransactionSchema}, deleteTransaction);

  // for player's transactions
  server.get('/transactions/player', { preHandler: server.authenticate, schema: getPlayerTransactionsSchema}, getPlayerTransactions);
};

//TODO: use db trx in update transaction current balance check to prevent race condition
declare module 'fastify' {
  interface FastifyRequest {
    db: NodePgDatabase<typeof schema>;
  }
}

type InsertTransaction = typeof TransactionsTable.$inferInsert;
type UpdateTransaction = Partial<Omit<InsertTransaction, 'id' | 'type' | 'amount' | 'createdAt'>>;
type TransactionType = typeof TransactionTypeEnum.enumValues[number];

export enum TransactionStatus {
  IN_PROGRESS = 'in progress',
  COMPLETED = 'completed',
  VOID = 'void'
}

export const transactionProperties = {
  id: {type: 'string'},
  userId: {type: 'string', format: 'uuid'},
  receiverId: {type: 'string', format: 'uuid'},
  type: {type: 'string'},
  amount: {type: 'string'},
  status: {type: 'string'},
  createdAt: {type: 'string', format: 'date-time'},
  updatedAt: {type: 'string', format: 'date-time'},
  deletedAt: {type: 'string', format: 'date-time'}
};

const errorResponse = {
  type: 'object',
  properties: {error: {type: 'string'}, message: {type: 'string'}}
};

const validationErrorResponse = {
  type: 'object',
  properties: {
    error: {type: 'string'},
    message: {type: 'string'},
    validation: {
      type: 'array',
      items: {type: 'object'}
    }
  }
};

export const transactionHandlers = {
  // ==========================
  // Withdraws
  // ==========================
  withdraws: {
    table: withdrawsTable,
    walletOnCompleted: async (trx, wallet, amount: number) => {
      const now = new Date();
      const currentBalance = Number(wallet.balance);

      // Withdraw completed → decrease balance
      const newBalance = currentBalance - amount;

      await trx.update(WalletTable)
        .set({
          balance: newBalance.toFixed(4),
          updatedAt: now,
        })
        .where(eq(WalletTable.id, wallet.id));
    },
    walletOnFailed: async (trx, wallet, amount: number) => {
      const now = new Date();
      const currentBalance = Number(wallet.balance);

      // Failed withdraw → rollback funds
      const newBalance = currentBalance + amount;

      await trx.update(WalletTable)
        .set({
          balance: newBalance.toFixed(4),
          updatedAt: now,
        })
        .where(eq(WalletTable.id, wallet.id));
    },
  },

  // ==========================
  // Deposits
  // ==========================
  deposits: {
    table: depositsTable,
    walletOnCompleted: async (trx, wallet, amount: number) => {
      const now = new Date();
      const currentBalance = Number(wallet.balance);

      // Deposit completed → increase balance
      const newBalance = currentBalance + amount;

      await trx.update(WalletTable)
        .set({
          balance: newBalance.toFixed(4),
          updatedAt: now,
        })
        .where(eq(WalletTable.id, wallet.id));
    },
    walletOnFailed: async () => {
      // Failed deposit → do nothing
    },
  },

  // ==========================
  // Bets
  // ==========================
  bets: {
    table: BetsTable,
    walletOnCompleted: async (trx, wallet, amount: number) => {
      const now = new Date();
      const currentOnHold = Number(wallet.onHoldBalance || 0);

      // Bet resolved → remove from onHold
      const newOnHold = currentOnHold - amount;

      await trx.update(WalletTable)
        .set({
          onHoldBalance: newOnHold.toFixed(4),
          updatedAt: now,
        })
        .where(eq(WalletTable.id, wallet.id));
    },
    walletOnFailed: async (trx, wallet, amount: number) => {
      const now = new Date();
      const currentBalance = Number(wallet.balance);
      const currentOnHold = Number(wallet.onHoldBalance || 0);

      // Failed bet → return amount to balance, remove from onHold
      const newBalance = currentBalance + amount;
      const newOnHold = currentOnHold - amount;

      await trx.update(WalletTable)
        .set({
          balance: newBalance.toFixed(4),
          onHoldBalance: newOnHold.toFixed(4),
          updatedAt: now,
        })
        .where(eq(WalletTable.id, wallet.id));
    },
  },

  // ==========================
  // Gifts
  // ==========================
  gifts: {
    table: GiftsTable,
    walletOnCompleted: async (trx, wallet, amount: number) => {
      const now = new Date();
      const currentBalance = Number(wallet.balance);

      // Gift received → increase balance
      const newBalance = currentBalance + amount;

      await trx.update(WalletTable)
        .set({
          balance: newBalance.toFixed(4),
          updatedAt: now,
        })
        .where(eq(WalletTable.id, wallet.id));
    },
    walletOnFailed: async () => {
      // Failed gift → do nothing
    },
  },

  // ==========================
  // Promos
  // ==========================
  promos: {
    table: PromosTable,
    walletOnCompleted: async (trx, wallet, amount: number) => {
      const now = new Date();
      const currentBalance = Number(wallet.balance);

      // Promo awarded → increase balance
      const newBalance = currentBalance + amount;

      await trx.update(WalletTable)
        .set({
          balance: newBalance.toFixed(4),
          updatedAt: now,
        })
        .where(eq(WalletTable.id, wallet.id));
    },
    walletOnFailed: async () => {
      // Failed promo → do nothing
    },
  },
} as const;

interface TransactionRequestBody {
  receiverId: string;
  receiverType: 'mobile' | 'id';
  amount: string;
  type: TransactionType;
  status?: TransactionStatus;
}

interface DepositRequestBody {
  amount: string;
}

interface WithdrawRequestBody {
  amount: string;
}

const createTransactionSchema = {
  description: 'New Transaction (for bets only).',
  tags: ['transactions'],
  body: {
    type: 'object',
    required: ['receiverId', 'receiverType', 'type', 'amount'],
    properties: {
      receiverId: {type: 'string'},
      receiverType: {type: 'string', enum: ['mobile', 'id']},
      type: {type: 'string', enum: ['bet', 'win', 'wonPrize', 'gift', 'cashOut']},
      amount: {type: 'string'},
    }
  },
  response: {
    201: {
      type: 'object',
      properties: {
        transaction: {
          type: 'object',
          properties: transactionProperties
        }
      }
    },
    400: validationErrorResponse,
    409: errorResponse,
    500: errorResponse
  }
};

const createDepositSchema = {
  description: 'Create a new deposit.',
  tags: ['Transactions'],
  body: {
    type: 'object',
    required: ['amount'],
    properties: {
      amount: {type: 'string'},
    }
  },
  response: {
    201: {
      type: 'object',
      properties: {
        transaction: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            userId: { type: 'integer' },
            type: { type: 'string' },
            status: { type: 'string' },
            amount: { type: ['string', 'null'] },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            deletedAt: { type: ['string', 'null'], format: 'date-time' },
          }
        },
        deposit: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            transactionId: { type: 'integer' },
            status: { type: 'string' },
            meta: { type: 'object',
              properties: {
                previousBalance: { type: 'number' },
                updatedBalance: { type: 'number' },
              }
            },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            deletedAt: { type: ['string', 'null'], format: 'date-time' },
          }
        }
      }
    },
    400: validationErrorResponse,
    500: errorResponse
  }
};

const createWithdrawSchema = {
  description: 'Create a new withdrawal.',
  tags: ['Transactions'],
  body: {
    type: 'object',
    required: ['amount'],
    properties: {
      amount: {type: 'string'},
    }
  },
  response: {
    201: {
      type: 'object',
      properties: {
        transaction: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            userId: { type: 'integer' },
            type: { type: 'string' },
            status: { type: 'string' },
            amount: { type: ['string', 'null'] },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            deletedAt: { type: ['string', 'null'], format: 'date-time' },
          }
        },
        withdraw: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            transactionId: { type: 'integer' },
            status: { type: 'string' },
            meta: { type: 'object',
              properties: {
                previousBalance: { type: 'number' },
                updatedBalance: { type: 'number' },
              }
            },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            deletedAt: { type: ['string', 'null'], format: 'date-time' },
          }
        }
      }
    },
    400: validationErrorResponse,
    500: errorResponse
  }
};

// const getAllTransactionsSchema = {
//   description: 'Get all transactions with pagination support.',
//   tags: ['transaction'],
//   querystring: {
//     type: 'object',
//     properties: {
//       type: {type: 'string', default: 'all'},
//       status: {type: 'string'},
//       limit: {type: 'integer', minimum: 1, default: 10},
//       offset: {type: 'integer', minimum: 0, default: 0}
//     }
//   },
//   response: {
//     200: {
//       type: 'object',
//       properties: {
//         transactions: {
//           type: 'array',
//           items: {
//             type: 'object',
//             properties: transactionProperties
//           }
//         },
//         limit: {type: 'integer'},
//         offset: {type: 'integer'},
//         total: {type: 'integer'}
//       }
//     },
//     400: validationErrorResponse,
//     500: errorResponse
//   }
// };

const getTransactionSchema = {
  description: 'Get a single transaction by ID.',
  tags: ['Transactions'],
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: {type: 'integer'}
    }
  },
  response: {
    200: {
      type: 'object',
      required: ['transaction'],
      properties: {
        transaction: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            userId: { type: 'integer' },
            type: { type: 'string' },
            status: { type: 'string' },
            amount: { type: ['string', 'null'] },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            deletedAt: { type: ['string', 'null'], format: 'date-time' },
          }
        },
        deposit: { type: ['object', 'null'], additionalProperties: true },
        withdraw: { type: ['object', 'null'], additionalProperties: true },
        bet: { type: ['object', 'null'], additionalProperties: true },
        game: {
          type: ['object', 'null'],
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            choices: { type: 'array', items: { type: 'string' } },
            commission: { type: ['string', 'null'] },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            deletedAt: { type: ['string', 'null'], format: 'date-time' },
          },
          additionalProperties: true,
        },
        gameSession: {
          type: ['object', 'null'],
          properties: {
            id: { type: 'integer' },
            gameId: { type: 'integer' },
            round: { type: ['string', 'null'] },
            createdAt: { type: 'string', format: 'date-time' },
            deletedAt: { type: ['string', 'null'], format: 'date-time' },
          },
          additionalProperties: true,
        },
      }
    },
    404: {
      type: 'object',
      properties: {
        error: {type: 'string'},
        message: {type: 'string'}
      }
    },
    500: errorResponse
  }
};

const updateTransactionSchema = {
  description: 'Update a transaction by ID',
  tags: ['Transactions'],
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: {type: 'integer'}
    }
  },
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: {type: 'string'},
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        transaction: {
          type: 'object',
          properties: transactionProperties
        }
      }
    },
    400: validationErrorResponse,
    404: errorResponse,
    409: errorResponse,
    500: errorResponse
  }
};

const deleteTransactionSchema = {
  description: 'Delete a transaction by ID',
  tags: ['Transactions'],
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: {type: 'integer'}
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        message: {type: 'string'}
      }
    },
    404: errorResponse,
    500: errorResponse
  }
};

export const transactionSchema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    gameName: { type: ['string', 'null'] },
    gamingSite: { type: ['string', 'null'] },
    dateOnly: { type: 'string', format: 'date' },
    gameRound: { type: ['string', 'null'] },
    status: { type: 'string' },
    type: { type: 'string' },
    operator: { type: 'string' },
    playerName: { type: 'string' },
    amount: { type: 'string' },
    choice: { type: ['string', 'null'] },
    odds: { type: ['string', 'null'] },
    serviceFee: { type: ['string', 'null'] },
    winAmount: { type: ['string', 'null'] },
    operatorType: { type: ['string', 'null'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    deletedAt: { type: ['string', 'null'], format: 'date-time' }
  },
  required: [
    'id',
    'gameName',
    'gamingSite',
    'dateOnly',
    'gameRound',
    'status',
    'type',
    'operator',
    'amount',
    'choice',
    'odds',
    'serviceFee',
    'winAmount',
    'operatorType',
    'createdAt',
    'updatedAt',
    'deletedAt'
  ]
};

export const getAllTransactionsSchema = {
  description: 'Get transactions with pagination and category filter',
  tags: ['Transactions'],
  querystring: {
    type: 'object',
    properties: {
      limit: { type: 'integer', minimum: 1, default: 100 },
      offset: { type: 'integer', minimum: 0, default: 0 },
      category: {
        type: 'string',
        enum: ['all', 'deposit', 'withdraw', 'game'],
        default: 'all',
        description: 'Filter by category of record'
      },
      startDate: {
        type: 'string',
        pattern: '^[0-9]{8}$',
        description: 'Filter records created on or after this date (YYYYMMDD)'
      },
      endDate: {
        type: 'string',
        pattern: '^[0-9]{8}$',
        description: 'Filter records created on or before this date (YYYYMMDD)'
      }
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        transactions: {
          type: 'array',
          items: transactionSchema
        },
        totalRows: { type: 'integer' },
        limit: { type: 'integer' },
        offset: { type: 'integer' }
      }
    }
  }
};

const getTransactionsReportSchema = {
  description: 'Transactions report with bet, win, GGR and fee shares',
  tags: ['Transactions'],
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      period: { type: 'string', enum: ['day', 'week', '7', 'month'] },
      startDate: {
        type: 'string',
        pattern: '^[0-9]{8}$',
        description: 'Report start date (YYYYMMDD)'
      },
      endDate: {
        type: 'string',
        pattern: '^[0-9]{8}$',
        description: 'Report end date (YYYYMMDD)'
      }
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              date: { type: 'string' },
              betAmount: { type: 'number' },
              winAmount: { type: 'number' },
              ggr: { type: 'number' },
              month: { type: 'string' },
              week: { type: 'string' },
              pagcorShare: { type: 'number' },
              auditFee: { type: 'number' }
            }
          }
        },
        totals: {
          type: 'object',
          properties: {
            betAmount: { type: 'number' },
            winAmount: { type: 'number' },
            ggr: { type: 'number' },
            pagcorShare: { type: 'number' },
            auditFee: { type: 'number' }
          }
        },
        period: { type: 'string' },
        startDate: { type: 'string' },
        endDate: { type: 'string' }
      }
    }
  }
};

export const getPlayerTransactionsSchema = {
  description: "Get authenticated player's transactions with filters",
  tags: ["Transactions"],
  querystring: {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, default: 50 },
      type: {
        type: "string",
        enum: ["deposit", "withdraw", "game", "all"],
        default: "all",
      },
      startDate: { type: "string", format: "date" },
      endDate: { type: "string", format: "date" },
    },
  },
  response: {
    200: {
      type: "object",
      properties: {
        userId: { type: "string", format: "uuid" },
        type: { type: "string" },
        range: {
          type: "object",
          properties: {
            startDate: { type: "string", format: "date", nullable: true },
            endDate: { type: "string", format: "date", nullable: true },
          },
        },
        totalAmount: { type: "number" },
        count: { type: "integer" },
        transactions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", format: "uuid" },
              userId: { type: "string", format: "uuid" },
              receiverId: { type: "string", format: "uuid", nullable: true },
              gameId: { type: "string", format: "uuid", nullable: true },
              type: { type: "string" },
              amount: { type: "number" },
              status: { type: "string" },
              result: { type: "string", nullable: true, enum: ["win", "lose"] },
              updatedAt: { type: "string", format: "date-time" }, // keep this as datetime since DB has timestamp
            },
          },
        },
      },
    },
  },
};

export async function createTransaction(db: NodePgDatabase<typeof schema>, originId: string, destinationId: string, type: TransactionType, amount: string, status: TransactionStatus = TransactionStatus.IN_PROGRESS) {
  if (!originId || !destinationId || !type || !amount) {
    throw new Error('Missing required parameters');
  }

  const currentAmount = Number(amount);
  if (isNaN(currentAmount) || currentAmount <= 0) {
    throw new Error('Invalid amount: must be a positive number');
  }

  const transaction = await db.transaction(async (trx) => {
    const [wallet] = await trx.select()
      .from(WalletTable)
      .where(eq(WalletTable.userId, Number(originId)))
      .limit(1)
      .for('update');

    if (!wallet) {
      throw new Error('Wallet not found');
    }

    let currentBalance = Number(wallet.balance);

    //Check sufficient balance for non-deposit transactions
    if ((currentBalance - currentAmount) < 0) {
      throw new Error('Insufficient Balance');
    }

    // Create transaction in pending state
    // @ts-ignore ts(2488)
    const [tx] = await trx.insert(TransactionsTable)
      .values({
        userId: Number(originId),
        receiverId: destinationId,
        amount: currentAmount.toString(),
        type,
        status: status ?? TransactionStatus.IN_PROGRESS // Create as pending instead of completed
      }).returning(); 


    let newBalance = currentBalance - currentAmount;

    await trx.update(WalletTable)
      .set({
        balance: newBalance.toString(),
        updatedAt: new Date()
      })
      .where(eq(WalletTable.id, wallet.id));


    return tx;
  });

  return transaction;

  // return await completeTransaction(db, transaction.id, TransactionStatus.COMPLETED) // temporarily completes transaction right away. remove in the future.
}

export async function createDeposit(
  db: NodePgDatabase<typeof schema>, 
  userId: string, 
  amount: string
) {
  console.log('createDeposit', userId, amount);

  if (!userId || !amount) {
    throw new Error('Missing required parameters');
  }

  const currentAmount = Number(amount);
  if (isNaN(currentAmount) || currentAmount <= 0) {
    throw new Error('Invalid amount: must be a positive number');
  }

  return await db.transaction(async (trx) => {
    // Lock and read wallet to compute balances
    const [wallet] = await trx
      .select()
      .from(WalletTable)
      .where(and(eq(WalletTable.userId, Number(userId)), eq(WalletTable.type, 'game')))
      .limit(1)
      .for('update');

    if (!wallet) {
      throw new Error('Wallet not found');
    }

    const previousBalance = Number(wallet.balance || 0);
    const updatedBalance = previousBalance + currentAmount;

    // 1️⃣ Create transaction first
    const [transaction] = await trx
      .insert(TransactionsTable)
      .values({
        userId: Number(userId),
        amount: currentAmount.toFixed(4),
        type: 'deposit',
      })
      .returning();

    // 2️⃣ Insert deposit record linked to transaction with metadata
    const [deposit] = await trx
      .insert(depositsTable)
      .values({
        transactionId: transaction.id,
        status: TransactionStatus.IN_PROGRESS,
        meta: {
          previousBalance: Number(previousBalance.toFixed(4)),
          updatedBalance: Number(updatedBalance.toFixed(4)),
        },
      })
      .returning();

    // 3️⃣ Complete transaction using centralized handler
    await completeUserTransaction(
      trx,
      'deposits',         // type: points to transactionHandlers
      deposit.id,         // sub-table record id
      Number(userId),     // userId as number
      currentAmount,
      TransactionStatus.COMPLETED,
      transaction.id
    );

    return transaction;
  });
}


export async function createWithdraw(db: NodePgDatabase<typeof schema>, userId: string, amount: string) {
  if (!userId || !amount) {
    throw new Error('Missing required parameters');
  }

  const currentAmount = Number(amount);
  if (isNaN(currentAmount) || currentAmount <= 0) {
    throw new Error('Invalid amount: must be a positive number');
  }

  return await db.transaction(async (trx) => {
    // 1️⃣ Create transaction first
    const [transaction] = await trx
      .insert(TransactionsTable)
      .values({
        userId: Number(userId),
        amount: currentAmount.toFixed(4),
        type: 'withdraw',
      })
      .returning();

    // 2️⃣ Check wallet balance
    const [wallet] = await trx
      .select()
      .from(WalletTable)
      .where(and(eq(WalletTable.userId, Number(userId)), eq(WalletTable.type, 'game')))
      .limit(1)
      .for('update');

    if (!wallet) throw new Error('Wallet not found');

    const balance = Number(wallet.balance || 0);
    const onHold = Number(wallet.onHoldBalance || 0);
    const availableBalance = balance - onHold;

    if (availableBalance < currentAmount) {
      throw new Error('Insufficient Balance');
    }

    const previousBalance = balance;
    const updatedBalance = previousBalance - currentAmount;

    // 3️⃣ Insert withdraw record linked to transaction with metadata
    const [withdraw] = await trx
      .insert(withdrawsTable)
      .values({
        transactionId: transaction.id,
        status: TransactionStatus.IN_PROGRESS,
        meta: {
          previousBalance: Number(previousBalance.toFixed(4)),
          updatedBalance: Number(updatedBalance.toFixed(4)),
        },
      })
      .returning();

    // 4️⃣ Complete transaction using the centralized handler
    await completeUserTransaction(
      trx,
      'withdraws',
      withdraw.id,
      Number(userId),
      currentAmount,
      TransactionStatus.COMPLETED,
      transaction.id
    );

    return transaction;
  });
}

export async function completeTransaction(db: NodePgDatabase<typeof schema>, transactionId: number, status: TransactionStatus = TransactionStatus.COMPLETED) {
  if (!transactionId) {
    throw new Error('Transaction ID is required');
  }

  if (status !== TransactionStatus.COMPLETED && status !== TransactionStatus.VOID) {
    throw new Error('Invalid status: must be completed or failed');
  }

  return await db.transaction(async (trx) => {
    const [transaction] = await trx.select()
      .from(TransactionsTable)
      .where(eq(TransactionsTable.id, transactionId))
      .limit(1)
      .for('update');

    if (!transaction) {
      throw new Error('Transaction not found');
    }

    if (transaction.status !== TransactionStatus.IN_PROGRESS) {
      throw new Error('Invalid Transaction Status');
    }

    // Remove non-existent receiverId usage
    // const destinationUserId = transaction.receiverId;
    const amount = Number(transaction.amount);
    const type = transaction.type as TransactionType;

    const [updatedTransaction] = await trx.update(TransactionsTable)
      .set({
        status: status,
        updatedAt: new Date()
      })
      .where(eq(TransactionsTable.id, transactionId))
      .returning();

    if (status === TransactionStatus.COMPLETED) {
      // If it's a gift, credit receiver from GiftsTable
      if (type === 'gift') {
        const [gift] = await trx
          .select()
          .from(GiftsTable)
          .where(eq(GiftsTable.transactionId, transactionId))
          .limit(1);

        if (gift?.receiverId) {
          const [destinationWallet] = await trx
            .select()
            .from(WalletTable)
            .where(eq(WalletTable.userId, gift.receiverId))
            .limit(1)
            .for('update');

          if (!destinationWallet) {
            throw new Error('Destination wallet not found');
          }

          const currentBalance = Number(destinationWallet.balance);
          const newBalance = currentBalance + amount;

          await trx.update(WalletTable)
            .set({
              balance: newBalance.toFixed(4),
              updatedAt: new Date()
            })
            .where(eq(WalletTable.id, destinationWallet.id));
        }
      }
    } else if (status === TransactionStatus.VOID) {
      const [originWallet] = await trx.select()
        .from(WalletTable)
        .where(eq(WalletTable.userId, transaction.userId))
        .limit(1)
        .for('update');

      if (!originWallet) {
        throw new Error('Origin wallet not found');
      }

      const currentBalance = Number(originWallet.balance);
      const newBalance = currentBalance + amount;

      await trx.update(WalletTable)
        .set({
          balance: newBalance.toString(),
          updatedAt: new Date()
        })
        .where(eq(WalletTable.id, originWallet.id));
    }

    return updatedTransaction;
  });
}

async function createDepositEndpoint(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const {amount} = request.body as DepositRequestBody;
  try {
    const loggeduser: any = request.user;

    const userId = loggeduser?.id ?? null;
    if (!userId) return reply.code(400).send({error: 'Unauthorized'});

    const transaction = await createDeposit(request.db, userId, amount);

    // Fetch the deposit sub-record to include in the response
    const [deposit] = await request.db
    .select({
      id: depositsTable.id,
      transactionId: depositsTable.transactionId,
      status: depositsTable.status,
      meta: depositsTable.meta,
      createdAt: depositsTable.createdAt,
      updatedAt: depositsTable.updatedAt,
      deletedAt: depositsTable.deletedAt,
    })
    .from(depositsTable)
    .where(eq(depositsTable.transactionId, transaction.id))
    .limit(1);

  return reply.code(201).send({ transaction, deposit });
  } catch (error: any) {
    return reply.code(500).send({error: error.message});
  }
}

async function createWithdrawEndpoint(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const {amount} = request.body as WithdrawRequestBody;
  try {
    const loggeduser: any = request.user;

    const userId = loggeduser?.id ?? null;
    if (!userId) return reply.code(400).send({error: 'Unauthorized'});

    const transaction = await createWithdraw(request.db, userId, amount);

    const [withdraw] = await request.db
    .select({
      id: withdrawsTable.id,
      transactionId: withdrawsTable.transactionId,
      status: withdrawsTable.status,
      meta: withdrawsTable.meta,
      createdAt: withdrawsTable.createdAt,
      updatedAt: withdrawsTable.updatedAt,
      deletedAt: withdrawsTable.deletedAt,
    })
    .from(withdrawsTable)
    .where(eq(withdrawsTable.transactionId, transaction.id))
    .limit(1);

  return reply.code(201).send({ transaction, withdraw });
  } catch (error: any) {
    return reply.code(500).send({error: error.message});
  }
}

function serializeBigInt(obj: any) {
  return JSON.parse(
    JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v))
  );
}

export async function getAllTransaction(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { limit = 100, offset = 0, category = "all", startDate, endDate } = req.query as any;
    
    const parseYmd = (d: string, end = false) =>
      new Date(
        `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${end ? "23:59:59" : "00:00:00"}Z`
      );
    
    const OperatorTable = alias(UsersTable, "operator");
    const categoryPredicate =
      category === "deposit"
        ? isNotNull(depositsTable.id)
        : category === "withdraw"
          ? isNotNull(withdrawsTable.id)
          : category === "game"
            ? isNotNull(BetsTable.id)
            : undefined;
    
    const datePredicate = and(
      startDate ? gte(TransactionsTable.createdAt, parseYmd(startDate)) : undefined,
      endDate ? lte(TransactionsTable.createdAt, parseYmd(endDate, true)) : undefined
    );
    
    const whereAll = and(categoryPredicate, datePredicate);
    
    const [totalRowsResult, transactions] = await Promise.all([
      req.db
        .select({
          count: sql<number>`count(${TransactionsTable.id})`.as("count"),
        })
        .from(TransactionsTable)
        .leftJoin(BetsTable, eq(BetsTable.transactionId, TransactionsTable.id))
        .leftJoin(depositsTable, eq(depositsTable.transactionId, TransactionsTable.id))
        .leftJoin(withdrawsTable, eq(withdrawsTable.transactionId, TransactionsTable.id))
        .where(whereAll),
      
      req.db
        .select({
          id: TransactionsTable.id,
          gameName: GamesTable.name,
          gamingSite: ProfilesTable.gamingSite,
          dateOnly: sql<string>`DATE(${TransactionsTable.createdAt})`.as("dateOnly"),
          gameRound: GameSessionsTable.round,
          status: TransactionsTable.status,
          type: sql<string>`CASE
            WHEN ${BetsTable.winAmount} IS NOT NULL AND (${BetsTable.winAmount}::numeric) > 0
            THEN 'win'
            ELSE ${TransactionsTable.type}::text
          END`.as("type"),
          operator: sql<string>`CONCAT(${OperatorTable.firstName}, ' ', ${OperatorTable.lastName})`.as(
            "operator"
          ),
          playerName: sql<string>`CONCAT(${UsersTable.firstName}, ' ', ${UsersTable.lastName})`.as(
            "playerName"
          ),
          choice: BetsTable.choice,
          odds: BetsTable.odds,
          serviceFee: BetsTable.fee,
          amount: sql<string>`CASE
            WHEN ${BetsTable.amount} IS NOT NULL AND (${BetsTable.amount}::numeric) > 0
              THEN ${BetsTable.amount}::text
            ELSE ${TransactionsTable.amount}::text
          END`.as("amount"),
          winAmount: BetsTable.winAmount,
          operatorType: OperatorTable.type,
          createdAt: TransactionsTable.createdAt,
          updatedAt: TransactionsTable.updatedAt,
          deletedAt: TransactionsTable.deletedAt,
        })
        .from(TransactionsTable)
        .leftJoin(BetsTable, eq(BetsTable.transactionId, TransactionsTable.id))
        .leftJoin(GameSessionsTable, eq(BetsTable.gameSessionId, GameSessionsTable.id))
        .leftJoin(GamesTable, eq(GameSessionsTable.gameId, GamesTable.id))
        .leftJoin(depositsTable, eq(depositsTable.transactionId, TransactionsTable.id))
        .leftJoin(withdrawsTable, eq(withdrawsTable.transactionId, TransactionsTable.id))
        .leftJoin(UsersTable, eq(UsersTable.id, TransactionsTable.userId)) // Player
        .leftJoin(ProfilesTable, eq(ProfilesTable.userId, UsersTable.id))
        .leftJoin(RoomsTable, eq(GameSessionsTable.roomId, RoomsTable.id))
        .leftJoin(OperatorTable, eq(RoomsTable.moderatorId, OperatorTable.id)) // Operator
        .where(whereAll)
        .orderBy(desc(TransactionsTable.createdAt))
        .limit(+limit)
        .offset(+offset),
    ]);
    
    return reply.code(200).send({
      totalRows: Number(totalRowsResult[0]?.count || 0),
      limit: +limit,
      offset: +offset,
      transactions: serializeBigInt(transactions),
    });
  } catch (error) {
    req.log.error(error, "Failed to get transactions");
    return reply.code(500).send({ error: "Internal server error" });
  }
}

async function getTransactionsReport(req: FastifyRequest, reply: FastifyReply) {
  const PAGCOR_SHARE = Number(process.env.PAGCOR_SHARE) || 0.15;
  const AUDIT_FEE = Number(process.env.AUDIT_FEE) || 0.10;
  try {
    const { period, startDate, endDate } = req.query as any;

    const parseYmd = (d: string, end = false) =>
      new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${end ? '23:59:59' : '00:00:00'}Z`);

    const now = new Date();
    let from: Date;
    let to: Date;
    // Lets have option for period iether period or date range
    // if both are provided, use period
    if (startDate && endDate && !period) {
      // parse the date range 
      from = parseYmd(startDate);
      to = parseYmd(endDate, true);
    } else {
      switch (period) {
        case 'day': {
          from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
          to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59));
          break;
        }
        case '7':
        case 'week': {
          to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59));
          const fromMs = to.getTime() - 6 * 24 * 60 * 60 * 1000;
          from = new Date(fromMs);
          from.setUTCHours(0, 0, 0, 0);
          break;
        }
        case 'month':
        default: {
          from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
          to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));
          break;
        }
      }
    }

    const dateKeySql = sql<string>`DATE(${TransactionsTable.createdAt})`;

    const [betRows, winRows] = await Promise.all([
      req.db
        .select({ day: dateKeySql, total: sql<number>`COALESCE(SUM(${TransactionsTable.amount}), 0)` })
        .from(TransactionsTable)
        .where(and(
          gte(TransactionsTable.createdAt, from),
          lte(TransactionsTable.createdAt, to),
          eq(TransactionsTable.type, 'bet' as any),
        ))
        .groupBy(dateKeySql),

      req.db
        .select({ day: dateKeySql, total: sql<number>`COALESCE(SUM(${TransactionsTable.amount}), 0)` })
        .from(TransactionsTable)
        .where(and(
          gte(TransactionsTable.createdAt, from),
          lte(TransactionsTable.createdAt, to),
          inArray(TransactionsTable.type, ['win'] as any)
        ))
        .groupBy(dateKeySql)
    ]);

    const toDateKey = (d: Date) => d.toISOString().slice(0, 10);
    const enumerateDays = (fromD: Date, toD: Date) => {
      const days: string[] = [];
      const cursor = new Date(Date.UTC(fromD.getUTCFullYear(), fromD.getUTCMonth(), fromD.getUTCDate()));
      const end = new Date(Date.UTC(toD.getUTCFullYear(), toD.getUTCMonth(), toD.getUTCDate()));
      while (cursor <= end) {
        days.push(toDateKey(cursor));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      return days;
    };

    const betMap = new Map<string, number>();
    const winMap = new Map<string, number>();
    for (const r of betRows) betMap.set(r.day as any, Number(r.total || 0));
    for (const r of winRows) winMap.set(r.day as any, Number(r.total || 0));
    
    // Not sure about the 5ft week but lets do it anyway
    const ordinal = (n: number) => {
      if (n === 1) return '1st';
      if (n === 2) return '2nd';
      if (n === 3) return '3rd';
      return `${n}th`;
    };
    const weekBucketOfMonth = (date: Date) => {
      const dom = date.getUTCDate();
      const bucket = Math.floor((dom - 1) / 7) + 1; // 1..5
      return ordinal(bucket);
    };

    // format the date displayed to be MM/DD/YYYY for the table
    const formatDisplayDate = (date: Date) => {
      const mm = (date.getUTCMonth() + 1).toString();
      const dd = date.getUTCDate().toString();
      const yyyy = date.getUTCFullYear().toString();
      return `${mm}/${dd}/${yyyy}`;
    };

    const rows: any[] = [];
    let totalBet = 0;
    let totalWin = 0;
    let totalGgr = 0;
    let totalPagcor = 0;
    let totalAudit = 0;
    // Loop through the days and get the data for each day
    // fix the decimal places to be 2 decimal places
    // Compute the pagcor share and audit fee
    for (const dayKey of enumerateDays(from, to)) {
      const betAmount = Number((betMap.get(dayKey) || 0).toFixed(2));
      const winAmount = Number((winMap.get(dayKey) || 0).toFixed(2));
      const ggr = Number((betAmount - winAmount).toFixed(2));
      const pagcorShare = Number((ggr * PAGCOR_SHARE).toFixed(2));
      // const auditFee = Number((ggr * 0.015).toFixed(2));
      const auditFee = Number(((ggr * PAGCOR_SHARE) * AUDIT_FEE).toFixed(2));

      const d = new Date(`${dayKey}T00:00:00Z`);
      // Format the date to be MM/DD/YYYY so that we can display it in the table
      rows.push({
        date: formatDisplayDate(d),
        betAmount,
        winAmount,
        ggr,
        month: d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }),
        week: weekBucketOfMonth(d),
        pagcorShare,
        auditFee
      });

      totalBet += betAmount;
      totalWin += winAmount;
      totalGgr += ggr;
      totalPagcor += pagcorShare;
      totalAudit += auditFee;
    }

    return reply.code(200).send({
      rows,
      totals: {
        betAmount: Number(totalBet.toFixed(2)),
        winAmount: Number(totalWin.toFixed(2)),
        ggr: Number(totalGgr.toFixed(2)),
        pagcorShare: Number(totalPagcor.toFixed(2)),
        auditFee: Number(totalAudit.toFixed(2))
      },
      // if period is provided empty the start and end date
      // if start and end date are provided empty the period
      period: period? period : '',
      startDate: period ? '' : startDate,
      endDate: period ? '' : endDate, 
    });
  } catch (error) {
    return reply.code(500).send({ error: 'Internal server error', message: error.message });
  }
}

// async function getAllTransaction(request: FastifyRequest, reply: FastifyReply) {
//   try {
//     const loggedUser:any = request.user;
//     const userId = loggedUser.id ?? '';
//     const {limit, offset, type, status} = request.query as any;
//     const limitNum = Number(limit) || 10;
//     const offsetNum = Number(offset) || 0;
//
//     let transactionsquery = request.db.select().from(TransactionsTable).$dynamic()
//     let condition = [or(eq(TransactionsTable.userId, userId), eq(TransactionsTable.receiverId, userId)), isNull(TransactionsTable.deletedAt)];
//     if(type !== 'all'){
//       condition.push(eq(TransactionsTable.type, type))
//       // transactionsquery = transactionsquery.where(and(eq(TransactionsTable.userId, userId), ));
//     }
//     if(status){
//       condition.push(eq(TransactionsTable.status, status))
//     }
//
//     const transactions = await transactionsquery.where(and(...condition)).orderBy(desc(TransactionsTable.createdAt)).limit(limitNum).offset(offsetNum);
//     const filteredTransactions = transactions.filter(t => {
//       if(t.receiverId === userId && t.userId !== userId && t.status !== TransactionStatus.COMPLETED){
//         return false
//       }
//       return true
//     });
//     // get total transactions
//     // .count() does not exist on the query builder, so we need to do a count query manually
//     const totalResult = await request.db
//       .select({ count: sql<number>`count(*)` })
//       .from(TransactionsTable)
//       .where(and(...condition));
//     const totalTransactions = totalResult[0]?.count ?? 0;
//
//     reply.code(200).send({
//       transactions: filteredTransactions,
//       limit: limitNum,
//       offset: offsetNum,
//       total: totalTransactions
//     });
//   } catch (error) {
//     reply.code(500).send({error: 'Internal server error'});
//   }
// }

async function getTransactionById(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: number };
  try {
    const [transaction] = await request.db
      .select()
      .from(TransactionsTable)
      .where(eq(TransactionsTable.id, id))
      .limit(1);

    if (!transaction) {
      return reply.code(404).send({ error: 'Transaction not found' });
    }

    // Fetch corresponding sub-record based on transaction type
    if (transaction.type === 'deposit') {
      const [deposit] = await request.db
      .select({
        id: depositsTable.id,
        transactionId: depositsTable.transactionId,
        status: depositsTable.status,
        meta: depositsTable.meta,
        createdAt: depositsTable.createdAt,
        updatedAt: depositsTable.updatedAt,
        deletedAt: depositsTable.deletedAt,
      })
      .from(depositsTable)
      .where(eq(depositsTable.transactionId, id))
      .limit(1);
      return reply.code(200).send({ transaction, deposit: deposit || null });
    }

    if (transaction.type === 'withdraw') {
      const [withdraw] = await request.db
      .select({
        id: withdrawsTable.id,
        transactionId: withdrawsTable.transactionId,
        status: withdrawsTable.status,
        meta: withdrawsTable.meta,
        createdAt: withdrawsTable.createdAt,
        updatedAt: withdrawsTable.updatedAt,
        deletedAt: withdrawsTable.deletedAt,
      })
      .from(withdrawsTable)
      .where(eq(withdrawsTable.transactionId, id))
      .limit(1);
      return reply.code(200).send({ transaction, withdraw: withdraw || null });
    }

    if (transaction.type === 'bet') {
      const [bet] = await request.db
        .select({
          id: BetsTable.id,
          transactionId: BetsTable.transactionId,
          choice: BetsTable.choice,
          amount: BetsTable.amount,
          winAmount: BetsTable.winAmount,
          odds: BetsTable.odds,
          meta: BetsTable.meta,
          gameSessionId: BetsTable.gameSessionId,
          createdAt: BetsTable.createdAt,
          updatedAt: BetsTable.updatedAt,
          deletedAt: BetsTable.deletedAt,
        })
        .from(BetsTable)
        .where(eq(BetsTable.transactionId, id))
        .limit(1);

      let game = null;
      let gameSession = null;
      if (bet?.gameSessionId) {
        [gameSession] = await request.db
          .select()
          .from(GameSessionsTable)
          .where(eq(GameSessionsTable.id, bet.gameSessionId))
          .limit(1);
        if (gameSession?.gameId) {
          [game] = await request.db
            .select()
            .from(GamesTable)
            .where(eq(GamesTable.id, gameSession.gameId))
            .limit(1);
        }
      }
      return reply.code(200).send({ transaction, bet: bet || null, game: game || null, gameSession: gameSession || null });
    }

    // Default: return transaction only for other types
    return reply.code(200).send({ transaction });
  } catch (error: any) {
    return reply.code(500).send({ error: 'Internal server error', message: error.message });
  }
}

async function updateTransaction(request: FastifyRequest, reply: FastifyReply) {
  const {id} = request.params as { id: number };
  const {
    status
  } = request.body as Partial<TransactionRequestBody>;

  if (!id) {
    return reply.code(400).send({error: 'Transaction ID is required.'});
  }

  try {
    const updatedTransactions = await completeTransaction(request.db, id, status)
    return reply.code(200).send({transaction: updatedTransactions});
  } catch (error: any) {
    return reply.code(500).send({error: 'Failed when updating Transaction'});
  }
}

async function deleteTransaction(request: FastifyRequest, reply: FastifyReply) {
  const {id} = request.params as { id: number };
  try {
    await request.db.transaction(async (trx) => {
      const [tx] = await trx
        .select()
        .from(TransactionsTable)
        .where(eq(TransactionsTable.id, id))
        .limit(1)
        .for('update');

      if (!tx) {
        return reply.code(404).send({error: 'Transaction not found'});
      }

      const now = new Date();

      if (tx.type === 'deposit') {
        await trx
          .update(depositsTable)
          .set({ updatedAt: now, deletedAt: now })
          .where(eq(depositsTable.transactionId, id));
      } else if (tx.type === 'withdraw') {
        await trx
          .update(withdrawsTable)
          .set({ updatedAt: now, deletedAt: now })
          .where(eq(withdrawsTable.transactionId, id));
      } else if (tx.type === 'bet') {
        await trx
          .update(BetsTable)
          .set({ updatedAt: now, deletedAt: now })
          .where(eq(BetsTable.transactionId, id));
      }

      await trx
        .update(TransactionsTable)
        .set({ updatedAt: now, deletedAt: now })
        .where(eq(TransactionsTable.id, id));
    });

    return reply.code(200).send({message: 'Transaction deleted successfully'});
  } catch (error) {
    return reply.code(500).send({error: 'Internal server error'});
  }
}

export async function getUserTransactionStats(
  db: NodePgDatabase<typeof schema>,
  userId: string
) {
  // Get current month date range
  const now = new Date();
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  // Get monthly credits (user as receiver, completed, withdraw/gifting/bet, current month)
  const monthlyCreditsResult = await db
    .select()
    .from(TransactionsTable)
    .where(
      and(
        ne(TransactionsTable.userId, userId),
        eq(TransactionsTable.status, TransactionStatus.COMPLETED),
        gte(TransactionsTable.updatedAt, firstDayOfMonth),
        lte(TransactionsTable.updatedAt, lastDayOfMonth),
        isNull(TransactionsTable.deletedAt)
      )
    );

  // Get total commission earnings (user as receiver, completed, withdraw type, all time)
  const commissionEarningsResult = await db
    .select()
    .from(TransactionsTable)
    .where(
      and(
        ne(TransactionsTable.userId, userId),
        eq(TransactionsTable.status, TransactionStatus.COMPLETED),
        isNull(TransactionsTable.deletedAt)
      )
    );

  let monthlycreds = monthlyCreditsResult
    .filter(t => t.type !== 'deposit')
    .map(t => Number(t.amount));

  let totalcreds = commissionEarningsResult
    .filter(t => t.type !== 'deposit')
    .map(t => Number(t.amount));

  return {
    monthlyCredits: monthlycreds.reduce((sum, amount) => sum + amount, 0),
    commissionEarnings: totalcreds.reduce((sum, amount) => sum + amount, 0)
  };
}

async function getPlayerTransactions(request: FastifyRequest, reply: FastifyReply) {
  try {
    const loggedUser: any = request.user;
    const userId = loggedUser?.id;

    if (!userId) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    let { limit = 50, startDate, endDate, type = "all" } = request.query as {
      limit?: number;
      startDate?: string;
      endDate?: string;
      type?: string;
    };

    // Normalize endDate to include full day
    let start: Date | undefined;
    let end: Date | undefined;
    if (startDate) start = new Date(startDate);
    if (endDate) {
      end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
    }

    // Base conditions
    const conditions: any[] = [eq(TransactionsTable.userId, userId), isNull(TransactionsTable.deletedAt)];
    if (start) conditions.push(gte(TransactionsTable.updatedAt, start));
    if (end) conditions.push(lte(TransactionsTable.updatedAt, end));

    // Type filter
    if (type && type !== "all") {
      if (type === "game") {
        conditions.push(eq(TransactionsTable.type, "bet"));
      } else {
        conditions.push(eq(TransactionsTable.type, type));
      }      
    }

    // Fetch transactions with subqueries
    const transactions = await request.db
      .select({
        id: TransactionsTable.id,
        userId: TransactionsTable.userId,
        type: TransactionsTable.type,
        amount: TransactionsTable.amount,
        status: TransactionsTable.status,
        updatedAt: TransactionsTable.updatedAt,

        receiverId: sql<string | null>`(
          SELECT "receiverId"
          FROM "gifts"
          WHERE "gifts"."transactionId" = "transactions"."id"
          LIMIT 1
        ) AS "receiverId"`,

        gameId: sql<number | null>`(
          SELECT "gameSessionId"
          FROM "bets"
          WHERE "bets"."transactionId" = "transactions"."id"
          LIMIT 1
        ) AS "gameId"`,

        winAmount: sql<number | null>`(
          SELECT "winAmount"
          FROM "bets"
          WHERE "bets"."transactionId" = "transactions"."id"
          LIMIT 1
        ) AS "winAmount"`,

        depositMeta: sql<any | null>`(
          SELECT "meta"
          FROM "deposits"
          WHERE "deposits"."transactionId" = "transactions"."id"
          LIMIT 1
        ) AS "depositMeta"`,

        withdrawMeta: sql<any | null>`(
          SELECT "meta"
          FROM "withdraws"
          WHERE "withdraws"."transactionId" = "transactions"."id"
          LIMIT 1
        ) AS "withdrawMeta"`,

        giftMeta: sql<any | null>`(
          SELECT "meta"
          FROM "gifts"
          WHERE "gifts"."transactionId" = "transactions"."id"
          LIMIT 1
        ) AS "giftMeta"`,
      })
      .from(TransactionsTable)
      .where(and(...conditions))
      .orderBy(sql`${TransactionsTable.updatedAt} DESC`)
      .limit(limit);

    // Derive win/lose for game bets
    const processed = transactions.map((tx: any) => {
      if (type === "game") {
        return {
          ...tx,
          result: tx.winAmount && Number(tx.winAmount) > 0 ? "win" : "lose",
        };
      }
      return tx;
    });

    // Fetch game wallet balance
    const wallet = await request.db
      .select({ balance: WalletTable.balance })
      .from(WalletTable)
      .where(and(eq(WalletTable.userId, userId), eq(WalletTable.type, 'game'), isNull(WalletTable.deletedAt)))
      .limit(1)
      .execute()
      .then((rows: any) => (rows.length ? Number(rows[0].balance) : 0));

    return reply.send({
      userId,
      type,
      range: { startDate: startDate || null, endDate: endDate || null },
      totalAmount: wallet, // now using game wallet balance
      count: processed.length,
      transactions: processed,
    });
  } catch (err: any) {
    return reply.code(500).send({ error: err.message });
  }
}

export async function completeUserTransaction(
  db: NodePgDatabase<typeof schema>,
  type: keyof typeof transactionHandlers, // "withdraws" | "deposits" | "bets" | ...
  subRecordId: number,
  userId: number,
  amount: number,
  status: TransactionStatus,
  transactionId?: number // optional: use existing transaction
) {
  if (![TransactionStatus.COMPLETED, TransactionStatus.VOID].includes(status)) {
    throw new Error("Invalid status");
  }

  return await db.transaction(async (trx) => {
    const now = new Date();

    let transaction = null;

    // ✅ Use existing transactionId or create new
    if (transactionId) {
      [transaction] = await trx
        .select()
        .from(TransactionsTable)
        .where(eq(TransactionsTable.id, transactionId))
        .limit(1);
      if (!transaction) {
        throw new Error("Transaction not found for provided ID");
      }
      
      // Update the transaction status to completed/void
      const txStatus = status === TransactionStatus.VOID ? ('void' as const) : (status as 'in progress' | 'completed');
      await trx
        .update(TransactionsTable)
        .set({
          status: txStatus,
          updatedAt: now,
        })
        .where(eq(TransactionsTable.id, transactionId));
    } else {
      const handlerKeyToType = {
        withdraws: 'withdraw',
        deposits: 'deposit',
        bets: 'bet',
        gifts: 'gift',
        promos: 'promo',
      } as const;

      [transaction] = await trx
        .insert(TransactionsTable)
        .values({
          userId,
          amount: amount.toFixed(4),
          type: handlerKeyToType[type],
          status,
        })
        .returning();
    }

        // Update sub-table record
        const handler = transactionHandlers[type];
        await trx
          .update(handler.table)
          .set({
            transactionId: transaction.id,
            status: status === TransactionStatus.VOID ? 'void' : 'completed',
            updatedAt: now,
          })
          .where(eq(handler.table.id, subRecordId));
    
        // Adjust wallet
        const [wallet] = await trx
          .select()
          .from(WalletTable)
          .where(and(eq(WalletTable.userId, userId), eq(WalletTable.type, 'game')))
          .limit(1)
          .for("update");

    if (!wallet) throw new Error("Wallet not found");

    if (status === TransactionStatus.COMPLETED && handler.walletOnCompleted) {
      await handler.walletOnCompleted(trx, wallet, amount);
    }

    if (status === TransactionStatus.VOID && handler.walletOnFailed) {
      await handler.walletOnFailed(trx, wallet, amount);
    }

    return transaction;
  });
}


export default TransactionRoutesPlugin;