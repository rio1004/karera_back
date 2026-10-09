import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { FastifyPluginAsync } from 'fastify';
import { HostTable, LikeTable } from '../db/schema.ts';
import { eq, isNull, and } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema.ts';

declare module 'fastify' {
  interface FastifyRequest {
    db: NodePgDatabase<typeof schema>;
  }
}

interface HostBody {
  name: string;
  location?: string;
  birthDate?: string; // ISO date string
  zodiac?: string;
  talent?: string;
}

const hostProperties = {
  id: { type: 'number'},
  name: { type: 'string' },
  location: { type: 'string', nullable: true },
  birthdDate: { type: 'string', format: 'date', nullable: true },
  zodiac: { type: 'string', nullable: true },
  talent: { type: 'string', nullable: true },
  createdAt: { type: 'string', format: 'date-time' },
  updatedAt: { type: 'string', format: 'date-time' },
  deletedAt: { type: 'string', format: 'date-time', nullable: true }
};

const likeHostSchema = {
  description: "Like a host by userId. This will add a new row in likes table.",
  tags: ["like"],
  body: {
    type: "object",
    required: ["userId", "hostId"],
    properties: {
      userId: { type: "string" },
      hostId: { type: "string" }
    }
  },
  response: {
    201: {
      type: "object",
      properties: {
        like: {
          type: "object",
          properties: {
            id: { type: 'number'},
            userId: { type: 'number'},
            hostId: { type: 'number'},
            createdAt: { type: "string", format: "date-time" }
          }
        }
      }
    },
    409: {
      type: "object",
      properties: { error: { type: "string" } }
    }
  }
};

const deleteLikeSchema = {
  description: "Unlike a host (delete the like row in likes table).",
  tags: ["like"],
  body: {
    type: "object",
    required: ["userId", "hostId"],
    properties: {
      userId: { type: "string" },
      hostId: { type: "string" }
    }
  },
  response: {
    200: {
      type: "object",
      properties: { success: { type: "boolean" }, message: { type: "string" } }
    },
    404: {
      type: "object",
      properties: { error: { type: "string" } }
    }
  }
};

const checkLikeSchema = {
  description: "Check if the  user already liked the host. Will return a boolean if liked or not.",
  tags: ["like"],
  params: {
    type: "object",
    required: ["userId", "hostId"],
    properties: {
      userId: { type: "string" },
      hostId: { type: "string" }
    }
  },
  response: {
    200: {
      type: "object",
      properties: {
        liked: { type: "boolean" }
      }
    }
  }
};

const createHostSchema = {
  description: 'Create a new host.',
  tags: ['host'],
  body: {
    type: 'object',
    required: ['name', 'location', 'birthDate', 'zodiac', 'talent'],
    properties: {
      name: { type: 'string' },
      location: { type: 'string' },
      birthDate: { type: 'string', format: 'date' },
      zodiac: { type: 'string' },
      talent: { type: 'string' }
    }
  },
  response: {
    201: {
      type: 'object',
      properties: { host: { type: 'object', properties: hostProperties } }
    },
    409: {
      type: 'object',
      properties: { error: { type: 'string' } }
    }
  }
};

const getAllHostsSchema = {
  description: 'Get all hosts.',
  tags: ['host'],
  querystring: {
    type: 'object',
    properties: {
      limit: { type: 'integer', minimum: 1, default: 10 },
      offset: { type: 'integer', minimum: 0, default: 0 }
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        hosts: { type: 'array', items: { type: 'object', properties: hostProperties } },
        limit: { type: 'integer' },
        offset: { type: 'integer' }
      }
    }
  }
};

const getHostSchema = {
  description: 'Get host by ID.',
  tags: ['host'],
  response: {
    200: { type: 'object', properties: { host: { type: 'object', properties: hostProperties } } },
    404: { type: 'object', properties: { error: { type: 'string' } } }
  }
};

const updateHostSchema = {
  description: 'Update host by ID.',
  tags: ['host'],
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'number' } }
  },
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string' },
      location: { type: 'string' },
      birthDate: { type: 'string', format: 'date' },
      zodiac: { type: 'string' },
      talent: { type: 'string' }
    }
  },  
  response: {
    200: { type: 'object', properties: { host: { type: 'object', properties: hostProperties } } },
    404: { type: 'object', properties: { error: { type: 'string' } } }
  }
};

const deleteHostSchema = {
  description: 'Soft delete host by ID.',
  tags: ['host'],
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'number' } }
  },
  response: {
    204: { type: 'null' },
    404: { type: 'object', properties: { error: { type: 'string' } } }
  }
};

const HostRoutesPlugin: FastifyPluginAsync = async (server: FastifyInstance) => {
  server.post('/hosts', { schema: createHostSchema }, createHost);
  server.get('/hosts', { schema: getAllHostsSchema }, getAllHosts);
  server.get('/hosts/:id', { schema: getHostSchema }, getHostById);
  server.patch('/hosts/:id', { schema: updateHostSchema }, updateHost);
  server.delete('/hosts/:id', { schema: deleteHostSchema }, deleteHost);

  server.post('/likehost', { schema: likeHostSchema }, likeHost);
  server.delete("/likehost", { schema: deleteLikeSchema }, deleteLike);
  server.get("/likehost/:userId/:hostId", { schema: checkLikeSchema }, checkLike);
};

async function likeHost(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { userId, hostId } = request.body as { userId: string; hostId: string };

    // Check if already liked
    const existing = await request.db.query.LikeTable.findFirst({
      where: (like, { eq }) => and(eq(like.userId, userId), eq(like.hostId, hostId))
    });

    if (existing) {
      return reply.code(409).send({ error: "Host already liked by this user" });
    }

    const like = await request.db.insert(LikeTable)
      .values({ userId, hostId })
      .returning();

    return reply.code(201).send({ like: like[0] });
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: "Internal server error" });
  }
}

// ❌ Unlike (delete row)
async function deleteLike(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { userId, hostId } = request.body as { userId: string; hostId: string };

    const deleted = await request.db.delete(LikeTable)
      .where(and(eq(LikeTable.userId, userId), eq(LikeTable.hostId, hostId)))
      .returning();

    if (!deleted.length) {
      return reply.code(404).send({ error: "Like not found" });
    }

    return reply.code(200).send({ success: true, message: "Host unliked successfully" });
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: "Internal server error" });
  }
}

// 🔍 Check if user already liked a host
async function checkLike(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { userId, hostId } = request.params as { userId: string; hostId: string };

    const existing = await request.db.query.LikeTable.findFirst({
      where: (like, { eq }) => and(eq(like.userId, userId), eq(like.hostId, hostId))
    });

    return reply.code(200).send({ liked: !!existing });
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: "Internal server error" });
  }
}



async function createHost(request: FastifyRequest<{ Body: HostBody }>, reply: FastifyReply) {
  try {
    const { name, location, birthDate, zodiac, talent } = request.body;

    const existing = await request.db.query.HostTable.findFirst({
      where: (host, { eq, isNull }) =>
        and(eq(host.name, name), isNull(host.deletedAt))
    });

    if (existing) {
      return reply.code(409).send({ error: 'Host name already exists.' });
    }

    const host = await request.db.insert(HostTable)
    .values({ name, location, birthDate, zodiac, talent })
    .returning();

    return reply.code(201).send({ host: host[0] });
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: 'Internal server error' });
  }
}

async function getAllHosts(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { limit = 10, offset = 0 } = request.query as any;
    const hosts = await request.db.select().from(HostTable)
      .where(isNull(HostTable.deletedAt))
      .limit(limit).offset(offset);

    return reply.code(200).send({ hosts, limit, offset });
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: 'Internal server error' });
  }
}

async function getHostById(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = request.params as { id: string };
    const host = await request.db.query.HostTable.findFirst({
      where: (host, { eq, isNull }) => and(eq(host.id, id), isNull(host.deletedAt))
    });

    if (!host) {
      return reply.code(404).send({ error: 'Host not found' });
    }

    return reply.code(200).send({ host });
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: 'Internal server error' });
  }
}

async function updateHost(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = request.params as { id: string };
    const updates = request.body as Partial<HostBody>;

    const updated = await request.db.update(HostTable)
      .set(updates)
      .where(and(eq(HostTable.id, id), isNull(HostTable.deletedAt)))
      .returning();

    if (!updated.length) {
      return reply.code(404).send({ error: 'Host not found' });
    }

    return reply.code(200).send({ host: updated[0] });
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: 'Internal server error' });
  }
}

async function deleteHost(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = request.params as { id: string };

    const updated = await request.db.update(HostTable)
      .set({ deletedAt: new Date() })
      .where(and(eq(HostTable.id, id), isNull(HostTable.deletedAt)))
      .returning();

    if (!updated.length) {
      return reply.code(404).send({ error: 'Host not found' });
    }

    return reply.code(204).send();
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: 'Internal server error' });
  }
}

export default HostRoutesPlugin;