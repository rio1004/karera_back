import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { FastifyPluginAsync } from "fastify";
import { db } from "../db/index.ts";
import { UserSessionTable } from "../db/schema.ts";
import { eq } from "drizzle-orm";

export async function postSession (request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return reply.code(400).send({ error: "Missing or invalid Authorization header" });
  }

  const token = authHeader.slice(7); // Remove "Bearer "

  try {
    // Decode JWT
    const decoded = request.server.jwt.decode(token) as {
      id?: string | number;
      userName?: string;
      email?: string;
    };

    if (!decoded || !decoded.id) {
      return reply.code(400).send({ error: "Invalid JWT payload: missing id" });
    }

    // Convert id safely to number
    const userId = typeof decoded.id === "string" ? parseInt(decoded.id, 10) : decoded.id;

    if (!userId || isNaN(userId)) {
      return reply.code(400).send({ error: "Invalid user id in token" });
    }

    // Remove old sessions for this user
    const existingSession = await db
      .select()
      .from(UserSessionTable)
      .where(eq(UserSessionTable.userId, userId));

    if (existingSession.length > 0) {
      await db.delete(UserSessionTable).where(eq(UserSessionTable.userId, userId));
    }

    // Create new session
    await db.insert(UserSessionTable).values({
      userId,
      token,
      deviceInfo: request.headers["user-agent"] || "unknown",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return reply.send({
      success: true,
      message: "User logged in successfully. Previous sessions logged out.",
    });
  } catch (err: any) {
    request.log.error(err);
    return reply.code(400).send({
      error: "Invalid JWT token",
      message: err.message,
    });
  }
}

const UserSessionRoutesPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Login or replace session
  fastify.post('/session', { schema: createSessionSchema }, postSession);

  // Logout
  fastify.post(
    "/session/logout",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authHeader = request.headers["authorization"];
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return reply.code(400).send({ error: "Missing or invalid Authorization header" });
      }

      const token = authHeader.slice(7);

      try {
        const decoded = request.server.jwt.decode(token) as { id?: string | number };
        if (!decoded || !decoded.id) {
          return reply.code(400).send({ error: "Invalid JWT payload: missing id" });
        }

        const userId = typeof decoded.id === "string" ? parseInt(decoded.id, 10) : decoded.id;

        if (!userId || isNaN(userId)) {
          return reply.code(400).send({ error: "Invalid user id in token" });
        }

        await db.delete(UserSessionTable).where(eq(UserSessionTable.userId, userId));

        return reply.send({
          success: true,
          message: "User logged out successfully.",
        });
      } catch (err: any) {
        request.log.error(err);
        return reply.code(400).send({
          error: "Invalid JWT token",
          message: err.message,
        });
      }
    }
  );
};

export const createSessionSchema = {
  description: "Schema for user token request",
  type: "object",
  required: ["userId", "token", "deviceInfo"],
  properties: {
    userId: {
      type: "integer",
      description: "Unique identifier of the user"
    },
    token: {
      type: "string",
      description: "JWT authentication token"
    },
    deviceInfo: {
      type: "string",
      description: "Device information string"
    }
  },
  additionalProperties: false
} as const;


export default UserSessionRoutesPlugin;
