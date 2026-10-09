import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";

const wsPlayerChatRequestSchema = {
  description: 'Send in game message to players',
  tags: ['WS Chat Requests'],
  summary: 'Send in game message',
  body: {
    type: 'object',
    properties: {
      channel: { type: 'string' },
      state: { type: 'string' },
      data: { 
        type: 'object',
        properties: {
          message: { type: 'string' }
        }
      }
    }
  }
};

const wsPlayerChatResponseSchema = {
  description: 'Player chat broadcast',
  tags: ['WS Chat Response'],
  summary: 'Broadcast when player send a message',
  body: {
    type: 'object',
    properties: {
      channel: { type: 'string' },
      state: { type: 'string' },
      data: { 
        type: 'object',
        properties: {
          sender: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                mobile: { type: 'string' },
                firstName: { type: 'string' },
                lastName: { type: 'string' },
                userName: { type: 'string' },
              }
            }
          },
          message: { type: 'string' },
          timestamp: { type: 'string', format: 'date-time' }
        }
      }
    }
  }
};

const PlayerRoutesPlugin: FastifyPluginAsync = async (server: FastifyInstance, opts) => {
  // WebSocket Request Documentation
  server.post('/docs/ws/requests/Chat', { schema: wsPlayerChatRequestSchema }, ()=>{});

  // WebSocket Response Documentation
  server.post('/docs/ws/response/Chat', { schema: wsPlayerChatResponseSchema }, ()=>{});
}

export default PlayerRoutesPlugin;