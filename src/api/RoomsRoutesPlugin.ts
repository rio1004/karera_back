import {FastifyInstance, FastifyReply, FastifyRequest} from 'fastify';
import {FastifyPluginAsync} from 'fastify';
import {GamesTable, RoomsTable, StudiosTable, UsersTable, UserSessionTable} from '../db/schema.ts';
import {eq, and, isNull, desc, sql, ne} from 'drizzle-orm';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import * as schema from "../db/schema.ts";
import { globalAuthentication } from '../app.ts';

const RoomRoutesPlugin: FastifyPluginAsync = async (server: FastifyInstance) => {
  globalAuthentication(server);

  server.post('/rooms', {preHandler: server.authenticate, schema: createRoomSchema}, createRoom);
  server.get('/rooms', {preHandler: server.authenticate, schema: getAllRoomsSchema}, getAllRooms);
  server.get('/rooms/:id', {preHandler: server.authenticate, schema: getRoomSchema}, getRoomById);
  server.patch('/rooms/:id', {preHandler: server.authenticate, schema: updateRoomSchema}, updateRoom);
  server.get('/studios', {preHandler: server.authenticate, schema: getAllStudiosSchema}, getAllStudios);
  server.get('/room/session/:id', {preHandler: server.authenticate, schema: getRoomSessionSchema }, getRoomSession);
};

declare module 'fastify' {
  interface FastifyRequest {
    db: NodePgDatabase<typeof schema>;
  }
}

interface RoomRequestBody {
  gameId: string;
  hostId?: number | null;
  studioNo: string;
  status: string;
}

const roomProperties = {
  id: {type: 'number'},
  gameId: {type: 'number'},
  hostId: {type: 'number', nullable: true},
  hostName: { type: "string", nullable: true },
  status: { type: "string", enum: ["open", "occupied", "closed"] },
  studioNo: {type: 'string'},
  createdAt: {type: 'string', format: 'date-time'},
  updatedAt: {type: 'string', format: 'date-time'},
  deletedAt: {type: 'string', format: 'date-time', nullable: true}
};

const studioProperties = {
  id: { type: "number" },
  studioNo: { type: "string" },
  createdAt: { type: "string", format: "date-time" },
  updatedAt: { type: "string", format: "date-time" },
  deletedAt: { type: "string", format: "date-time", nullable: true },
};

const createRoomSchema = {
  description: 'Create a new game room session.',
  tags: ['room'],
  body: {
    type: 'object',
    required: ['gameId', "studioNo"],
    properties: {
      gameId: {type: 'number'},
      hostId: {type: ['number','null']},
      studioNo: { type: "string", enum: ["DL01", "DL02", "DL03", "DL04", "DL05"], },
    }
  },
  response: {
    201: {
      type: 'object',
      properties: {
        room: {type: 'object', properties: roomProperties}
      }
    },
    409: {
      type: 'object',
      properties: {error: {type: 'string'}}
    }
  }
};

const getAllRoomsSchema = {
  description: 'Get all rooms.',
  tags: ['room'],
  querystring: {
    type: 'object',
    properties: {
      limit: {type: 'integer', minimum: 1, default: 10},
      offset: {type: 'integer', minimum: 0, default: 0},
      status: { type: 'string', enum: ['open','occupied','closed'] }
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        rooms: {type: 'array', items: {type: 'object', properties: roomProperties}},
        limit: {type: 'integer'},
        offset: {type: 'integer'}
      }
    }
  }
};

const getRoomSchema = {
  description: 'Get room by ID.',
  tags: ['room'],
  response: {
    200: {type: 'object', properties: {room: {type: 'object', properties: roomProperties}}},
    404: {type: 'object', properties: {error: {type: 'string'}}}
  }
};

const updateRoomSchema = {
  description: `Update room by ID. You have full control over the room status and host. 
  <br> If you want to remove the host, set hostId empty string.`,
  tags: ['room'],
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: {type: 'number'}
    }
  },
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      gameId: {type: 'number'},
      hostId: {type: 'number', nullable: true},
      status: { type: "string", enum: ["open", "occupied", "closed"] },
    }
  },
  response: {
    200: {type: 'object', properties: {room: {type: 'object', properties: roomProperties}}},
    404: {type: 'object', properties: {error: {type: 'string'}}}
  }
};

const getAllStudiosSchema = {
  description: "Get all studios.",
  tags: ["studio"],
  querystring: {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, default: 10 },
      offset: { type: "integer", minimum: 0, default: 0 },
    },
  },
  response: {
    200: {
      type: "object",
      properties: {
        studios: { type: "array", items: { type: "object", properties: studioProperties } },
        limit: { type: "integer" },
        offset: { type: "integer" },
      },
    },
  },
};


const getRoomSessionSchema = {
  description: "Get a room by ID",
  tags: ["rooms"],
  params: {
    type: "object",
    properties: {
      id: { type: "string"},
    },
    required: ["id"],
  },
  response: {
    200: {
      type: "object",
      properties: {
        roomId: { type: "number" },
        room: {
          type: "object",
          properties: {
            id: { type: "number" },
            status: { type: "string", enum: ["open", "occupied", "closed"] },
            game: { type: "object", nullable: true, properties: { id: { type: "number" }, name: { type: "string" } } },
            host: { type: "object", nullable: true, properties: { id: { type: "number" }, hostName: { type: "string" } } },
            studio: { type: "object", nullable: true, properties: { studioNo: { type: "string" } } },
          },
        },
      },
    },
    404: { type: "object", properties: { error: { type: "string" } } },
    500: { type: "object", properties: { error: { type: "string" } } },
  },
};


async function createRoom(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { gameId, hostId, studioNo } = request.body as {gameId: number, hostId: number, studioNo: string};
    const authUserId = request.user.id;

    const studio = await request.db.query.StudiosTable.findFirst({
      where: and(eq(StudiosTable.studioNo, studioNo.toString()), isNull(StudiosTable.deletedAt)),
    });
    if (!studio) return reply.code(404).send({ error: "Studio not found or inactive" });

    let hostUser: { id: number; userName: string } | null = null;
    if (hostId != null) {
      hostUser = await request.db.query.UsersTable.findFirst({
        where: (u, { and, eq }) => and(eq(u.id, hostId), eq(u.type, "host")),
      });
      if (!hostUser) return reply.code(404).send({ error: "Host user not found or not a host" });
    }

    const [room] = await request.db.insert(RoomsTable).values({
      gameId: gameId,
      hostId: hostUser?.id ?? null,
      studioNo: studioNo,
      createdByUserId: authUserId
    }).returning()

    return reply.code(201).send({
      room: {
        ...room,
        hostName: hostUser?.userName ?? null,
      },
    });
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: "Internal server error" });
  }
}

async function getAllRooms(request: FastifyRequest, reply: FastifyReply) {
  try {
    const {limit = 10, offset = 0, status} = request.query as any;

    const rows = await request.db
      .select({ room: RoomsTable })
      .from(RoomsTable)
      .where(status ? eq(RoomsTable.status, status) : undefined)
      .limit(+limit).offset(+offset);
    const rooms = rows.map(({ room }) => ({
      ...room
    }));
    return reply.code(200).send({rooms, limit: +limit, offset: +offset});
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({error: 'Internal server error'});
  }
}

async function getRoomById(request: FastifyRequest, reply: FastifyReply) {
  try {
    const {id} = request.params as { id: number };
    const room = await request.db.query.RoomsTable.findFirst({
      where: (r, { eq }) => eq(r.id, Number(id)),
    });
    if (!room) {
       return reply.code(404).send({error: 'Room not found'});
     }

    return reply.code(200).send({room});
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({error: 'Internal server error'});
  }
}

async function updateRoom(request: FastifyRequest, reply: FastifyReply) {
  try {
    const {id} = request.params as { id: number };
    const updates = request.body as Partial<RoomRequestBody>;

    const updated = await request.db.update(RoomsTable)
      .set({ gameId: Number(updates.gameId), hostId: Number(updates.hostId), status: updates.status as "open" | "occupied" | "closed", studioNo: updates.studioNo as string })
      .where(and(eq(RoomsTable.id, Number(id)), isNull(RoomsTable.deletedAt)))
      .returning();

    if (!updated.length) {
      return reply.code(404).send({error: 'Room not found'});
    }
    return reply.code(200).send({room: updated[0]});
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({error: 'Internal server error'});
  }
}

async function getAllStudios(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { limit = 10, offset = 0 } = request.query as any;

    const studios = await request.db
      .select()
      .from(StudiosTable)
      .limit(limit)
      .offset(offset);

    return reply.code(200).send({ studios, limit, offset });
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: "Internal server error" });
  }
}

async function getRoomSession(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = request.params as { id: string };
    
    const [room] = await request.db
      .select({
        id: RoomsTable.id,
        status: RoomsTable.status,
        game: {
          id: GamesTable.id,
          name: GamesTable.name,
        },
        host: {
          id: UsersTable.id,
          hostName: sql<string>`concat(${UsersTable.firstName}, ' ', ${UsersTable.lastName})`,
        },
        studio: {
          studioNo: StudiosTable.studioNo,
        },
      })
      .from(RoomsTable)
      .leftJoin(GamesTable, eq(RoomsTable.gameId, GamesTable.id))
      .leftJoin(UsersTable, eq(RoomsTable.hostId, UsersTable.id))
      .leftJoin(StudiosTable, eq(RoomsTable.studioNo, StudiosTable.studioNo))
      .where(eq(RoomsTable.id, id))
      .limit(1);
    
    if (!room) {
      return reply.code(404).send({ error: `Room with id ${id} not found` });
    }
    
    return reply.code(200).send({ roomId: room.id, room });
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: "Internal server error" });
  }
}

export default RoomRoutesPlugin;