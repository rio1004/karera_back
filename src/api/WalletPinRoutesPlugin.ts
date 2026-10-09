import {FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply} from "fastify";
import {WalletTable, UsersTable} from "../db/schema.ts";
import {and, eq, isNotNull, isNull} from "drizzle-orm";
import {hash, compare} from "bcrypt";

interface PinBody {
  pin: string
}

const isValidPin = (pin: unknown): boolean => /^\d{4}$/.test(String(pin ?? ""));

const errorSchema = {type: "object", properties: {error: {type: "string"}}};
const pinResponseSchema = {type: "object", properties: {message: {type: "string"}}};

const createPinSchema = {
  description: "Create PIN for wallet",
  tags: ["wallet"],
  body: {type: "object", required: ["pin"], properties: {pin: {type: "string"}}},
  response: {201: pinResponseSchema, 400: errorSchema, 404: errorSchema, 500: errorSchema}
};

const updatePinSchema = {
  description: "Update wallet PIN",
  tags: ["wallet"],
  body: {
    type: "object",
    required: ["pin"],
    properties: {pin: {type: "string"}}
  },
  response: {200: pinResponseSchema, 400: errorSchema, 401: errorSchema, 404: errorSchema, 500: errorSchema}
};

const verifyPinSchema = {
  description: "Verify wallet PIN",
  tags: ["wallet"],
  body: {type: "object", required: ["pin"], properties: {pin: {type: "string"}}},
  response: {200: pinResponseSchema, 400: errorSchema, 401: errorSchema, 500: errorSchema}
};

const pinStatusSchema = {
  description: "Check if user has active PIN",
  tags: ["wallet"],
  response: {
    200: {type: "object", properties: {hasActivePin: {type: "boolean"}}},
    401: errorSchema, 500: errorSchema
  }
};

const findActiveWallet = (req: FastifyRequest, userId: string, isWithPin = false) => {
  const conditions = [
    eq(WalletTable.userId, userId),
    eq(WalletTable.status, "active"),
    isNull(WalletTable.deletedAt),
  ];

  if (isWithPin) {
    conditions.push(isNotNull(WalletTable.pinHash));
  }

  return req.db
    .select({pinHash: WalletTable.pinHash})
    .from(WalletTable)
    .where(and(...conditions))
    .limit(1);
};

const createPin = async (req: FastifyRequest<{ Body: PinBody }>, reply: FastifyReply) => {
  try {
    const userId = req.user?.id ?? "";
    const {pin} = req.body;
    if (!isValidPin(pin)) return reply.code(400).send({error: "PIN must be 4 digits"});

    const [wallet] = await findActiveWallet(req, userId, false);
    if (!wallet) return reply.code(404).send({error: "Wallet not found"});
    if (wallet.pinHash) return reply.code(400).send({error: "PIN already exists"});

    await req.db.update(WalletTable).set({
      pinHash: await hash(pin, 10),
      updatedAt: new Date()
    }).where(eq(WalletTable.userId, userId));
    return reply.send({message: "PIN created successfully"});
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({error: "Internal Server Error"});
  }
};

const updatePin = async (req: FastifyRequest<{ Body: PinBody }>, reply: FastifyReply) => {
  try {
    const userId = req.user?.id ?? "";
    const {pin} = req.body;
    if (!isValidPin(pin)) return reply.code(400).send({error: "PIN must be 4 digits"});

    const [wallet] = await findActiveWallet(req, userId, true);
    if (!wallet) return reply.code(404).send({error: "Wallet not found"});
    if (!wallet.pinHash) return reply.code(400).send({error: "No PIN exists, create one first"});

    await req.db.update(WalletTable).set({
      pinHash: await hash(pin, 10),
      updatedAt: new Date()
    }).where(eq(WalletTable.userId, userId));
    return reply.send({message: "PIN updated", existingPin: true});
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({error: "Internal Server Error"});
  }
};

const verifyPin = async (req: FastifyRequest<{ Body: PinBody }>, reply: FastifyReply) => {
  try {
    const userId = req.user?.id ?? "";
    const {pin} = req.body;
    if (!isValidPin(pin)) return reply.code(400).send({error: "Invalid PIN format"});

    const [wallet] = await findActiveWallet(req, userId, true);
    if (!wallet) return reply.code(404).send({error: "Wallet not found"});
    if (!wallet.pinHash) return reply.code(400).send({error: "No PIN set"});

    return (await compare(pin, wallet.pinHash))
      ? reply.send({message: "PIN verified successfully"})
      : reply.code(401).send({error: "Incorrect PIN"});
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({error: "Internal Server Error"});
  }
};

const getPinStatus = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const userId = req.user?.id ?? "";
    const [wallet] = await findActiveWallet(req, userId, true);
    return reply.send({hasActivePin: Boolean(wallet?.pinHash)});
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({error: "Internal Server Error"});
  }
};

const WalletRoutesPlugin: FastifyPluginAsync = async (server: FastifyInstance) => {
  server.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      reply.code(401).send({error: "Unauthorized Request"});
    }
  });

  server.register(
    async (r) => {
      r.addHook("preHandler", r.authenticate);
      r.post("/", {schema: createPinSchema}, createPin);
      r.patch("/", {schema: updatePinSchema}, updatePin);
      r.post("/verify", {schema: verifyPinSchema}, verifyPin);
      r.get("/status", {schema: pinStatusSchema}, getPinStatus);
    },
    {prefix: "/wallet/pin"}
  );
};

export default WalletRoutesPlugin;