import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { FastifyPluginAsync } from 'fastify';
import { UsersTable, ReferralCodesTable, ReferralsTable, ReferralRepCodesTable } from "../db/schema.ts";
import { eq, and, or } from 'drizzle-orm';
import { generateReferralCode, logReferralHistory } from './utils/referral.ts';
import QRCode from "qrcode";
import { globalAuthentication } from '../app.ts';

// =================
// ROUTES PLUGIN
// =================
const OperatorRoutePlugin: FastifyPluginAsync = async (server: FastifyInstance, opts) => {
  globalAuthentication(server);
  // GET routes (no body)
  server.get(
    "/operator/join/player/:code",
    {
      preHandler: server.authenticate,
      schema: {
        tags: joinWithReferralSchema.tags,
        params: joinWithReferralSchema.params,
        querystring: joinWithReferralSchema.querystring,
        response: joinWithReferralSchema.response,
      },
    },
    joinHandler
  );

  server.get(
    "/operator/join/representative/:code",
    {
      preHandler: server.authenticate,
      schema: {
        tags: joinWithReferralSchema.tags,
        params: joinWithReferralSchema.params,
        querystring: joinWithReferralSchema.querystring,
        response: joinWithReferralSchema.response,
      },
    },
    joinHandler
  );

  server.get('/operator/codes', { preHandler: server.authenticate, schema: getReferralCodesSchema }, getReferralCodes);
  server.get('/operator/:code', { preHandler: server.authenticate, schema: getReferralCodeQRSchema }, getReferralCodeQR);

  // POST routes (body allowed)
  server.post('/operator/generate/code', { preHandler: server.authenticate, schema: generateCodeSchema }, generateOperatorCode);

  server.post(
    "/operator/join/player/:code",
    { preHandler: server.authenticate, schema: joinWithReferralSchema },
    joinHandler
  );

  server.post(
    "/operator/join/representative/:code",
    { preHandler: server.authenticate, schema: joinWithReferralSchema },
    joinHandler
  );
};

// =================
// SCHEMAS
// =================

export const joinWithReferralSchema = {
  tags: ["Operator"],

  // URL params
  params: {
    type: "object",
    properties: {
      code: { type: "string" }, // referral code in URL
    },
    required: ["code"],
  },

  // Query params (GET) or optional override
  querystring: {
    type: "object",
    properties: {
      repType: { type: "string", enum: ["rep1", "rep2"] },
    },
    required: [],
  },

  // Body schema only for POST requests
  body: {
    type: ["object", "null"], 
    properties: {
      repType: { type: "string", enum: ["rep1", "rep2"] },
    },
    additionalProperties: false,
    required: [],
  },

  response: {
    200: {
      type: "object",
      properties: {
        message: { type: "string" },
        operator: { type: "object" },          // for players
        player: { type: "object" },            // for players
        representative: { type: "object" },    // for reps
        referral: { type: "object" },
      },
      required: ["message", "referral"],
      additionalProperties: true,
    },
  },
};

// Operator generates referral code
export const generateCodeSchema = {
  tags: ["Operator"],
  body: {
    type: "object",
    properties: {
      pctOperator: { type: "number" },
      pctRep1: { type: "number" },
      pctRep2: { type: "number" },
      codeType: { type: "string", enum: ["player", "representative"], default: "player" },
      repType: { type: "string", enum: ["rep1", "rep2"] }, // optional, only used for representative
    },
    required: ["pctOperator", "pctRep1", "pctRep2", "codeType"],
    additionalProperties: false,
    allOf: [
      {
        if: { properties: { codeType: { const: "representative" } } },
        then: { required: ["repType"] },
      },
    ],
  },
  response: {
    200: {
      type: "object",
      properties: {
        message: { type: "string" },
        referralCode: {
          type: "object",
          properties: {
            id: { type: "number" },
            operatorId: { type: "number" },
            code: { type: "string" },
            pctOperator: { type: "number" },
            pctRep1: { type: "number" },
            pctRep2: { type: "number" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
          required: ["id", "operatorId", "code", "pctOperator", "pctRep1", "pctRep2"],
        },
        referralUrl: { type: "string" },
        qrCode: { type: "string" },
      },
      required: ["message", "referralCode", "referralUrl", "qrCode"],
    },
  },
};

export const getReferralCodesSchema = {
  tags: ["Operator"],
  response: {
    200: {
      type: "object",
      properties: {
        codes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "number" },
              operatorId: { type: "number" },
              code: { type: "string" },
              pctOperator: { type: "number" },
              pctRep1: { type: "number" },
              pctRep2: { type: "number" },
              createdAt: { type: "string", format: "date-time" },
              updatedAt: { type: "string", format: "date-time" },
            },
            required: ["id", "operatorId", "code"],
          },
        },
      },
      required: ["codes"],
    },
  },
};

export const getReferralCodeQRSchema = {
  tags: ["Operator"],
  params: {
    type: "object",
    properties: {
      code: { type: "string" },
    },
    required: ["code"],
  },
  querystring: {
    type: "object",
    properties: {
      repType: { type: "string", enum: ["rep1", "rep2"] },
    },
    required: [],
  },
  response: {
    200: {
      type: "object",
      properties: {
        referralCode: {
          type: "object",
          properties: {
            id: { type: "number" },
            operatorId: { type: "number" },
            code: { type: "string" },
            pctOperator: { type: "number" },
            pctRep1: { type: "number" },
            pctRep2: { type: "number" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
          required: ["id", "operatorId", "code"],
        },
        referralUrl: { type: "string" },
        qrCode: { type: "string" },
      },
      required: ["referralCode", "referralUrl", "qrCode"],
    },
  },
};

// =================
// HANDLERS
// =================
async function generateOperatorCode(request: FastifyRequest, reply: FastifyReply) {
  const { pctOperator, pctRep1, pctRep2, codeType, repType } = request.body as any;
  const loggedUser: any = request.user;
  console.log(loggedUser);
  
  const userId = loggedUser?.id;
  const userType = loggedUser?.type;

  if (!userId) return reply.code(401).send({ error: "Unauthorized" });
  if (userType !== "operator") return reply.code(403).send({ error: "Only operators can generate referral codes" });
  if (codeType === "representative" && !repType) {
    return reply.code(400).send({ error: "repType must be specified for representative codes" });
  }

  const operatorReferralCode = generateReferralCode("operator");

  const [referralCode] = await request.db
    .insert(ReferralCodesTable)
    .values({
      operatorId: userId,
      code: operatorReferralCode,
      pctOperator,
      pctRep1,
      pctRep2,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  let referralUrl: string;
  if (codeType === "player") {
    referralUrl = `/operator/join/player/${referralCode.code}`;
  } else {
    referralUrl = `/operator/join/representative/${referralCode.code}?repType=${repType}`;
  }

  const qrCodeDataUrl = await QRCode.toDataURL(referralUrl);

  return reply.code(200).send({
    message: "Referral code generated successfully",
    referralCode,
    referralUrl,
    qrCode: qrCodeDataUrl,
  });
}

async function joinHandler(request: FastifyRequest, reply: FastifyReply) {
  const { code } = request.params as { code: string };
  const loggedUser: any = request.user;
  const userId = loggedUser?.id;
  let userType = loggedUser?.type;

  if (!userId) return reply.code(401).send({ error: "Unauthorized" });

  // Merge repType from query OR body
  const { repType: repTypeQuery } = request.query as { repType?: "rep1" | "rep2" };
  const { repType: repTypeBody } = (request.body ?? {}) as { repType?: "rep1" | "rep2" };
  const repType = repTypeQuery || repTypeBody;

  // Fetch referral code
  const [referralCode] = await request.db
    .select()
    .from(ReferralCodesTable)
    .where(eq(ReferralCodesTable.code, code));

  if (!referralCode) return reply.code(400).send({ error: "Invalid referral code" });

  // Fetch operator
  const [operator] = await request.db
    .select()
    .from(UsersTable)
    .where(eq(UsersTable.id, referralCode.operatorId));

  if (!operator || operator.type !== "operator") {
    return reply.code(400).send({ error: "Invalid operator for referral code" });
  }

  // CASE 1: Player joins as a player
  if (userType === "player" && !repType) {
    const [referral] = await request.db
      .insert(ReferralsTable)
      .values({
        referralCodeId: referralCode.id,
        operatorId: operator.id,
        playerId: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // log history
    await logReferralHistory(request.db, {
      referralId: referral.id,
      action: "player_joined",
      userId,
      details: `Joined via code ${referralCode.code}`,
    });

    return reply.code(200).send({
      message: "Player successfully joined under operator",
      operator,
      player: loggedUser,
      referral,
    });
  }

  // CASE 2: Player upgrades into rep1/rep2
  if (userType === "player" && repType) {
    // ✅ Update player → rep1 or rep2
    await request.db
      .update(UsersTable)
      .set({ type: repType, updatedAt: new Date() })
      .where(eq(UsersTable.id, userId));

    userType = repType; // reflect change

    const insertData: any = {
      referralCodeId: referralCode.id,
      operatorId: operator.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (repType === "rep1") insertData.rep1Id = userId;
    if (repType === "rep2") insertData.rep2Id = userId;

    const [referral] = await request.db
      .insert(ReferralsTable)
      .values(insertData)
      .returning();

    // log history
    await logReferralHistory(request.db, {
      referralId: referral.id,
      action: `${repType}_joined`,
      userId,
      details: `Joined via code ${referralCode.code}`,
    });

    // ✅ Generate referral code for this representative
    const newRepCode = generateReferralCode(repType);
    const [repReferralCode] = await request.db
      .insert(ReferralRepCodesTable)
      .values({
        referralCodeId: referralCode.id,
        repId: userId,
        repType,
        code: newRepCode,
        recruitedUserId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // ✅ Build referral URL + QR
    const referralUrl = `/operator/join/player/${repReferralCode.code}`;
    const qrCodeDataUrl = await QRCode.toDataURL(referralUrl);

    return reply.code(200).send({
      message: `Player upgraded to ${repType} and joined under operator`,
      representative: { ...loggedUser, type: repType },
      referral,
      referralCode: repReferralCode,
      referralUrl,
      qrCode: qrCodeDataUrl,
    });
  }

  // CASE 3: Already rep1/rep2 joins normally
  if (["rep1", "rep2"].includes(userType)) {
    if (!repType) {
      return reply.code(400).send({ error: "Representative must specify repType" });
    }

    if (repType !== userType) {
      return reply.code(400).send({ error: `repType mismatch: expected ${userType}, got ${repType}` });
    }

    const insertData: any = {
      referralCodeId: referralCode.id,
      operatorId: operator.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (repType === "rep1") insertData.rep1Id = userId;
    if (repType === "rep2") insertData.rep2Id = userId;

    const [referral] = await request.db
      .insert(ReferralsTable)
      .values(insertData)
      .returning();
    
    // log history
    await logReferralHistory(request.db, {
      referralId: referral.id,
      action: `${repType}_joined`,
      userId,
      details: `Joined via code ${referralCode.code}`,
    });

    // ✅ Generate referral code for this representative
    const newRepCode = generateReferralCode(repType);
    const [repReferralCode] = await request.db
      .insert(ReferralRepCodesTable)
      .values({
        referralCodeId: referralCode.id,
        repId: userId,
        repType,
        code: newRepCode,
        recruitedUserId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    const referralUrl = `/operator/join/player/${repReferralCode.code}`;
    const qrCodeDataUrl = await QRCode.toDataURL(referralUrl);

    return reply.code(200).send({
      message: "Representative successfully joined under operator",
      representative: loggedUser,
      referral,
      referralCode: repReferralCode,
      referralUrl,
      qrCode: qrCodeDataUrl,
    });
  }

  return reply.code(400).send({ error: "Unhandled join case" });
}

async function getReferralCodes(request: FastifyRequest, reply: FastifyReply) {
  const loggedUser: any = request.user;
  const userId = loggedUser?.id;
  const userType = loggedUser?.type;

  if (!userId) return reply.code(401).send({ error: "Unauthorized" });
  if (userType !== "operator") {
    return reply.code(403).send({ error: "Only operators can view their referral codes" });
  }

  const codes = await request.db
    .select()
    .from(ReferralCodesTable)
    .where(eq(ReferralCodesTable.operatorId, userId));

  return reply.code(200).send({ codes });
}

async function getReferralCodeQR(request: FastifyRequest, reply: FastifyReply) {
  const { code } = request.params as { code: string };
  const { repType } = request.query as { repType?: "rep1" | "rep2" };

  const loggedUser: any = request.user;
  const userId = loggedUser?.id;
  const userType = loggedUser?.type;

  if (!userId) return reply.code(401).send({ error: "Unauthorized" });
  if (userType !== "operator") {
    return reply.code(403).send({ error: "Only operators can view referral codes" });
  }

  const [referralCode] = await request.db
    .select()
    .from(ReferralCodesTable)
    .where(and(eq(ReferralCodesTable.code, code), eq(ReferralCodesTable.operatorId, userId)));

  if (!referralCode) {
    return reply.code(404).send({ error: "Referral code not found" });
  }

  // Build referral URL
  let referralUrl: string;
  if (repType) {
    referralUrl = `/operator/join/representative/${referralCode.code}?repType=${repType}`;
  } else {
    referralUrl = `/operator/join/player/${referralCode.code}`;
  }

  const qrCodeDataUrl = await QRCode.toDataURL(referralUrl);

  return reply.code(200).send({
    referralCode,
    referralUrl,
    qrCode: qrCodeDataUrl,
  });
}

export default OperatorRoutePlugin;