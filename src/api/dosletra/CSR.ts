import { FastifyInstance } from "fastify";
import { EventManager, EventMessage, SupportState, replySupportWS } from "./DosLetraPlugin.ts";
import { ChatSessions, ChatMessages } from "../../db/schema.ts";
import { eq, and, desc } from "drizzle-orm";

export class CSR {
  static studioNo: string;
  public static init(studioNo: string, fastify: FastifyInstance) {
    CSR.studioNo = studioNo;
    EventManager.on("message", async (msg: EventMessage) => {
      if (msg.message.channel !== "Support") return;

      const playerMobile = msg.jwtPayload?.mobile;
      const socket = playerMobile ? fastify.authenticatedSockets.get(playerMobile) : null;

      if (!playerMobile || !fastify.authenticatedSockets.has(playerMobile)) {
        fastify.log.warn(`Unauthenticated CSR message from ${playerMobile ?? "unknown"}`);
        replySupportWS(socket, msg.message.state, { error: "Unauthenticated CSR request" });
        return;
      }

      switch (msg.message.state) {
        case SupportState.Start:
          await CSR.startSession(msg, socket, fastify);
          break;
        case SupportState.Message:
          await CSR.sendMessage(msg, socket, fastify);
          break;
        case SupportState.End:
          await CSR.endSession(msg, socket, fastify);
          break;
        case SupportState.ChatHistory:
          await CSR.fetchHistory(msg, socket, fastify);
          break;
        case SupportState.ListSessions:
          await CSR.listSessions(msg, socket, fastify);
          break;
        default:
          fastify.log.info(`Unhandled CSR state: ${msg.message.state}`);
      }
    });
  }

  private static async startSession(msg: EventMessage, socket: any, fastify: FastifyInstance) {
    try {
      const token = socket.token;
      const { text, typeId } = msg.message.data ?? {};
      const { mobile, type } = msg.jwtPayload ?? {};
  
      if (!mobile) {
        replySupportWS(socket, SupportState.Start, { error: "Missing mobile number" });
        return;
      }
  
      if (type !== "player") {
        replySupportWS(socket, SupportState.Start, { error: "Only players can start a session" });
        return;
      }
  
      if (!text) {
        replySupportWS(socket, SupportState.Start, { error: "Initial message is required" });
        return;
      }
  
      if (!typeId) {
        replySupportWS(socket, SupportState.Start, { error: "Session type is required" });
        return;
      }
  
      // 🔥 Delegate to REST API
      const response = await fastify.inject({
        method: "POST",
        url: `/csr/sessions`,
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        payload: {
          mobile,
          typeId,
          message: text
        }
      });
  
      const body = await response.json();
  
      // Return result back via WS
      replySupportWS(socket, SupportState.Start, body);
  
      for (const [, userSocket] of fastify.authenticatedSockets.get(CSR.studioNo).entries()) {
        if (userSocket && userSocket.type === "csr") {
          replySupportWS(userSocket, SupportState.Message, body);
        }
      }
    } catch (err) {
      fastify.log.error({ err }, "Failed to start CSR session");
      replySupportWS(socket, SupportState.Start, { error: "Internal server error" });
    }
  }

  private static async sendMessage(msg: EventMessage, socket: any, fastify: FastifyInstance) {
    try {
      const token = socket.token;
      const { sessionId, text } = msg.message.data;
      const { type, mobile } = msg.jwtPayload ?? {};

      const response = await fastify.inject({
        method: "POST",
        url: `/csr/sessions/${sessionId}/messages`,
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        payload: {
          message: text,
          mobile
        }
      });

      const body = await response.json();
      replySupportWS(socket, SupportState.Message, body);

      if (type === "player") {
        // Player sent → broadcast to admins only
        for (const [, userSocket] of fastify.authenticatedSockets.get(CSR.studioNo).entries()) {
          if (!userSocket || userSocket.type === "player") continue;
          replySupportWS(userSocket, SupportState.Message, body);
        }
      } else if (type === "csr") {
        // Admin sent → broadcast to the player of this session
        const playerSocket = fastify.authenticatedSockets.get(body.mobile ?? mobile);
        if (playerSocket) {
          replySupportWS(playerSocket, SupportState.Message, body);
        }
      }
    } catch (err) {
      replySupportWS(socket, SupportState.Message, { error: "Internal server error" });
    }
  }

  private static async endSession(msg: EventMessage, socket: any, fastify: FastifyInstance) {
    try {
      const token = socket.token;
      const { sessionId } = msg.message.data;
      const { type, mobile } = msg.jwtPayload ?? {};

      const response = await fastify.inject({
        method: "PATCH",
        url: `/csr/sessions/${sessionId}`,
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        payload: { status: "ended" }
      });

      const body = await response.json();
      replySupportWS(socket, SupportState.End, body);

      if (type === "player") {
        // Player ended session → tell admins
        for (const [, userSocket] of fastify.authenticatedSockets.get(CSR.studioNo).entries()) {
          if (!userSocket || userSocket.type === "player") continue;
          replySupportWS(userSocket, SupportState.End, body);
        }
      } else if (type === "csr") {
        // Admin ended session → tell player
        const playerSocket = fastify.authenticatedSockets.get(body.mobile ?? mobile);
        if (playerSocket) {
          replySupportWS(playerSocket, SupportState.End, body);
        }
      }
    } catch (err) {
      replySupportWS(socket, SupportState.End, { error: "Internal server error" });
    }
  }

  private static async fetchHistory(msg: EventMessage, socket: any, fastify: FastifyInstance) {
    try {
      const token = socket.token;
      const { sessionId, limit = 50 } = msg.message.data;

      const response = await fastify.inject({
        method: "GET",
        url: `/csr/sessions/${sessionId}/messages?limit=${limit}`,
        headers: { "Authorization": `Bearer ${token}` }
      });

      const body = await response.json();
      replySupportWS(socket, SupportState.ChatHistory, body);
    } catch (err) {
      replySupportWS(socket, SupportState.ChatHistory, { error: "Internal server error" });
    }
  }

  private static async listSessions(msg: EventMessage, socket: any, fastify: FastifyInstance) {
    try {
      const token = socket.token;
      const { status, limit = 50 } = msg.message.data;
  
      // build query string safely
      const qs = new URLSearchParams();
      if (status) qs.set("status", status);
      if (limit) qs.set("limit", String(limit));
  
      const response = await fastify.inject({
        method: "GET",
        url: `/csr/sessions${qs.toString() ? `?${qs.toString()}` : ""}`,
        headers: { "Authorization": `Bearer ${token}` }
      });
  
      const body = await response.json();
      replySupportWS(socket, SupportState.ListSessions, body);
    } catch (err) {
      replySupportWS(socket, SupportState.ListSessions, { error: "Internal server error" });
    }
  }  
}
