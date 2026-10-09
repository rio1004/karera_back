import { FastifyInstance } from 'fastify';
import { FastifyPluginAsync } from 'fastify';

const healthSchema = {
  description: 'Health Checker',
  response: {
    200: {
      type: 'string'
    }
  }
};


const HealthRoutesPlugin: FastifyPluginAsync = async (server: FastifyInstance, opts) => {
  server.get('/health', { 
    schema: healthSchema,
    logLevel: 'silent'  // ← This disables logging for health checks
  }, (_, res) => res.send("OK"));
};


export default HealthRoutesPlugin;
