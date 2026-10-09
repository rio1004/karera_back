import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import jwt from '@fastify/jwt';
import dotenv from 'dotenv';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastifyRedis from "@fastify/redis";
import { UserSessionTable } from './db/schema.ts';
import { and, eq } from 'drizzle-orm';

dotenv.config();
export function create_app(disableLogger: boolean = false): FastifyInstance {
  const fastify = Fastify({
    logger: disableLogger ? false : true,
  });

  fastify.register(jwt, {
    secret: {
      private: process.env.JWT_PRIVATE_KEY,
      public: process.env.JWT_PUBLIC_KEY,
    },
    sign: {
      algorithm: 'EdDSA', // EdDSA (Ed25519) currently the best balanced algorithm for JWT
      expiresIn: '24h' 
    }
  });

  fastify.register(fastifyRedis, {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || "6379"),
  });

  fastify.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Game Aggregator API',
        description: `Welcome to the API documentation for our racing game platform.`,
        version: '1.0.0'
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
      // You can add more OpenAPI options here
    }
  });

  fastify.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    // Swagger UI will be available at /docs
  });

  fastify.setErrorHandler((error, request, reply) => {
    if (error.validation) {
      
      // Map validation errors to include useful details
      const validation = error.validation.map((v: any) => ({
        instancePath: v.instancePath,
        schemaPath: v.schemaPath,
        keyword: v.keyword,
        params: v.params,
        message: v.message,
      }));
      reply.status(400).send({
        error: 'Validation error',
        message: error.message,
        validation,
      });
    } else {
      reply.status(error.statusCode || 500).send({
        error: 'Internal server error',
        message: error.message,
      });
    }
  });

  return fastify;
}

export async function globalAuthentication(fastify: FastifyInstance) {
  fastify.decorate('authenticate', async function(request: FastifyRequest, reply: FastifyReply) {
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
}
