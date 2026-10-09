import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { FastifyPluginAsync } from "fastify";
import { UsersTable, ReferralCodesTable, ReferralRepCodesTable, ReferralsTable } from "../db/schema.ts";
import { eq, and, or } from "drizzle-orm";
import { generateReferralCode, logReferralHistory } from "./utils/referral.ts";
import QRCode from "qrcode";
import { globalAuthentication } from "../app.ts";

const RepresentativeRoutePlugin: FastifyPluginAsync = async (server: FastifyInstance) => {
  globalAuthentication(server);

  // POST join
  server.post(
    "/representative/join/player/:code",
    { preHandler: server.authenticate, schema: joinViaRepUnifiedSchema },
    joinWithRepUnifiedHandler
  );
  server.post(
    "/representative/join/:code",
    { preHandler: server.authenticate, schema: joinViaRepUnifiedSchema },
    joinWithRepUnifiedHandler
  );

  server.post(
    "/representative/generate/code",
    { preHandler: server.authenticate, schema: generateRepCodeSchema },
    generateRepresentativeCode
  );

  server.get('/representative/codes', { preHandler: server.authenticate, schema: getReferralCodesSchema }, getReferralCodes);
  server.get('/representative/:code', { preHandler: server.authenticate, schema: getReferralCodeQRSchema }, getReferralCodeQR);

  // GET join (no body allowed)
  server.get(
    "/representative/join/player/:code",
    {
      preHandler: server.authenticate,
      schema: {
        tags: joinViaRepUnifiedSchema.tags,
        params: joinViaRepUnifiedSchema.params,
        querystring: joinViaRepUnifiedSchema.querystring,
        response: joinViaRepUnifiedSchema.response,
      },
    },
    joinWithRepUnifiedHandler
  );
  server.get(
    "/representative/join/:code",
    {
      preHandler: server.authenticate,
      schema: {
        tags: joinViaRepUnifiedSchema.tags,
        params: joinViaRepUnifiedSchema.params,
        querystring: joinViaRepUnifiedSchema.querystring,
        response: joinViaRepUnifiedSchema.response,
      },
    },
    joinWithRepUnifiedHandler
  );
};

interface GenerateRepCodeBody {
  referralCodeId: number; // the operator's referralCode this rep is attaching to
  target?: "player" | "representative"; // who will use this QR
}

// =================
// SCHEMAS
// =================
export const generateRepCodeSchema = {
  tags: ["Representative"],
  body: {
    type: "object",
    properties: {
      referralCodeId: { type: "number" },
      target: { type: "string", enum: ["player", "representative"], default: "player" }
    },
    required: ["referralCodeId"],
    additionalProperties: false,
  },
  response: {
    200: {
      type: "object",
      properties: {
        message: { type: "string" },
        referralRepCode: { type: "string" },
        joinUrl: { type: "string" },
        qrCode: { type: "string" }
      },
      required: ["message", "referralRepCode", "joinUrl", "qrCode"],
    },
  },
};

export const joinViaRepUnifiedSchema = {
  tags: ["Representative"],

  params: {
    type: "object",
    properties: {
      code: { type: "string" }, // rep’s referral code
    },
    required: ["code"],
  },

  querystring: {
    type: "object",
    properties: {
      target: { type: "string", enum: ["player", "rep2"] }, // optional override for GET
    },
    required: [],
  },

  body: {
    type: "object",
    properties: {
      target: { type: "string", enum: ["player", "rep2"] },
    },
    additionalProperties: false,
    required: [],
  },

  response: {
    200: {
      type: "object",
      properties: {
        message: { type: "string" },
        referral: { type: "object" },
      },
      required: ["message", "referral"],
      additionalProperties: true,
    },
  },
};

export const getReferralCodesSchema = {
  tags: ["Representative"],
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
              referralCodeId: { type: "number" }, // parent operator code
              repId: { type: "number" },
              repType: { type: "string", enum: ["rep1", "rep2"] },
              code: { type: "string" },
              recruitedUserId: { type: ["number", "null"] },
              createdAt: { type: "string", format: "date-time" },
              updatedAt: { type: "string", format: "date-time" },
            },
            required: ["id", "referralCodeId", "repId", "repType", "code"],
          },
        },
      },
      required: ["codes"],
    },
  },
};

export const getReferralCodeQRSchema = {
  tags: ["Representative"],
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
      target: { type: "string", enum: ["player", "rep2"] }, // default player
    },
    required: [],
  },
  response: {
    200: {
      type: "object",
      properties: {
        referralRepCode: {
          type: "object",
          properties: {
            id: { type: "number" },
            referralCodeId: { type: "number" },
            repId: { type: "number" },
            repType: { type: "string", enum: ["rep1", "rep2"] },
            code: { type: "string" },
            recruitedUserId: { type: ["number", "null"] },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
          required: ["id", "referralCodeId", "repId", "repType", "code"],
        },
        joinUrl: { type: "string" },
        qrCode: { type: "string" },
      },
      required: ["referralRepCode", "joinUrl", "qrCode"],
    },
  },
};

// =================
// HANDLERS
// =================
async function generateRepresentativeCode(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const body = request.body as GenerateRepCodeBody;
  const loggedUser: any = request.user;
  const userId = loggedUser?.id;
  const userType = loggedUser?.type;

  if (!userId) return reply.code(401).send({ error: "Unauthorized" });
  if (!["representative", "rep1", "rep2"].includes(userType)) {
    return reply.code(403).send({ error: "Only representatives can generate referral codes" });
  }

  // Validate operator referral code
  const [parentCode] = await request.db
    .select()
    .from(ReferralCodesTable)
    .where(eq(ReferralCodesTable.id, body.referralCodeId));

  if (!parentCode) return reply.code(400).send({ error: "Operator referral code not found" });

  // Validate rep is linked under this operator code
  const [connection] = await request.db
    .select()
    .from(ReferralsTable)
    .where(
      and(
        eq(ReferralsTable.referralCodeId, body.referralCodeId),
        or(
          eq(ReferralsTable.rep1Id, userId),
          eq(ReferralsTable.rep2Id, userId)
        )
      )
    );

  if (!connection) return reply.code(403).send({ error: "Representative not connected to this operator code" });

  // Determine repType from connection
  const repType = userType;

  // Generate unique rep referral code
  const repReferralCode = generateReferralCode(repType);

  // Insert into ReferralRepCodesTable
  const [referralRepCode] = await request.db
    .insert(ReferralRepCodesTable)
    .values({
      referralCodeId: parentCode.id,
      repId: userId,
      repType,
      code: repReferralCode,
      recruitedUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  // Build join URL dynamically using unified join system
  const target = body.target ?? "player"; // default to player
  const joinUrl =
    target === "player"
      ? `/representative/join/player/${referralRepCode.code}`
      : `/representative/join/${referralRepCode.code}?target=rep2`;

  // Generate QR code
  const qrCodeDataUrl = await QRCode.toDataURL(joinUrl);

  return reply.code(200).send({
    message: "Representative referral code generated successfully",
    referralRepCode: referralRepCode.code,
    joinUrl,
    qrCode: qrCodeDataUrl,
  });
}

async function joinWithRepUnifiedHandler(request: FastifyRequest, reply: FastifyReply) {
  const { code } = request.params as { code: string };
  const loggedUser: any = request.user;
  const userId = loggedUser?.id;
  const userType = loggedUser?.type;

  if (!userId) return reply.code(401).send({ error: "Unauthorized" });

  // Merge target from body or query
  const { target: targetQuery } = request.query as { target?: "player" | "rep2" };
  const { target: targetBody } = (request.body ?? {}) as { target?: "player" | "rep2" };
  const target = targetQuery || targetBody;

  if (!target) return reply.code(400).send({ error: "Target must be specified (player or rep2)" });

  // Find rep referral code
  const [repCode] = await request.db
    .select()
    .from(ReferralRepCodesTable)
    .where(eq(ReferralRepCodesTable.code, code));

  if (!repCode) return reply.code(400).send({ error: "Invalid representative referral code" });

  // Find parent operator code
  const [parentCode] = await request.db
    .select()
    .from(ReferralCodesTable)
    .where(eq(ReferralCodesTable.id, repCode.referralCodeId));

  if (!parentCode) return reply.code(400).send({ error: "Parent operator referral code not found" });

  // Find existing referral row
  const [existingReferral] = await request.db
    .select()
    .from(ReferralsTable)
    .where(eq(ReferralsTable.referralCodeId, parentCode.id));

  if (!existingReferral) return reply.code(400).send({ error: "No referral row exists for this operator" });

  const updateData: any = { updatedAt: new Date() };

  if (target === "player") {
    const [existingPlayer] = await request.db
      .select()
      .from(ReferralsTable)
      .where(eq(ReferralsTable.playerId, userId));
  
    if (existingPlayer) {
      return reply.code(400).send({ error: "Player already joined elsewhere" });
    }
  
    if (existingReferral.playerId) {
      // player slot already filled for THIS operator
      // 👉 instead of blocking, insert a new row
      const insertData: any = {
        referralCodeId: parentCode.id,
        operatorId: parentCode.operatorId,
        playerId: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
  
      if (repCode.repType === "rep1") {
        insertData.rep1Id = repCode.repId;
      }
      if (repCode.repType === "rep2") {
        insertData.rep1Id = existingReferral.rep1Id;
        insertData.rep2Id = repCode.repId;
      }
  
      const [newReferral] = await request.db
        .insert(ReferralsTable)
        .values(insertData)
        .returning();
      
      // log history
      await logReferralHistory(request.db, {
        referralId: parentCode.id,
        action: `player_joined`,
        userId,
        details: `Joined via code ${code}`,
      });
  
      await request.db
        .update(ReferralRepCodesTable)
        .set({ recruitedUserId: userId, updatedAt: new Date() })
        .where(eq(ReferralRepCodesTable.id, repCode.id));
  
      return reply.code(200).send({
        message: "Player successfully joined (new row created)",
        referral: newReferral,
      });
    }
  
    // Normal path: update the existing row if empty
    updateData.playerId = userId;
  }  

  if (target === "rep2") {
    if (userType !== "rep2" && userType !== "player") {
      return reply.code(400).send({ error: "Only players or rep2 can join as rep2" });
    }
  
    // if user is a player, upgrade them to rep2
    if (userType === "player") {
      await request.db
        .update(UsersTable)
        .set({ type: "rep2", updatedAt: new Date() })
        .where(eq(UsersTable.id, userId));
    }
  
    let newReferral;
  
    if (existingReferral.rep2Id) {
      // Instead of blocking, insert a new row
      const insertData: any = {
        referralCodeId: parentCode.id,
        operatorId: parentCode.operatorId,
        rep1Id: existingReferral.rep1Id,
        rep2Id: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
  
      [newReferral] = await request.db
        .insert(ReferralsTable)
        .values(insertData)
        .returning();
    } else {
      // Normal case: assign rep2 to existing row
      updateData.rep2Id = userId;
      await request.db
        .update(ReferralsTable)
        .set(updateData)
        .where(eq(ReferralsTable.id, existingReferral.id));
  
      [newReferral] = await request.db
        .select()
        .from(ReferralsTable)
        .where(eq(ReferralsTable.id, existingReferral.id));
    }
  
    // ✅ generate a referral code for this new rep2
    const rep2Code = generateReferralCode("rep2");
    const [rep2ReferralCode] = await request.db
      .insert(ReferralRepCodesTable)
      .values({
        referralCodeId: parentCode.id,
        repId: userId,
        repType: "rep2",
        code: rep2Code,
        recruitedUserId: null,
        target: "player", // default target for rep2 codes
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
  
    // log history
    await logReferralHistory(request.db, {
      referralId: parentCode.id,
      action: `${target}_joined`,
      userId,
      details: `Joined via code ${code}`,
    });
  
    await request.db
      .update(ReferralRepCodesTable)
      .set({ recruitedUserId: userId, updatedAt: new Date() })
      .where(eq(ReferralRepCodesTable.id, repCode.id));
  
    return reply.code(200).send({
      message: "Rep2 successfully joined and code generated",
      referral: newReferral,
      referralCode: rep2ReferralCode, // ✅ return the generated rep2 code
    });
  }  

  // Update referral
  await request.db
    .update(ReferralsTable)
    .set(updateData)
    .where(eq(ReferralsTable.id, existingReferral.id));

  // Update recruited user in rep code table
  await request.db
    .update(ReferralRepCodesTable)
    .set({ recruitedUserId: userId, updatedAt: new Date() })
    .where(eq(ReferralRepCodesTable.id, repCode.id));

  // Fetch updated referral
  const [updatedReferral] = await request.db
    .select()
    .from(ReferralsTable)
    .where(eq(ReferralsTable.id, existingReferral.id));

  return reply.code(200).send({
    message: target === "player"
      ? "Player successfully joined"
      : "Representative successfully recruited",
    referral: updatedReferral,
  });
}

async function getReferralCodes(request: FastifyRequest, reply: FastifyReply) {
  const loggedUser: any = request.user;
  const userId = loggedUser?.id;
  const userType = loggedUser?.type;

  if (!userId) return reply.code(401).send({ error: "Unauthorized" });
  if (!["representative", "rep1", "rep2"].includes(userType)) {
    return reply.code(403).send({ error: "Only representatives can view their referral codes" });
  }

  const codes = await request.db
    .select()
    .from(ReferralRepCodesTable)
    .where(eq(ReferralRepCodesTable.repId, userId));

  return reply.code(200).send({ codes });
}

async function getReferralCodeQR(request: FastifyRequest, reply: FastifyReply) {
  const { code } = request.params as { code: string };
  const { target } = request.query as { target?: "player" | "rep2" };

  const loggedUser: any = request.user;
  const userId = loggedUser?.id;
  const userType = loggedUser?.type;

  if (!userId) return reply.code(401).send({ error: "Unauthorized" });
  if (!["representative", "rep1", "rep2"].includes(userType)) {
    return reply.code(403).send({ error: "Only representatives can view referral codes" });
  }

  const [referralRepCode] = await request.db
    .select()
    .from(ReferralRepCodesTable)
    .where(and(eq(ReferralRepCodesTable.code, code), eq(ReferralRepCodesTable.repId, userId)));

  if (!referralRepCode) {
    return reply.code(404).send({ error: "Representative referral code not found" });
  }

  // Build join URL (defaults to player if target not specified)
  const joinUrl =
    target === "rep2"
      ? `/representative/join/${referralRepCode.code}?target=rep2`
      : `/representative/join/player/${referralRepCode.code}`;

  const qrCodeDataUrl = await QRCode.toDataURL(joinUrl);

  return reply.code(200).send({
    referralRepCode,
    joinUrl,
    qrCode: qrCodeDataUrl,
  });
}

export default RepresentativeRoutePlugin;