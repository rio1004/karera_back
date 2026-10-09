// routes/messages.ts
import { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { EmailTable, UserSessionTable } from "../../src/db/schema.ts"; 
import { error_response_schema_400, error_response_schema_401, error_response_schema_404, error_response_schema_500 } from './utils/schemaUtils.ts';
import { eq, desc, sql } from "drizzle-orm";
import { globalAuthentication } from "../app.ts";

const messagesRoutes: FastifyPluginAsync = async (server: FastifyInstance, opts) => {
  globalAuthentication(server);
  // GET /messages/:userId
  server.get('/email/:id', { preHandler: server.authenticate, schema: getEmailSchema }, getEmailHandler);
  // DELETE /email/:id (Soft delete)
  server.delete('/email/:id', { preHandler: server.authenticate, schema: deleteEmailSchema }, deleteEmailHandler);
  // PATCH /email/:id/status (Mark as read)
  server.patch('/email/:id/status', { preHandler: server.authenticate, schema: patchEmailStatusSchema }, patchEmailStatusHandler);
};

export const getEmailSchema = {
  description: "Get all emails received by a user",
  tags: ["Emails"],
  params: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string" }
    }
  },
  response: {
    200: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        data: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              userId: { type: "string" },
              subject: { type: "string" },
              body: { type: "string" },
              status: { type: "string", enum: ["unread", "read"] },
              createdAt: { type: "string", format: "date-time" }
            }
          }
        }
      }
    },
    400: error_response_schema_400,
    500: error_response_schema_500
  }
};

export const deleteEmailSchema = {
  description: "Soft delete an email (set deletedAt timestamp instead of removing)",
  tags: ["Emails"],
  params: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string" }
    }
  },
  response: {
    200: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        message: { type: "string" }
      }
    },
    400: error_response_schema_400,
    401: error_response_schema_401,
    404: error_response_schema_404,
    500: error_response_schema_500
  }
};

export const patchEmailStatusSchema = {
  description: "Update an email's status to read",
  tags: ["Emails"],
  params: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string" }
    }
  },
  response: {
    200: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        message: { type: "string" }
      }
    },
    400: error_response_schema_400,
    401: error_response_schema_401,
    404: error_response_schema_404,
    500: error_response_schema_500
  }
};

export async function getEmailHandler( request: FastifyRequest, reply: FastifyReply ) {
  try {
    const { id } = request.params as { id: string };

    const messages = await request.db
      .select()
      .from(EmailTable)
      .where(eq(EmailTable.userId, id))
      .orderBy(desc(EmailTable.createdAt));

    return reply.send({
      success: true,
      data: messages,
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      success: false,
      message: "Failed to fetch emails",
    });
  }
}

export async function deleteEmailHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = request.params as { id: string };

    const result = await request.db
      .update(EmailTable)
      .set({ deletedAt: sql`NOW()` })
      .where(eq(EmailTable.id, id));

    if (result.rowCount === 0) {
      return reply.status(404).send({
        success: false,
        message: "Email not found",
      });
    }

    return reply.send({
      success: true,
      message: "Email deleted successfully (soft delete)",
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      success: false,
      message: "Failed to delete email",
    });
  }
}

export async function patchEmailStatusHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = request.params as { id: string };

    const result = await request.db
      .update(EmailTable)
      .set({ status: "read" })
      .where(eq(EmailTable.id, id));

    if (result.rowCount === 0) {
      return reply.status(404).send({
        success: false,
        message: "Email not found",
      });
    }

    return reply.send({
      success: true,
      message: "Email marked as read",
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      success: false,
      message: "Failed to update email status",
    });
  }
}


export default messagesRoutes;
