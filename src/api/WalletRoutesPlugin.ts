import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { WalletTable, walletStatusEnum, walletTypeEnum, UserSessionTable } from '../db/schema.ts';
import { and, eq, isNull, or } from 'drizzle-orm';
import { hash } from 'bcrypt';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'; 
import * as schema from '../db/schema.ts'; 
import { createDeposit, createTransaction, createWithdraw, getUserTransactionStats } from './TransactionRoutesPlugin.ts';
import { globalAuthentication } from '../app.ts';

const WalletRoutesPlugin: FastifyPluginAsync = async (server: FastifyInstance, opts) => {
  globalAuthentication(server);

  // Register routes
  server.get('/wallet', { preHandler: server.authenticate, schema: getWalletSchema }, getWallet);
  server.patch('/wallet', { preHandler: server.authenticate, schema: updateWalletSchema }, updateWallet);
  server.delete('/wallet/:id', { preHandler: server.authenticate, schema: deleteWalletSchema }, deleteWallet);


  // deposit and withdraw routes for debugging
  // No validations are done here, will just do the transaction and update the balance
  server.post('/wallet/deposit', { preHandler: server.authenticate, schema: depositSchema}, deposit);
  server.post('/wallet/withdraw', { preHandler: server.authenticate, schema: withdrawSchema}, withdraw);
  server.get('/balance', { preHandler: server.authenticate, schema: balanceSchema}, balance);
  server.post('/balance/reset', { preHandler: server.authenticate, schema: balanceSchema}, resetBalance);
};

// declare module 'fastify' {
//   interface FastifyInstance {
//     authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
//   }
//   interface FastifyReply {
//     jwtSign(payload: object | string, options?: object): Promise<string>;
//   }
//   interface FastifyRequest {
//     db: NodePgDatabase<typeof schema>;
//   }
// }

type SelectWallet = typeof WalletTable.$inferSelect;
type InsertWallet = typeof WalletTable.$inferInsert;
type UpdateWallet = Partial<Omit<InsertWallet, 'id' | 'createdAt' | 'userId'>>;
type WalletStatusType = typeof walletStatusEnum.enumValues[number];
// Request types
interface UpdateWalletRequest {
  status?: WalletStatusType;
  balance?: string;
}
const transactionProperties = {
  id: { type: 'number' },
  userId: { type: 'number' },
  receiverId: { type: 'number' },
  type: {type: 'string'},
  amount: {type: 'number'},
  status: {type: 'string'},
  createdAt: {type: 'string', format: 'date-time'},
  updatedAt: {type: 'string', format: 'date-time'},
  deletedAt: {type: 'string', format: 'date-time'}
};
// Schema definitions
const walletResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'number' },
    userId: { type: 'number' },
    type: { type: 'string', enum: ['game', 'commission', 'load'] },
    balance: { type: 'number' },
    onHoldBalance: { type: 'number' },
    status: { type: 'string', enum: walletStatusEnum.enumValues },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    deletedAt: { type: 'string', format: 'date-time', nullable: true }
  }
};


const getWalletSchema = {
  description: 'Get all wallets for authenticated user',
  tags: ['wallet'],
  response: {
    200: {
      type: 'object',
      properties: {
        wallets: {
          type: 'array',
          items: walletResponseSchema
        }
      }
    },
    404: {
      description: 'Wallets not found',
      type: 'object',
      properties: { error: { type: 'string' } }
    },
    500: {
      description: 'Internal Server Error',
      type: 'object',
      properties: { error: { type: 'string' } }
    }
  }
};

const updateWalletSchema = {
  description: 'Update wallet details',
  tags: ['wallet'],
  body: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: walletStatusEnum.enumValues },
      balance: { type: 'number' }
    }
  },
  response: {
    200: {
      description: 'Updated wallet details',
      ...walletResponseSchema
    },
    400: {
      description: 'Bad Request',
      type: 'object',
      properties: {
        error: { type: 'string' }
      }
    },
    404: {
      description: 'Wallet not found',
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

const deleteWalletSchema = {
  description: 'Delete wallet (soft delete)',
  tags: ['wallet'],
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'number' }
    }
  },
  response: {
    200: {
      description: 'Successfully deleted wallet',
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' }
      }
    },
    404: {
      description: 'Wallet not found',
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

// Route handlers
const getWallet = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const user: any = request.user;
    const userId = user.id ?? '';

    // ✅ Get all wallets for this user
    const wallets = await request.db
      .select()
      .from(WalletTable)
      .where(eq(WalletTable.userId, userId));

    if (!wallets || wallets.length === 0) {
      return reply.code(404).send({ error: 'No wallets found' });
    }

    // ✅ Attach transaction stats per wallet
    const walletsWithStats = await Promise.all(
      wallets.map(async (wallet) => {
        const stats = await getUserTransactionStats(request.db, userId); 
        return { ...wallet, ...stats };
      })
    );

    return reply.code(200).send({ wallets: walletsWithStats });
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ error: 'Internal Server Error' });
  }
};

const updateWallet = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const user:any = request.user;

    if(!user){
      return reply.code(404).send({ error: 'Wallet not found' });
    }

    const userId = user.id;
    const { status, balance } = request.body as UpdateWalletRequest;

    // Find the wallet
    const [existingWallet] = await request.db
      .select()
      .from(WalletTable)
      .where(eq(WalletTable.userId, userId));

    if (!existingWallet) {
      return reply.code(404).send({ error: 'Wallet not found' });
    }

    // Prepare update data
    const updateData: UpdateWallet = {
      updatedAt: new Date()
    };

    if (status !== undefined) {
      updateData.status = status;
    }

    if (balance !== undefined) {
      updateData.balance = balance;
    }

    // if (pinHash !== undefined) {
    //   // Hash the PIN before storing
    //   updateData.pinHash = await hash(pinHash, 10);
    // }

    // Update the wallet
    const [updatedWallet] = await request.db
      .update(WalletTable)
      .set(updateData)
      .where(eq(WalletTable.userId, userId))
      .returning();

    return reply.code(200).send(updatedWallet);
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ error: 'Internal Server Error' });
  }
};

const deleteWallet = async (request: FastifyRequest, reply: FastifyReply) => {
  const {id} = request.params as { id: string };
  try {
    // Find the wallet
    const [existingWallet] = await request.db
      .select()
      .from(WalletTable)
      .where(eq(WalletTable.id, Number(id)));

    if (!existingWallet) {
      return reply.code(404).send({ error: 'Wallet not found' });
    }

    // Soft delete - update deletedAt and set status to 'closed'
    const [deletedWallet] = await request.db
      .update(WalletTable)
      .set({
        deletedAt: new Date(),
        status: 'closed',
        updatedAt: new Date()
      })
      .where(eq(WalletTable.id, Number(id)))
      .returning();

    return reply.code(200).send({
      success: true,
      message: 'Wallet successfully deleted'
    });
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ error: 'Internal Server Error' });
  }
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

const depositSchema = {
  description: 'Deposit money to your account.',
  tags: ['TEST transaction'],
  body: {
    type: 'object',
    required: ['amount'],
    properties: {
      amount: {type: 'string'}
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
}

const withdrawSchema = {
  description: 'Withdraw money from your account.',
  tags: ['TEST transaction'],
  body: {
    type: 'object',
    required: ['amount'],
    properties: {
      amount: {type: 'string'}
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

const balanceSchema = {
  description: 'Get balances for all wallet types.',
  tags: ['TEST transaction'],
  response: {
    200: {
      type: 'object',
      properties: {
        wallets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['game', 'commission', 'load'] }, // matches walletTypeEnum
              balance: { type: 'number' }, // toFixed(4) returns string
              totalCredits: { type: 'number' },
              totalDebits: { type: 'number' },
              transactionCount: { type: 'number' }
            },
            required: ['type', 'balance']
          }
        },
        message: { type: 'string' }
      },
      required: ['wallets', 'message']
    },
    400: {
      description: 'Invalid Request',
      type: 'object',
      properties: {
        error: { type: 'string' },
        message: { type: 'string' }
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

async function resetBalance(request: FastifyRequest, reply: FastifyReply) {
  // get balance from wallet table of the current logged in user
  const loggedUser: any = request.user;
  const userId = loggedUser.id ?? '';
  const [wallet] = await request.db.select().from(WalletTable).where(eq(WalletTable.userId, userId)).limit(1)
  if (!wallet) {
    return reply.code(400).send({error: 'Invalid Request', message: 'Failed when retrieving balance'});
  }
  const balance = Number(parseFloat(wallet.balance))
  const onHoldBalance = Number(parseFloat(wallet.onHoldBalance))
  const newBalance = balance + onHoldBalance

  const [newWallet] = await request.db.update(WalletTable).set({
          balance: newBalance.toString(),
          onHoldBalance: '0',
          updatedAt: new Date()
        }).where(eq(WalletTable.id, wallet.id)).returning();


  return reply.code(200).send({
    balance: newWallet.balance,
    totalCredits: 0,
    totalDebits: 0,
    transactionCount: 0,
    message: 'Balance fetched successfully'
  });
}



async function balance(request: FastifyRequest, reply: FastifyReply) {
  try {
    const loggeduser: any = request.user;
    const userId = loggeduser?.id ?? null;

    // Get all wallets for this user
    const wallets = await request.db
      .select()
      .from(WalletTable)
      .where(eq(WalletTable.userId, userId));

    if (!wallets || wallets.length === 0) {
      return reply.code(400).send({ error: 'Invalid Request', message: 'No wallets found' });
    }

    // Map balances by wallet type
    const balances = wallets.map(wallet => {
      const balance = parseFloat(wallet.balance);
      const onHoldBalance = parseFloat(wallet.onHoldBalance);
      const actualBalance = (balance - onHoldBalance).toFixed(4);

      return {
        type: wallet.type,
        balance: actualBalance,
        totalCredits: 0,   // you can pull real stats if needed
        totalDebits: 0,
        transactionCount: 0,
      };
    });

    return reply.code(200).send({
      wallets: balances,
      message: 'Balances fetched successfully'
    });
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ error: 'Internal Server Error' });
  }
}

async function deposit(request: FastifyRequest, reply: FastifyReply) {
  try {
    const userId = request.user?.id ?? "";
    const {amount} = request.body as {amount: string };

    const [userWallet] = await request.db.select().from(WalletTable).where(and(eq(WalletTable.userId, Number(userId)), eq(WalletTable.type, 'game')))
    if (!userWallet) return reply.code(400).send({error: 'User not found'});
    const transaction = await createDeposit(request.db, userId, amount)
    return reply.code(201).send({transaction: transaction});
  } catch (error) {
    return reply.code(500).send({error: 'Failed when depositing', message: error.message});
  }
}

async function withdraw(request: FastifyRequest, reply: FastifyReply) {
  try {
    const userId = request.user?.id ?? "";
    const {amount} = request.body as {amount: string};

    const [userWallet] = await request.db.select().from(WalletTable).where(eq(WalletTable.userId, Number(userId)))
    if (!userWallet) return reply.code(400).send({error: 'User not found'});
    const transaction = await createWithdraw(request.db, userId, amount)
    return reply.code(201).send({transaction: transaction});
  } catch (error) {
    return reply.code(500).send({error: 'Failed when withdrawing', message: error.message});
  }
}

export default WalletRoutesPlugin;