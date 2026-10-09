import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db/index.ts";
import { BadgesTable } from "../db/schema.ts";
import { eq } from "drizzle-orm";

const badgesRoutes = async (fastify: FastifyInstance) => {
  // Create Badge
  fastify.post("/badges", async (request: FastifyRequest<{ Body: {
    userId: number;
    type: "VIP" | "FRONT_RUNNER" | "LOYALTY" | "MASTER_GIVER";
    meta: { description: string; duration: string; color: string };
  }}>, reply: FastifyReply) => {
    const { userId, type, meta } = request.body;

    const [badge] = await db.insert(BadgesTable).values({
      userId,
      type,
      meta
    }).returning();

    reply.send(badge);
  });

  // Get all badges for a user
  fastify.get("/badges/:userId", async (request: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) => {
    const badges = await db.select().from(BadgesTable).where(eq(BadgesTable.userId, Number(request.params.userId)));
    reply.send(badges);
  });

  // Delete a badge
  fastify.delete("/badges/:id", async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    await db.delete(BadgesTable).where(eq(BadgesTable.id, Number(request.params.id)));
    reply.send({ success: true });
  });
};

export default badgesRoutes;
