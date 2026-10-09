import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { UsersTable, GiftsTable, WalletTable, TransactionsTable, UserSessionTable } from "../db/schema.ts";
import { eq, and } from "drizzle-orm";
import { EventManager, Message, Channel, GiftState } from "./dosletra/DosLetraPlugin.ts";
import { globalAuthentication } from "../app.ts";

const sendGiftSchema = {
  description: 'Send gifts to a host. 💡 Once successful, the gift is broadcasted in real-time to all connected WebSocket clients under `channel: "Gift"` and `state: "Send"`.',
  tags: ['gifting'],
  body: {
    type: 'object',
    required: ['hostId', 'amount', 'giftType', 'multiplier'],
    properties: {
      hostId: { type: 'integer', minimum: 1 },
      amount: { type: 'number', minimum: 1 },
      giftType: { type: 'string' },
      multiplier: { type: 'number', minimum: 1 },
    }
  },
  response: {
    201: {
      type: 'object',
      properties: {
        senderName: { type: 'string' },
        giftType: { type: 'string' },
        amount: { type: 'number' },
        multiplier: { type: 'number' },
        hostId: { type: 'integer' },
        vipType: { type: ['string', 'null'] },
        balance: { type: 'string' },
      },
      required: ['senderName', 'giftType', 'amount', 'multiplier', 'hostId', 'balance']
    },
    400: { type: 'object', properties: { error: { type: 'string' } } },
    404: { type: 'object', properties: { error: { type: 'string' } } },
    // 500: { type: 'object', properties: { error: { type: 'string' } } },
  }
};

async function sendGift(request: FastifyRequest, reply: FastifyReply) {
  const { hostId, amount, giftType, multiplier } = request.body as {
    hostId: number;
    amount: number;
    giftType: string;
    multiplier: number;
  };

  const loggedUser: any = request.user;
  const userId = loggedUser?.id ?? null;
  const senderName = loggedUser?.userName ?? null;

  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

  try {
    // Validate host
    const host = await request.db.select().from(UsersTable)
      .where(and(eq(UsersTable.id, hostId), eq(UsersTable.type, 'host')))
      .limit(1);
    if (!host[0]) return reply.code(400).send({ error: 'Host user not found' });

    // Get and lock sender wallet
    const [wallet] = await request.db.select().from(WalletTable)
      .where(eq(WalletTable.userId, userId))
      .limit(1)
      .for('update');
    if (!wallet) return reply.code(404).send({ error: 'Wallet not found' });

    const balance = Number(wallet.balance || 0);
    const onHold = Number(wallet.onHoldBalance || 0);
    const availableBalance = balance - onHold;

    if (availableBalance < amount) return reply.code(400).send({ error: 'Insufficient Balance' });

    // Transaction block
    const result = await request.db.transaction(async (trx) => {
      // Update wallet
      const [newWallet] = await trx.update(WalletTable).set({
        onHoldBalance: (onHold + amount).toFixed(4),
        updatedAt: new Date(),
      }).where(eq(WalletTable.id, wallet.id)).returning();

      const newBalance = Number(newWallet.balance) - Number(newWallet.onHoldBalance);

      // Insert transaction
      const [newTx] = await trx.insert(TransactionsTable).values({
        userId,
        amount: amount.toFixed(4),
        type: 'gift',
      }).returning();

      // Insert gift
      const [gift] = await trx.insert(GiftsTable).values({
        receiverId: hostId,
        transactionId: newTx.id,
        meta: { giftType, amount, multiplier, hostId },
        status: 'completed',
      }).returning();

      return { gift, newBalance };
    });

    const giftMeta = result.gift.meta as {
      giftType: string;
      amount: number;
      multiplier: number;
      hostId: number;
    };    

    // Emit event
    EventManager.emit(
      "gift",
      new Message(Channel.Gift, GiftState.Send, {
        data: {
          senderName,
          giftType: giftMeta.giftType,
          amount: Number(giftMeta.amount),
          multiplier: Number(giftMeta.multiplier),
          hostId: Number(giftMeta.hostId),
          vipType: loggedUser.vipType || null,
        },
      })
    );

    // Respond
    return reply.code(201).send({
      senderName,
      giftType: giftMeta.giftType,
      amount: Number(giftMeta.amount),
      multiplier: Number(giftMeta.multiplier),
      hostId: Number(giftMeta.hostId),
      vipType: loggedUser.vipType || null,
      balance: result.newBalance.toFixed(4),
    });

  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: 'Failed to send gift' });
  }
}

const GiftRoutePlugin: FastifyPluginAsync = async (server) => {
  globalAuthentication(server);

  server.post('/gift', { preHandler: server.authenticate, schema: sendGiftSchema }, sendGift);
};

export default GiftRoutePlugin;
