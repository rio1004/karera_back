// src/routes/attendance.ts

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { FastifyPluginAsync } from 'fastify';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import * as schema from '../db/schema.ts';
import { error_response_schema_400, error_response_schema_401, error_response_schema_500 } from './utils/schemaUtils.ts';
import { UserSessionTable } from '../db/schema.ts';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    db: NodePgDatabase<typeof schema>;
  }
  interface FastifyRequest {
    db: NodePgDatabase<typeof schema>;
  }
}

// --- SCHEMAS ---
const attendanceSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    userId: { type: 'string', format: 'uuid' },
    date: { type: 'string', format: 'date' },
    checkIn: { type: ['string', 'null'], format: 'time' },
    checkOut: { type: ['string', 'null'], format: 'time' },
    totalHours: { type: 'number' },
    payableHours: { type: 'number' },
    status: { type: 'string', enum: ['Present', 'Rest Day'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
};

const createAttendanceSchema = {
  description: 'Create attendance record',
  tags: ['Attendance'],
  body: {
    type: 'object',
    required: ['userId', 'date'],
    properties: {
      userId: { type: 'string', format: 'uuid' },
      date: { type: 'string', format: 'date' },
      checkIn: { type: ['string', 'null'], format: 'date-time' },
      checkOut: { type: ['string', 'null'], format: 'date-time' }
    }
  },
  response: {
    201: attendanceSchema,
    400: error_response_schema_400,
    401: error_response_schema_401,
    500: error_response_schema_500
  }
};

const getAllAttendanceSchema = {
  description: 'Get all attendance records',
  tags: ['Attendance'],
  querystring: {
    type: 'object',
    properties: {
      limit: { type: 'integer', minimum: 1, default: 100 },
      offset: { type: 'integer', minimum: 0, default: 0 },
      startDate: { type: 'string', format: 'date' },
      endDate: { type: 'string', format: 'date' },
      userId: { type: 'string', format: 'uuid' }
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        totalRows: { type: 'integer' },
        limit: { type: 'integer' },
        offset: { type: 'integer' },
        records: { type: 'array', items: attendanceSchema }
      }
    }
  }
};


const getAttendanceByUserSchema = {
  description: 'Get attendance records by userId',
  tags: ['Attendance'],
  params: {
    type: 'object',
    properties: {
      userId: { type: 'string', format: 'uuid' }
    },
    required: ['userId']
  },
  querystring: {
    type: 'object',
    properties: {
      limit: { type: 'integer', minimum: 1, default: 100 },
      offset: { type: 'integer', minimum: 0, default: 0 },
      startDate: { type: 'string', format: 'date' },
      endDate: { type: 'string', format: 'date' }
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        totalRows: { type: 'integer' },
        limit: { type: 'integer' },
        offset: { type: 'integer' },
        records: { type: 'array', items: attendanceSchema }
      }
    },
    400: error_response_schema_400,
    401: error_response_schema_401,
    500: error_response_schema_500
  }
};

const updateAttendanceSchema = {
    description: 'Update attendance record',
    tags: ['Attendance'],
    params: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' }
      },
      required: ['id']
    },
    body: {
      type: 'object',
      properties: {
        checkIn: { type: ['string', 'null'], format: 'date-time' },
        checkOut: { type: ['string', 'null'], format: 'date-time' },
        status: { type: 'string', enum: ['Present', 'Rest Day'] }
      }
    },
    response: {
      200: attendanceSchema,
      400: error_response_schema_400,
      401: error_response_schema_401,
      404: { type: 'object', properties: { error: { type: 'string' } } },
      500: error_response_schema_500
    }
  };

  const deleteAttendanceSchema = {
    description: 'Delete attendance record',
    tags: ['Attendance'],
    params: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' }
      },
      required: ['id']
    },
    response: {
      204: { type: 'null' },
      400: error_response_schema_400,
      401: error_response_schema_401,
      404: { type: 'object', properties: { error: { type: 'string' } } },
      500: error_response_schema_500
    }
  };

// --- PLUGIN ---
const AttendanceRoutesPlugin: FastifyPluginAsync = async (server: FastifyInstance) => {
  server.decorate('authenticate', async function(request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
      const token = request.headers.authorization?.replace('Bearer ', '');
      const userId = (request.user as {id: string}).id;

      if (!token || !userId) {
        reply.code(401).send({ error: 'Unauthorized Request: Token or User ID missing' });
        return;
      }

      const [userSession] = await request.db
        .select()
        .from(UserSessionTable)
        .where(and(eq(UserSessionTable.userId, userId), eq(UserSessionTable.token, token)));

      if (!userSession) {
        reply.code(401).send({ error: 'Unauthorized Request: Invalid or expired session' });
        return;
      }
      // request.user is set by @fastify/jwt if verification succeeds
    } catch (err) {
      reply.code(401).send({ error: 'Unauthorized Request' });
    }
  });
  // Create record
  server.post(
    '/attendance',
    { preHandler: server.authenticate, schema: createAttendanceSchema },
    createAttendance
  );

  // List records
  server.get(
    '/attendance',
    { preHandler: server.authenticate, schema: getAllAttendanceSchema },
    getAllAttendance
  );

  // List records by userId
  server.get(
    '/attendance/user/:userId',
    { preHandler: server.authenticate, schema: getAttendanceByUserSchema },
    getAttendanceByUser
  );


  // Update record
server.patch(
    '/attendance/:id',
    { preHandler: server.authenticate, schema: updateAttendanceSchema },
    updateAttendance
  );
  
  // Delete record
  server.delete(
    '/attendance/:id',
    { preHandler: server.authenticate, schema: deleteAttendanceSchema },
    deleteAttendance
  );
};

// --- HANDLERS ---
async function createAttendance(req: FastifyRequest, reply: FastifyReply) {
    const { userId, date: dateString, checkIn, checkOut } = req.body as {
      userId: string;
      date: string;
      checkIn?: string | null;
      checkOut?: string | null;
    };
  
    try {
      let totalHours = 0;
      if (checkIn && checkOut) {
        const diffMs = new Date(checkOut).getTime() - new Date(checkIn).getTime();
        totalHours = diffMs > 0 ? diffMs / (1000 * 60 * 60) : 0;
      }
  
      const record = await req.db
        .insert(schema.AttendanceTable)
        .values({
            userId,
            date: dateString,
            checkIn: checkIn ? new Date(checkIn) : null,
            checkOut: checkOut ? new Date(checkOut) : null,
            totalHours: totalHours.toFixed(2),
            payableHours: '8.00',
            status: checkIn ? 'Present' : 'Rest Day',
            createdAt: new Date(),
            updatedAt: new Date()
          })
        .returning();
  
      return reply.code(201).send(record[0]);
    } catch (err: any) {
      req.log.error(err);
      return reply.code(500).send({ error: err.message });
    }
  }
  

async function getAllAttendance(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { limit = 100, offset = 0, startDate, endDate, userId } = req.query as any;

    const filters = and(
        userId ? eq(schema.AttendanceTable.userId, userId) : undefined,
        startDate ? gte(schema.AttendanceTable.date, startDate) : undefined, // Use string directly
        endDate ? lte(schema.AttendanceTable.date, endDate) : undefined // Use string directly
      );

    const [totalRowsResult, records] = await Promise.all([
      req.db.select({ count: sql<number>`count(*)` }).from(schema.AttendanceTable).where(filters),
      req.db
        .select()
        .from(schema.AttendanceTable)
        .where(filters)
        .orderBy(desc(schema.AttendanceTable.date))
        .limit(+limit)
        .offset(+offset)
    ]);

    return reply.code(200).send({
      totalRows: Number(totalRowsResult[0]?.count || 0),
      limit: +limit,
      offset: +offset,
      records
    });
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ error: 'Internal server error' });
  }
}

async function getAttendanceByUser(req: FastifyRequest, reply: FastifyReply) {
  const { userId } = req.params as { userId: string };
  const { limit = 100, offset = 0 } = req.query as any;

  try {
    const filters = eq(schema.AttendanceTable.userId, userId)


    const [totalRowsResult, records] = await Promise.all([
      req.db.select({ count: sql<number>`count(*)` }).from(schema.AttendanceTable).where(filters),
      req.db
        .select()
        .from(schema.AttendanceTable)
        .where(filters)
        .orderBy(desc(schema.AttendanceTable.date))
        .limit(+limit)
        .offset(+offset)
    ]);

    return reply.code(200).send({
      totalRows: Number(totalRowsResult[0]?.count || 0),
      limit: +limit,
      offset: +offset,
      records
    });
  } catch (err: any) {
    req.log.error(err);
    return reply.code(500).send({ error: 'Internal server error' });
  }
}

async function updateAttendance(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const { checkIn, checkOut, status } = req.body as {
    checkIn?: string | null;
    checkOut?: string | null;
    status?: 'Present' | 'Rest Day';
  };

  try {
    // 1️⃣ Fetch existing record first
    const [existing] = await req.db
      .select()
      .from(schema.AttendanceTable)
      .where(eq(schema.AttendanceTable.id, id));

    if (!existing) {
      return reply.code(404).send({ error: 'Attendance record not found' });
    }

    // 2️⃣ Decide which values to keep
    const newCheckIn = checkIn !== undefined ? (checkIn ? new Date(checkIn) : null) : existing.checkIn;
    const newCheckOut = checkOut !== undefined ? (checkOut ? new Date(checkOut) : null) : existing.checkOut;
    const newStatus = status ?? existing.status;

    // 3️⃣ Recalculate total hours only if both checkIn and checkOut exist
    let calculatedTotalHours: number | null = existing.totalHours ? Number(existing.totalHours) : null;
    if (newCheckIn && newCheckOut) {
      const diffMs = new Date(newCheckOut).getTime() - new Date(newCheckIn).getTime();
      calculatedTotalHours = diffMs > 0 ? diffMs / (1000 * 60 * 60) : 0;
    }

    // 4️⃣ Perform update
    const [record] = await req.db
      .update(schema.AttendanceTable)
      .set({
        checkIn: newCheckIn,
        checkOut: newCheckOut,
        status: newStatus,
        totalHours: calculatedTotalHours !== null ? calculatedTotalHours.toFixed(2) : null,
        updatedAt: new Date()
      })
      .where(eq(schema.AttendanceTable.id, id))
      .returning();

    return reply.code(200).send(record);
  } catch (err: any) {
    req.log.error(err);
    return reply.code(500).send({ error: err.message });
  }
}


  async function deleteAttendance(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string };
  
    try {
      const [deleted] = await req.db
        .delete(schema.AttendanceTable)
        .where(eq(schema.AttendanceTable.id, id))
        .returning();
  
      if (!deleted) {
        return reply.code(404).send({ error: 'Attendance record not found' });
      }
  
      return reply.code(204).send();
    } catch (err: any) {
      req.log.error(err);
      return reply.code(500).send({ error: err.message });
    }
  }

export default AttendanceRoutesPlugin;
