import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { WebSocket, WebSocketServer } from 'ws';
import fp from 'fastify-plugin';
import { EventEmitter } from 'events';
import FastifyRedis from '@fastify/redis';
import { Redis } from 'ioredis';
import { SupportState } from '../dosletra/DosLetraPlugin.ts';
import { CSRAuth } from './CSRAuth.ts';
import { CSR } from './CSR.ts';

export interface CSRUser {
  id: string;
  firstName: string;
  lastName: string;
  mobile: string;
  userName: string;
  email: string;
  token: string;
  type: string; // "player" | "csr"
}

declare module '@fastify/redis' {
  interface FastifyRedisType {
    csr: Redis;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    csrSockets: Map<string, CSRUserSocket>;
    authenticatedSockets: Map<string, CSRUserSocket>;
    csrEvents: EventEmitter;
  }
}

export class CSRUserSocket {
  ws: WebSocket;
  user?: CSRUser;
  token?: string;
  type?: string;

  constructor(ws: WebSocket) {
    this.ws = ws;
  }
}

export interface CSRPluginOptions {
  redisNamespace?: string;
}

const CSRPlugin: FastifyPluginAsync<CSRPluginOptions> = async (fastify, opts) => {
  // Safe decoration
  const safeDecorate = (name: string, value: any) => {
    if (!fastify.hasDecorator(name)) fastify.decorate(name, value);
  };

  safeDecorate('csrSockets', new Map<string, CSRUserSocket>());
  safeDecorate('authenticatedSockets', new Map<string, CSRUserSocket>());
  safeDecorate('csrEvents', new EventEmitter());

  // Redis setup
  await fastify.register(FastifyRedis, {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT || 6379),
    namespace: opts.redisNamespace || 'csr'
  });

  // Initialize CSR event listeners
  CSR.init(fastify);

  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (socket: WebSocket) => {
    socket.on('error', console.error);

    const csrSocket = new CSRUserSocket(socket);
    let authenticated = false;

    socket.on('message', async (message: string) => {
      try {
        const msg = JSON.parse(message.toString());

        // Authenticate
        if (!authenticated && msg.state === SupportState.Authenticate && msg.data?.token) {
          authenticated = await CSRAuth.authenticate(fastify, csrSocket, msg.data.token);

          if (authenticated && csrSocket.user) {
            await replySupportWS(csrSocket, SupportState.Authenticate, 'Success');
          } else {
            await replySupportWS(csrSocket, SupportState.Authenticate, {
              error: 'Authentication failed'
            });
            socket.close();
          }
          return;
        }

        if (!authenticated) {
          await replySupportWS(csrSocket, SupportState.Authenticate, {
            error: 'You must authenticate first'
          });
          return;
        }

        // Emit message for CSR handler
        fastify.csrEvents.emit('message', {
          message: msg,
          jwtPayload: csrSocket.user,
          socket: csrSocket
        });
      } catch (err: any) {
        await replySupportWS(csrSocket, SupportState.Message, {
          error: 'Invalid message format',
          details: err.message
        });
      }
    });

    socket.on('close', () => {
      if (csrSocket.user) {
        if (csrSocket.user.type === "csr") {
          fastify.csrSockets.delete(csrSocket.user.id);
          fastify.authenticatedSockets.delete(`csr:${csrSocket.user.id}`);
        } else if (csrSocket.user.type === "player") {
          fastify.authenticatedSockets.delete(csrSocket.user.mobile);
        }
      }
    });
  });

  fastify.server.on('upgrade', (request, socket, head) => {
    try {
      const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;
      const route = process.env.CSR_ROUTE || '/csr'; // fallback if not set
  
      if (pathname.startsWith(route)) {
        wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
      }
    } catch {
      socket.destroy();
    }
  });
};

// Standardized WS reply
export async function replySupportWS(
  socket: CSRUserSocket,
  state: SupportState,
  data: any
) {
  if (socket?.ws.readyState === WebSocket.OPEN) {
    socket.ws.send(JSON.stringify({
      channel: 'Support',
      state,
      data
    }));
  }
}

export default fp(CSRPlugin);
