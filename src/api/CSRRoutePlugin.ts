import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { FastifyPluginAsync } from "fastify";
import { eq, and, desc, asc, count, inArray } from "drizzle-orm";
import { Tickets, TicketLogs, ticketStatusEnum, ticketPriorityEnum, ChatMessages, ChatSessions, ChatSessionTypes, UsersTable, ProfilesTable, UserSessionTable } from "../db/schema.ts";
import { randomUUID } from "crypto";
import { globalAuthentication } from "../app.ts";

// ===============
// ROUTES PLUGIN
// ===============
const CSRRoutePlugin: FastifyPluginAsync = async (server: FastifyInstance) => {
  globalAuthentication(server);

  server.get("/csr/tickets", { schema: getAllTicketsSchema }, getAllTickets);
  server.post("/csr/ticket", { schema: createTicketSchema }, createTicket);
  server.post("/csr/tickets/:id/assign", { schema: assignTicketSchema }, assignTicket);
  server.post("/csr/tickets/:id/status", { schema: updateTicketStatusSchema }, updateTicketStatus);
  server.get("/csr/tickets/:id", { schema: getTicketWithLogSchema }, getTicket);
  server.post("/csr/tickets/:id/messages", { schema: addTicketMessageSchema }, addTicketMessage );

  // ===========================
  // 💬 CSR CHAT ROUTES
  // ===========================
  server.post("/csr/sessions", { preHandler: server.authenticate, schema: createChatSessionSchema }, createChatSession);
  server.get("/csr/sessions", { preHandler: server.authenticate, schema: listChatSessionsSchema }, listChatSessions);
  server.patch("/csr/sessions/:id", { preHandler: server.authenticate, schema: endChatSessionSchema }, endChatSession);
  server.post("/csr/sessions/:id/messages", { preHandler: server.authenticate, schema: addChatMessageSchema }, addChatMessage);
  server.get("/csr/sessions/:id/messages", { preHandler: server.authenticate, schema: getChatHistorySchema }, getChatHistory);
  server.patch("/csr/sessions/:id/messages/:msgId", { preHandler: server.authenticate, schema: markMessageReadSchema }, markMessageRead);
  server.get("/csr/session-types", { preHandler: server.authenticate, schema: listChatSessionTypesSchema }, listChatSessionTypes);
  server.post("/csr/session-types", { preHandler: server.authenticate, schema: createChatSessionTypeSchema }, createChatSessionType);
  
  // WebSocket Chat Documentation
  server.post('/docs/ws/chat/Authenticate', { schema: wsAuthenticateSchema }, ()=>{});
  server.post('/docs/ws/chat/start', { schema: wsStartChatSchema }, ()=>{});
  server.post('/docs/ws/chat/message', { schema: wsMessageSchema }, ()=>{}); 
  server.post('/docs/ws/chat/end', { schema: wsEndChatSchema }, ()=>{}); 
  server.post('/docs/ws/chat/history', { schema: wsChatHistorySchema }, ()=>{}); 
  server.post('/docs/ws/chat/sessions', { schema: wsChatSessionsSchema }, ()=>{});
}

// ==========
// SCHEMAS
// ==========
const ticketObjectSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    userId: { type: "string", format: "uuid" },
    assigneeId: { type: "string", format: "uuid", nulllable: true },
    subject: { type: "string" },
    status: { type: "string", enum: ticketStatusEnum.enumValues },
    priority: { type: "string", enum: ticketPriorityEnum.enumValues },
    createdAt: { type: "string", format: "date-time"},
    updatedAt: { type: "string", format: "date-time"},
    resolvedAt: { type: "string", format: "date-time", nullable: true},
    closedAt: { type: "string", format: "date-time", nullable: true},
    messages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          senderId: { type: "string", format: "uuid" },
          message: { type: "string" },
          attachments: { type: "array", items: { type: "string", nullable: true } },
          createdAt: { type: "string", format: "date-time" }
        },
        required: ["id", "senderId", "message", "createdAt"],
        additionalProperties: false
      }
    },
    meta: { type: "array" }
  },
  required: ["id", "userId", "subject", "status", "priority", "createdAt", "updatedAt", "messages"],
  additionalProperties: false
};

const ticketLogsSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      ticketId: { type: "string", format: "uuid" },
      actorId: { type: "string", format: "uuid" },
      action: { type: "string" },
      oldValue: { type: "string", nullable: true },
      newValue: { type: "string", nullable: true },
      notes: { type: "string", nullable: true },
      createdAt: { type: "string", format: "date-time" }
    },
    required: ["id", "ticketId", "actorId", "action", "createdAt"],
    additionalProperties: false
  }
}

export const getAllTicketsSchema = {
  tags: ["CSR Ticket"],
  queryString: {
    type: "object",
    properties: {
      page: { type: "number" },
      limit: { type: "number" },
      status: { type: "string", enum: [...ticketStatusEnum.enumValues, "ALL"] },
      priority: { type: "string", enum: [...ticketPriorityEnum.enumValues, "ALL"] },
      assignedId: { type: "string", format: "uuid" }
    },
    additionalProperties: false
  },
  response: {
    200: {
      type: "object",
      properties: {
        data: { type: "array", items: ticketObjectSchema },
        page: { type: "number" },
        limit: { type: "number" },
        total: { type: "number" },
        pages: { type: "number" }
      },
      required: ["data", "page", "limit", "total", "pages"],
      additionalProperties: false
    }
  }
}

export const createTicketSchema = {
  tags: ["CSR Ticket"],
  body: {
    type: "object",
    properties: {
      userId: { type: "string", format: "uuid" },
      subject: { type: "string" },
      priority: { type: "string", enum: ticketPriorityEnum.enumValues },
      message: {
        type: "object",
        properties: {
          senderId: { type: "string", format: "uuid" },
          message: { type: "string" },
          attachments: { type: "array", items: { type: "string" }, nullable: true }
        },
        required: ["senderId", "message"]
      }
    },
    required: ["userId", "subject", "message"],
    additionalProperties: false
  },
  response: {
    200: {
      type: "object",
      properties: { ticket: ticketObjectSchema },
      required: ["ticket"],
      additionalProperties: false
    }
  }
};

export const assignTicketSchema = {
  tags: ["CSR Ticket"],
  params: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" }
    },
    required: ["id"],
    additionalProperties: false
  },
  body: {
    type: "object",
    properties: {
      assigneeId: { type: "string", format: "uuid" },
      actorId: { type: "string", format: "uuid" }
    },
    required: ["assigneeId", "actorId"],
    additionalProperties: false
  },
  response: {
    200: {
      ticket: ticketObjectSchema
    }
  }
}

export const updateTicketStatusSchema = {
  tags: ["CSR Ticket"],
  params: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" }
    },
    required: ["id"],
    additionalProperties: false,
  },
  body: {
    type: "object",
    properties: {
      status: { type: "string", enum: ticketStatusEnum.enumValues },
      actorId: { type: "string", format: "uuid" },
      notes: { type: "string" }
    },
    required: ["status", "actorId"],
    additionalProperties: false
  },
  response: {
    200: {
      ticket: ticketObjectSchema
    }
  }
}

export const getTicketWithLogSchema = {
  tags: ["CSR Ticket"],
  params: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" }
    },
    required: ["id"],
    additionalProperties: false
  },
  response: {
    200: {
      type: "object",
      properties: {
        ticket: ticketObjectSchema,
        logs: ticketLogsSchema
      },
      required: ["ticket", "logs"],
      additionalProperties: false
    }
  }
}

export const addTicketMessageSchema = {
  tags: ['CSR Ticket'],
  params: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" }
    },
    required: ["id"],
    additionalProperties: false
  },
  body: {
    type: "object",
    properties: {
      senderId: { type: "string", format: "uuid" },
      message: { type: "string" },
      attachments: { type: "array", items: { type: "string" }, nullable: true }
    },
    required: ["senderId", "message"],
    additionalProperties: false
  },
  response: {
    200: {
      type: "object",
      properties: {
        ticket: ticketObjectSchema
      },
      required: ["ticket"],
      additionalProperties: false
    }
  }
}

export const wsAuthenticateSchema = {
  description: "Authenticate WebSocket connection",
  tags: ["WS CSR Chat"],
  body: {
    type: "object",
    required: ["channel", "state", "data"],
    properties: {
      channel: { type: "string", enum: ["Support"] },
      state: { type: "string", enum: ["Authenticate"] },
      data: {
        type: "object",
        required: ["token"],
        properties: {
          token: { type: "string", description: "JWT token of the user" }
        }
      }
    }
  }
};


export const wsStartChatSchema = {
  description: "Start a CSR chat session (player only)",
  tags: ["WS CSR Chat"],
  body: {
    type: "object",
    required: ["channel", "state", "data"],
    properties: {
      channel: { type: "string", enum: ["Support"] },
      state: { type: "string", enum: ["Start"] },
      data: {
        type: "object",
        required: ["text", "typeId"],
        properties: {
          text: { type: "string", description: "Initial message to start session" },
          typeId: { type: "number", description: "Session type ID" }
        }
      }
    }
  }
};

export const wsMessageSchema = {
  description: "Send a chat message in an open session",
  tags: ["WS CSR Chat"],
  body: {
    type: "object",
    required: ["channel", "state", "data"],
    properties: {
      channel: { type: "string", enum: ["Support"] },
      state: { type: "string", enum: ["Message"] },
      data: {
        type: "object",
        required: ["sessionId", "text"],
        properties: {
          sessionId: { type: "number" },
          text: { type: "string" }
        }
      }
    }
  }
};

export const wsEndChatSchema = {
  description: "End a CSR chat session",
  tags: ["WS CSR Chat"],
  body: {
    type: "object",
    required: ["channel", "state", "data"],
    properties: {
      channel: { type: "string", enum: ["Support"] },
      state: { type: "string", enum: ["End"] },
      data: {
        type: "object",
        required: ["sessionId"],
        properties: {
          sessionId: { type: "number" }
        }
      }
    }
  }
};

export const wsChatHistorySchema = {
  description: "Fetch chat history of a session",
  tags: ["WS CSR Chat"],
  body: {
    type: "object",
    required: ["channel", "state", "data"],
    properties: {
      channel: { type: "string", enum: ["Support"] },
      state: { type: "string", enum: ["ChatHistory"] },
      data: {
        type: "object",
        required: ["sessionId"],
        properties: {
          sessionId: { type: "number" },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 50 }
        }
      }
    }
  }
};

export const wsChatSessionsSchema = {
  description: "List CSR chat sessions (admin only)",
  tags: ["WS CSR Chat"],
  body: {
    type: "object",
    required: ["channel", "state", "data"],
    properties: {
      channel: { type: "string", enum: ["Support"] },
      state: { type: "string", enum: ["ListSessions"] },
      data: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["open", "closed"], nullable: true },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 50 }
        }
      }
    }
  }
};

export const createChatSessionSchema = {
  tags: ["CSR Chat"],
  body: {
    type: "object",
    properties: {
      mobile: { type: "string" },     // user’s mobile
      typeId: { type: "integer" },    // session category type
      message: { type: "string" }     // initial message
    },
    required: ["mobile", "typeId", "message"], // ✅ add typeId
    additionalProperties: false
  },
  response: {
    200: {
      type: "object",
      properties: {
        sessionId: { type: "number" },
        typeId: { type: "number" },
        firstMessageId: { type: "number" },
        message: { type: "string" },
        createdAt: { type: "string", format: "date-time" }
      },
      required: ["sessionId", "typeId", "firstMessageId", "message", "createdAt"],
      additionalProperties: false
    }
  }
};

export const listChatSessionsSchema = {
  description: "List chat sessions with profile, last message, and read status",
  tags: ["CSR Chat"],
  querystring: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["open", "closed"], nullable: true },
      limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
    },
  },
  response: {
    200: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "number" },
          mobile: { type: "string" },
          status: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          userName: { type: ["string", "null"] },
          fullName: { type: ["string", "null"] },
          profilePicture: { type: ["string", "null"], format: "uri" },
          lastMessage: { type: ["string", "null"] },
          lastMessageAt: { type: ["string", "null"], format: "date-time" },
          isRead: { type: "boolean" },
        },
        required: ["id", "mobile", "status", "createdAt", "updatedAt"],
      },
    },
  },
};


export const endChatSessionSchema = {
  description: "End or update a chat session",
  tags: ["CSR Chat"],
  params: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "integer", minimum: 1 },
    },
  },
  response: {
    200: {
      type: "object",
      properties: {
        id: { type: "number" },
        mobile: { type: "string" },
        status: { type: "string" },
        updatedAt: { type: "string", format: "date-time" },
      },
    },
  },
};

export const addChatMessageSchema = {
  description: "Send a new chat message in a session",
  tags: ["CSR Chat"],
  params: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "integer", minimum: 1 },
    },
  },
  body: {
    type: "object",
    required: ["mobile", "message"],
    properties: {
      mobile: { type: "string" },
      message: { type: "string" },
    },
  },
  response: {
    201: {
      type: "object",
      properties: {
        id: { type: "number" },
        sessionId: { type: "number" },
        mobile: { type: "string" },
        message: { type: "string" },
        isRead: { type: "boolean" },
        createdAt: { type: "string", format: "date-time" },
      },
    },
  },
};

export const getChatHistorySchema = {
  description: "Get chat messages for a session",
  tags: ["CSR Chat"],
  params: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "integer", minimum: 1 },
    },
  },
  querystring: {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
    },
  },
  response: {
    200: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "number" },
          sessionId: { type: "number" },
          mobile: { type: "string" },
          message: { type: "string" },
          isRead: { type: "boolean" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
    },
  },
};

export const markMessageReadSchema = {
  description: "Mark a chat message as read",
  tags: ["CSR Chat"],
  params: {
    type: "object",
    required: ["id", "msgId"],
    properties: {
      id: { type: "integer", minimum: 1 },
      msgId: { type: "integer", minimum: 1 },
    },
  },
  response: {
    200: {
      type: "object",
      properties: {
        id: { type: "number" },
        sessionId: { type: "number" },
        mobile: { type: "string" },
        message: { type: "string" },
        isRead: { type: "boolean" },
        updatedAt: { type: "string", format: "date-time" },
      },
    },
  },
};

export const listChatSessionTypesSchema = {
  description: "List all chat session types",
  tags: ["CSR Chat"],
  response: {
    200: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "number" },
          name: { type: "string" },
          code: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
    },
  },
};

export const createChatSessionTypeSchema = {
  description: "Create a new chat session type",
  tags: ["CSR Chat"],
  body: {
    type: "object",
    properties: {
      name: { type: "string" },
      code: { type: "string" },
    },
    required: ["name", "code"],
    additionalProperties: false,
  },
  response: {
    201: {
      type: "object",
      properties: {
        id: { type: "number" },
        name: { type: "string" },
        code: { type: "string" },
        createdAt: { type: "string", format: "date-time" },
      },
    },
  },
};

// ============
// HELPERS
// ============

async function logTicketAction(db: any, ticketId: string, actorId: string, action: string, oldValue?: string | null, newValue?: string | null, notes?: string) {
  await db.insert(TicketLogs).values({
    ticketId,
    actorId,
    action,
    oldValue,
    newValue,
    notes
  });
}

// ===========
// HANDLERS
// ===========

async function getAllTickets(request: FastifyRequest, reply: FastifyReply) {
  const { page = 1, limit = 20, status, priority, assigneeId } = request.query as any;
  const offset = (page - 1) * limit;

  const conditions = [];
  if (status && status !== "ALL") conditions.push(eq(Tickets.status, status));
  if (priority && priority !== "ALL") conditions.push(eq(Tickets.priority, priority));
  if (assigneeId) conditions.push(eq(Tickets.assigneeId, assigneeId));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [countResult] = await request.db.select({ count: count() }).from(Tickets).where(whereClause);
  const total = Number(countResult.count || 0);

  const data = await request.db
    .select()
    .from(Tickets)
    .where(whereClause)
    .orderBy(desc(Tickets.createdAt))
    .limit(limit)
    .offset(offset)

  return reply.code(200).send({
    data,
    page,
    limit,
    total,
    pages: Math.ceil(total / limit)
  });
}

async function createTicket(request: FastifyRequest, reply: FastifyReply) {
  const { userId, subject, priority, message } = request.body as any;

  const newMessage = {
    id: randomUUID(),
    senderId: message.senderId,
    message: message.message,
    attachments: message.attachments || [],
    createdAt: new Date().toISOString()
  };

  const [ticket] = await request.db
    .insert(Tickets)
    .values({
      userId,
      subject,
      priority,
      status: "OPEN",
      messages: [newMessage],
      createdAt: new Date(),
      updatedAt: new Date()
    })
    .returning();

  return reply.code(200).send({ ticket });
}

async function assignTicket(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { assigneeId, actorId } = request.body as any;

  const [ticket] = await request.db.select().from(Tickets).where(eq(Tickets.id, id));
  if (!ticket) return reply.code(404).send({ error: "Ticket not found" });

  const newLog = {
    id: randomUUID(),
    actorId,
    action: "ASSIGNED",
    oldValue: ticket.assigneeId || null,
    newValue: assigneeId,
    createdAt: new Date().toISOString
  }

  const existingMeta = Array.isArray(ticket.meta) ? (ticket.meta as any[]) : [];
  const udpatedMeta = [...existingMeta, newLog];

  const [updatedTicket] = await request.db
    .update(Tickets)
    .set({ assigneeId, updatedAt: new Date(), meta: udpatedMeta })
    .where(eq(Tickets.id, id))
    .returning();
  
  return reply.code(200).send({ ticket: updatedTicket });
}

async function updateTicketStatus(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { status, actorId, notes } = request.body as any;

  const [ticket] = await request.db.select().from(Tickets).where(eq(Tickets.id, id));
  if (!ticket) return reply.code(404).send({ error: "Ticket not found" });

  const newLog = {
    id: randomUUID(),
    actorId,
    action: "STATUS_CHANGED",
    oldValue: ticket.status,
    newValue: status,
    createdAt: new Date().toISOString
  }

  const existingMeta = Array.isArray(ticket.meta) ? (ticket.meta as any[]) : [];
  const updatedMeta = [...existingMeta, newLog];

  const [updatedTicket] = await request.db
    .update(Tickets)
    .set({
      status,
      updatedAt: new Date(),
      resolvedAt: status === "RESOLVED" ? new Date() : null,
      closedAt: status === "CLOSED" ? new Date() : null,
      meta: updatedMeta
    })
    .where(eq(Tickets.id, id))
    .returning();

  return reply.code(200).send({ ticket: updatedTicket });
}

async function getTicket(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string }

  const [ticket] = await request.db.select().from(Tickets).where(eq(Tickets.id, id));
  if (!ticket) return reply.code(404).send({ error: "Ticket not found" });

  const logs = await request.db
    .select()
    .from(TicketLogs)
    .where(eq(TicketLogs.ticketId, id))
    .orderBy(asc(TicketLogs.createdAt))

  return reply.code(200).send({ ticket, logs });
}

async function addTicketMessage(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { senderId, message, attachments } = request.body as any;

  const [ticket] = await request.db.select().from(Tickets).where(eq(Tickets.id, id));
  if (!ticket) return reply.code(404).send({ error: "Ticket not found" });

  const newMessage = {
    id: randomUUID(),
    senderId,
    message,
    attachments: attachments || [],
    createdAt: new Date().toISOString(),
  }

  const existingMessages = Array.isArray(ticket.messages) ? (ticket.messages as any[]) : [];
  const updatedMessages = [...existingMessages, newMessage];

  const [updatedTicket] = await request.db
    .update(Tickets)
    .set({ messages: updatedMessages, updatedAt: new Date() })
    .where(eq(Tickets.id, id))
    .returning();

  return reply.code(200).send({ ticket: updatedTicket });
}

// Start a new chat session
async function createChatSession(request: FastifyRequest, reply: FastifyReply) {
  const { mobile, typeId, message } = request.body as { mobile: string; typeId: number; message: string };

  // Validate typeId exists
  const [type] = await request.db.select().from(ChatSessionTypes).where(eq(ChatSessionTypes.id, typeId));
  if (!type) {
    return reply.code(400).send({ error: "Invalid typeId" });
  }

  // Check for existing active session of same type
  const existing = await request.db
    .select()
    .from(ChatSessions)
    .where(and(eq(ChatSessions.mobile, mobile), eq(ChatSessions.typeId, typeId), eq(ChatSessions.status, "open")))
    .orderBy(desc(ChatSessions.createdAt))
    .limit(1);

  let session;
  if (existing.length > 0) {
    session = existing[0];
  } else {
    [session] = await request.db
      .insert(ChatSessions)
      .values({ mobile, typeId })
      .returning();
  }

  // Always insert the initial message
  const [savedMessage] = await request.db
    .insert(ChatMessages)
    .values({
      sessionId: session.id,
      mobile,
      message,
    })
    .returning();

  return reply.code(200).send({
    sessionId: session.id,
    typeId: typeId,
    firstMessageId: savedMessage.id,
    message: savedMessage.message,
    createdAt: savedMessage.createdAt,
  });
}

// List chat sessions
async function listChatSessions(request: FastifyRequest, reply: FastifyReply) {
  const { status, limit = 50 } = request.query as { status?: string; limit?: number };

  // Step 1: Base query for sessions
  let query = request.db
    .select()
    .from(ChatSessions)
    .orderBy(desc(ChatSessions.createdAt))
    .limit(limit);

  if (status) {
    query = query.where(eq(ChatSessions.status, status));
  }

  const sessions = await query;

  if (sessions.length === 0) {
    return reply.send([]);
  }

  // Step 2: Collect session IDs + mobiles
  const sessionIds = sessions.map(s => s.id);

  // Get latest message per session
  const messages = await request.db
    .select()
    .from(ChatMessages)
    .where(inArray(ChatMessages.sessionId, sessionIds))
    .orderBy(desc(ChatMessages.createdAt));

  // group by sessionId (last message)
  const lastMessages: Record<number, any> = {};
  for (const msg of messages) {
    if (!lastMessages[msg.sessionId]) {
      lastMessages[msg.sessionId] = msg; // first encountered is latest (desc order)
    }
  }

  // Step 3: Get user + profile details based on mobile
  const mobiles = sessions.map(s => s.mobile);
  const users = await request.db
    .select()
    .from(UsersTable)
    .where(inArray(UsersTable.mobile, mobiles));

  const userIds = users.map(u => u.id);
  const profiles = await request.db
    .select()
    .from(ProfilesTable)
    .where(inArray(ProfilesTable.userId, userIds));

  // Build lookup
  const userLookup: Record<string, any> = {};
  for (const u of users) {
    userLookup[u.mobile] = {
      id: u.id,
      userName: u.userName,
      firstName: u.firstName,
      lastName: u.lastName,
    };
  }

  const profileLookup: Record<number, any> = {};
  for (const p of profiles) {
    profileLookup[p.userId] = p;
  }

  // Step 4: Compose response
  const enriched = sessions.map(s => {
    const user = userLookup[s.mobile];
    const profile = user ? profileLookup[user.id] : null;
    const msg = lastMessages[s.id];

    return {
      id: s.id,
      mobile: s.mobile,
      status: s.status,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,

      // ✅ added fields
      userName: user?.userName ?? null,
      fullName: user ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() : null,
      profilePicture: profile?.profilePictureUrl ?? profile?.profilePicture ?? null,
      lastMessage: msg?.message ?? null,
      lastMessageAt: msg?.createdAt ?? null,
      isRead: msg?.isRead ?? false,
    };
  });

  return reply.send(enriched);
}

// End/close a session
async function endChatSession(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: number };

  const [updated] = await request.db.update(ChatSessions)
    .set({ status: "closed", updatedAt: new Date() })
    .where(eq(ChatSessions.id, id))
    .returning();

  if (!updated) return reply.code(404).send({ error: "Session not found" });

  return reply.send(updated);
}

// Add message to a session
async function addChatMessage(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: number };
  const { mobile, message } = request.body as { mobile: string; message: string };

  const [session] = await request.db.select().from(ChatSessions).where(eq(ChatSessions.id, id));
  if (!session) return reply.code(404).send({ error: "Session not found" });

  const [msg] = await request.db.insert(ChatMessages).values({
    sessionId: id,
    mobile,
    message
  }).returning();

  return reply.code(201).send(msg);
}

// Fetch chat history
async function getChatHistory(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: number };
  const { limit = 50 } = request.query as { limit?: number };
  const viewerMobile = request.user?.mobile;

  const messages = await request.db.select()
    .from(ChatMessages)
    .where(eq(ChatMessages.sessionId, id))
    .orderBy(desc(ChatMessages.createdAt))
    .limit(limit);
  
  if (viewerMobile) {
    // Collect unread messages *not sent by the viewer*
    const unreadIds = messages
      .filter(m => !m.isRead && m.mobile !== viewerMobile) // <-- fix here
      .map(m => m.id);

    if (unreadIds.length > 0) {
      await request.db
        .update(ChatMessages)
        .set({ isRead: true })
        .where(inArray(ChatMessages.id, unreadIds));
    }

    // Update returned messages so client sees them as read
    messages.forEach(m => {
      if (unreadIds.includes(m.id)) {
        m.isRead = true;
      }
    });
  }

  return reply.send(messages);
}

// Mark message as read
async function markMessageRead(request: FastifyRequest, reply: FastifyReply) {
  const { id, msgId } = request.params as { id: number; msgId: number };

  const [updated] = await request.db.update(ChatMessages)
    .set({ isRead: true, updatedAt: new Date() })
    .where(and(eq(ChatMessages.id, msgId), eq(ChatMessages.sessionId, id)))
    .returning();

  if (!updated) return reply.code(404).send({ error: "Message not found" });

  return reply.send(updated);
}

async function createChatSessionType(request: FastifyRequest, reply: FastifyReply) {
  const { name, code } = request.body as { name: string; code: string };

  const [type] = await request.db
    .insert(ChatSessionTypes)
    .values({ name, code })
    .returning();

  return reply.code(201).send(type);
}


async function listChatSessionTypes(request: FastifyRequest, reply: FastifyReply) {
  const types = await request.db
    .select()
    .from(ChatSessionTypes)
    .orderBy(asc(ChatSessionTypes.id));

  return reply.send(types);
}

export default CSRRoutePlugin;
