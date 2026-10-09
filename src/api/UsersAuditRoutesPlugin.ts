import { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { AdminTrailTable, UsersTable } from "../db/schema.ts";
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.ts";

declare module "fastify" {
  interface FastifyRequest {
    db: NodePgDatabase<typeof schema>;
  }
}

const UsersAuditRoutesPlugin: FastifyPluginAsync = async (server: FastifyInstance) => {
  server.get("/users-audit", { schema: getAllAuditSchema }, getAllAudits);
  server.get("/users-audit/:userId", { schema: getUserAuditSchema }, getUserAuditsByUserId);
  server.post("/users-audit", { schema: createAuditSchema }, createAudit);
};

const getAllAuditSchema = {
  description: "Get all user audit records (with user full name)",
  tags: ["Users Audit"],
  querystring: {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, default: 50 },
      offset: { type: "integer", minimum: 0, default: 0 }
    }
  }
};

const getUserAuditSchema = {
  description: "Get audit records for a specific user (with full name)",
  tags: ["Users Audit"],
  params: {
    type: "object",
    required: ["userId"],
    properties: { userId: { type: "string" } }
  }
};

const createAuditSchema = {
  description: "Create a new admin audit record",
  tags: ["Users Audit"],
  body: {
    type: "object",
    required: ["userId", "meta"],
    properties: {
      userId: { type: "number" },
      meta: {
        type: "object",
        required: ["Timestamp", "User", "ActionType", "Module", "Target"],
        properties: {
          Timestamp: { type: "string", format: "date-time" },
          User: { type: "string" },
          ActionType: { type: "string" },
          Module: { type: "string" },
          Target: { type: "string" }
        }
      }
    }
  }
};

async function getAllAudits(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { limit = 50, offset = 0 } = request.query as any;

    // Count total rows separately
    const totalRowsResult = await request.db
      .select({ count: sql<number>`count(*)` })
      .from(AdminTrailTable);
    const totalRows = Number(totalRowsResult[0]?.count ?? 0);


    const audits = await request.db
      .select({
        id: AdminTrailTable.id,
        userId: AdminTrailTable.userId,
        meta: AdminTrailTable.meta,
        createdAt: AdminTrailTable.createdAt,
        fullName: sql<string>`concat(${UsersTable.firstName}, ' ', ${UsersTable.lastName})`
      })
      .from(AdminTrailTable)
      .leftJoin(UsersTable, eq(AdminTrailTable.userId, UsersTable.id))
      .limit(limit)
      .offset(offset);

    return reply.code(200).send({ audits, limit, offset, totalRows });
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: "Internal server error" });
  }
}

async function getUserAuditsByUserId(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { userId } = request.params as { userId: string };

    const audits = await request.db
      .select({
        id: AdminTrailTable.id,
        userId: AdminTrailTable.userId,
        meta: AdminTrailTable.meta,
        createdAt: AdminTrailTable.createdAt,
        fullName: sql<string>`concat(${UsersTable.firstName}, ' ', ${UsersTable.lastName})`
      })
      .from(AdminTrailTable)
      .leftJoin(UsersTable, eq(AdminTrailTable.userId, UsersTable.id))
      .where(eq(AdminTrailTable.userId, userId));

    if (!audits.length) {
      return reply.code(404).send({ error: "No audits found for this user" });
    }

    return reply.code(200).send({ audits });
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: "Internal server error" });
  }
}

async function createAudit(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { userId, meta } = request.body as {
      userId: number;
      meta: {
        Timestamp: string;
        User: string;
        ActionType: string;
        Module: string;
        Target: string;
      };
    };

    const [inserted] = await request.db
      .insert(AdminTrailTable)
      .values({
        userId,
        meta
      })
      .returning();

    return reply.code(201).send({ audit: inserted });
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: "Internal server error" });
  }
}

export default UsersAuditRoutesPlugin;
