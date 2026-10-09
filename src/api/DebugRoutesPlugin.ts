import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { exec } from 'child_process';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'; 
import * as schema from '../db/schema.ts'; 
import { error_response_schema_400, error_response_schema_401, error_response_schema_500 } from './utils/schemaUtils.ts';
import { sql } from 'drizzle-orm';
import { promisify } from 'util';
import { readFileSync } from 'fs';
import { join } from 'path';
import { UserSessionTable } from '../db/schema.ts';
import { globalAuthentication } from '../app.ts';

const execAsync = promisify(exec);
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (allowedRoles: string[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyReply {
    jwtSign(payload: object | string, options?: object): Promise<string>;
  }
  interface FastifyRequest {
    db: NodePgDatabase<typeof schema>;
  }
}

// Schema for clear all tables endpoint
const clearAllTablesSchema = {
  description: 'Clear all tables in the database (DANGEROUS - USE ONLY FOR DEBUGGING)',
  tags: ['Debug'],
  response: {
    200: {
      type: 'object',
      properties: { 
        message: { type: 'string' },
        clearedTables: { 
          type: 'array',
          items: { type: 'string' }
        },
        totalTables: { type: 'number' }
      }
    },
    400: error_response_schema_400,
    401: error_response_schema_401,
    500: error_response_schema_500
  }
};

// Schema for clear specific tables endpoint
const clearSpecificTablesSchema = {
  description: 'Clear specific tables in the database (DANGEROUS - USE ONLY FOR DEBUGGING)',
  tags: ['Debug'],
  body: {
    type: 'object',
    properties: {
      tables: { 
        type: 'array',
        items: { type: 'string' },
        description: 'Array of table names to clear'
      }
    },
    required: ['tables']
  },
  response: {
    200: {
      type: 'object',
      properties: { 
        message: { type: 'string' },
        clearedTables: { 
          type: 'array',
          items: { type: 'string' }
        },
        method: { type: 'string' },
        totalTables: { type: 'number' }
      }
    },
    400: error_response_schema_400,
    401: error_response_schema_401,
    500: error_response_schema_500
  }
};

const getAvailableTablesSchema = {
  description: 'Get all available tables in the database',
  tags: ['Debug'],
  response: {
    200: {
      type: 'object',
      properties: { 
        message: { type: 'string' },
        totalTables: { type: 'number' },
        tables: { 
          type: 'array',
          items: { type: 'string' }
        }
      }
    },
    404: error_response_schema_400,
    500: error_response_schema_500
  }
};

const executeSeederSchema = {
  description: 'Execute a seeder script by name',
  tags: ['Debug'],
  body: {
    type: 'object',
    properties: {
      seederName: { 
        type: 'string',
        items: { type: 'string' },
        description: 'Name of the seeder script to execute'
      }
    },
    required: ['seederName']
  },
  response: {
    200: {
      type: 'object',
      properties: { 
        message: { type: 'string' },
        seederName: { type: 'string' },
        status: { type: 'string' },
        output: { type: 'string' }
      }
    },
    400: error_response_schema_400,
    401: error_response_schema_401,
    500: error_response_schema_500
  }
};

// Schema for reset database endpoint
const resetDatabaseSchema = {
  description: 'Reset the entire database by dropping all tables and running migrations (DANGEROUS - USE ONLY FOR DEBUGGING)',
  tags: ['Debug'],
  body: {
    type: 'object',
    properties: {
      confirmReset: { 
        type: 'boolean',
        description: 'Must be true to confirm the database reset'
      },
      runMigrations: {
        type: 'boolean',
        default: true,
        description: 'Whether to run migrations after dropping tables'
      }
    },
    required: ['confirmReset']
  },
  response: {
    200: {
      type: 'object',
      properties: { 
        message: { type: 'string' },
        droppedTables: { 
          type: 'array',
          items: { type: 'string' }
        },
        totalTablesDropped: { type: 'number' },
        migrationsRun: { type: 'boolean' },
        migrationOutput: { type: 'string' }
      }
    },
    400: error_response_schema_400,
    401: error_response_schema_401,
    500: error_response_schema_500
  }
};

const DebugRoutesPlugin: FastifyPluginAsync = async (server: FastifyInstance, opts) => {
  // JWT authentication preHandler
  globalAuthentication(server);

  // Role-based authorization preHandler
  server.decorate('requireRole', function(allowedRoles: string[]) {
    return async function(request: FastifyRequest, reply: FastifyReply) {
      const user = request.user as any;
      if (!user || !user.type || !allowedRoles.includes(user.type)) {
        return reply.code(403).send({ 
          error: 'Forbidden', 
          message: `Access denied. Required roles: ${allowedRoles.join(', ')}` 
        });
      }
    };
  });

  server.post('/debug/clear-all', { 
    preHandler: [server.authenticate, server.requireRole(['admin'])],
    schema: clearAllTablesSchema 
  }, clearAllTables);

  server.post('/debug/clear-tables', { 
    preHandler: [server.authenticate, server.requireRole(['admin'])],
    schema: clearSpecificTablesSchema 
  }, clearSpecificTables);

  server.get('/debug/tables', { 
    preHandler: [server.authenticate, server.requireRole(['admin'])],
    schema: getAvailableTablesSchema 
  }, getAvailableTables);

  server.post('/debug/execute-seeder', { 
    preHandler: [server.authenticate, server.requireRole(['admin'])],
    schema: executeSeederSchema 
  }, executeSeeder);

  server.post('/debug/reset', { 
    preHandler: [server.authenticate, server.requireRole(['admin'])],
    schema: resetDatabaseSchema 
  }, resetDatabase);

};

// Function to reset the entire database
async function resetDatabase(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { confirmReset, runMigrations = true } = request.body as { confirmReset: boolean, runMigrations?: boolean };
    
    if (!confirmReset) {
      return reply.code(400).send({ 
        error: 'Database reset not confirmed',
        message: 'Set confirmReset to true to proceed with database reset'
      });
    }

    // Get all tables first
    const tablesResult = await request.db.execute(sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    if (!tablesResult.rows || tablesResult.rows.length === 0) {
      console.log('No tables found in database');
    }

    const tableNames = tablesResult.rows.map(row => (row as any).table_name);
    
    if (tableNames.length === 0) {
      console.log('No tables to drop proceed to migrations');
    }
    if (tableNames.length > 0) {
      // Drop all tables with CASCADE to handle dependencies
      const quotedTableNames = tableNames.map(name => `"${name}"`).join(', ');
      console.log(`Dropping all tables: ${quotedTableNames}`);
      
      const dropResult = await request.db.execute(sql`
        DROP TABLE IF EXISTS ${sql.raw(quotedTableNames)} CASCADE
      `);

      console.log('All tables dropped successfully');
    }
    let migrationOutput = '';
    let migrationsRun = false;

    // Run migrations if requested
    if (runMigrations) {
      try {
        console.log('Running drizzle commands...');
        
        console.log('1. Generating migrations...');
        const { stdout: generateStdout, stderr: generateStderr } = await execAsync('npx drizzle-kit generate', {
          cwd: process.cwd(),
          timeout: 30000 
        });

        if (generateStderr) {
          console.warn(`Generate stderr: ${generateStderr}`);
        }

        console.log('2. Running migrations...');
        const { stdout: migrateStdout, stderr: migrateStderr } = await execAsync('npx drizzle-kit migrate', {
          cwd: process.cwd(),
          timeout: 60000 
        });

        if (migrateStderr) {
          console.warn(`Migrate stderr: ${migrateStderr}`);
        }

        console.log('3. Pushing schema changes...');
        const { stdout: pushStdout, stderr: pushStderr } = await execAsync('npx drizzle-kit push', {
          cwd: process.cwd(),
          timeout: 60000 
        });

        if (pushStderr) {
          console.warn(`Push stderr: ${pushStderr}`);
        }

        // Combine all outputs
        const allOutputs = [
          '=== GENERATE ===',
          generateStdout || 'No generate output',
          '=== MIGRATE ===',
          migrateStdout || 'No migrate output',
          '=== PUSH ===',
          pushStdout || 'No push output'
        ].join('\n');

        migrationOutput = allOutputs;
        migrationsRun = true;
        console.log('All drizzle commands completed successfully');

        // Verify tables are recreated after migrations
        const postMigrationResult = await request.db.execute(sql`
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_type = 'BASE TABLE'
          ORDER BY table_name
        `);

        const recreatedTables = postMigrationResult.rows?.map(row => (row as any).table_name) || [];
        console.log(`Post-migration verification: ${recreatedTables.length} tables recreated`);

      } catch (migrationError: any) {
        console.error('Migration error:', migrationError);
        migrationOutput = `Migration failed: ${migrationError.message}`;
        migrationsRun = false;
      }
    }

    const redisCleared = await resetRedisGameState(request.server);
    if (redisCleared) {
      console.log('Redis game state cleared successfully');
    } else {
      console.warn('Failed to clear Redis game state');
    }

    reply.code(200).send({
      message: 'Database reset completed successfully',
      droppedTables: tableNames,
      totalTablesDropped: tableNames.length,
      migrationsRun: migrationsRun,
      migrationOutput: migrationOutput
    });

  } catch (error: any) {
    console.error('Error resetting database:', error);
    reply.code(500).send({
      error: 'Internal server error',
      message: error.message
    });
  }
}

async function executeSeeder(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { seederName } = request.body as { seederName: string };
    
    // Dynamically read package.json to get available seeders
    const packageJsonPath = join(process.cwd(), 'package.json');
    const packageJsonContent = readFileSync(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageJsonContent);
    
    // Get all available scripts
    const availableSeeders = Object.keys(packageJson.scripts);

    if (!availableSeeders.includes(seederName)) {
      return reply.code(400).send({ 
        error: `Invalid seeder name: ${seederName}. Should select from current valid seeders: ${availableSeeders.join(', ')}`,

      });
    }

    // Execute the npm script
    console.log(`Executing seeder: ${seederName}`);
    const { stdout, stderr } = await execAsync(`npm run ${seederName}`, {
      cwd: process.cwd(),
      timeout: 300000
    });

    if (stderr) {
      console.warn(`Seeder stderr: ${stderr}`);
    }

    reply.code(200).send({
      message: `Seeder ${seederName} executed successfully`,
      seederName: seederName,
      status: 'completed',
      output: stdout || 'No output'
    });

  } catch (error: any) {
    console.error(`Error executing seeder:`, error);
    
    if (error.code === 'ETIMEDOUT') {
      return reply.code(408).send({
        error: 'Seeder execution timed out',
        message: 'The seeder took too long to complete'
      });
    }

    reply.code(500).send({
      error: 'Internal server error',
      message: error.message,
      details: error.stderr || error.stdout || 'No additional details'
    });
  }
}

async function clearAllTables(request: FastifyRequest, reply: FastifyReply) {
  try {
    // Dynamically get all tables from the database
    const tablesResult = await request.db.execute(sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    if (!tablesResult.rows || tablesResult.rows.length === 0) {
      return reply.code(400).send({ error: 'No tables found in database' });
    }

    const tableNames = tablesResult.rows.map(row => (row as any).table_name);
    const quotedTableNames = tableNames.map(name => `"${name}"`).join(', ');

    // Use TRUNCATE CASCADE to automatically handle foreign key dependencies
    const result = await request.db.execute(sql`
      TRUNCATE TABLE ${sql.raw(quotedTableNames)} CASCADE
    `);

    const redisCleared = await resetRedisGameState(request.server);
    if (redisCleared) {
      console.log('Redis game state cleared successfully');
    } else {
      console.warn('Failed to clear Redis game state');
    }

    reply.code(200).send({
      message: 'All tables cleared successfully and redis game state cleared',
      clearedTables: tableNames,
      totalTables: tableNames.length,
    });

  } catch (error: any) {
    console.error('Error clearing tables:', error);
    reply.code(500).send({
      error: 'Internal server error',
      message: error.message
    });
  }
}

async function clearSpecificTables(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { tables } = request.body as { tables: string[] };
    
    if (!tables || !Array.isArray(tables) || tables.length === 0) {
      return reply.code(400).send({ error: 'Invalid tables array provided' });
    }

    // Check if "redis" is in the tables array
    const shouldClearRedis = tables.includes('redis');
    const dbTables = tables.filter(table => table !== 'redis');

    // Dynamically get all available tables from the database
    const availableTablesResult = await request.db.execute(sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    if (!availableTablesResult.rows || availableTablesResult.rows.length === 0) {
      return reply.code(400).send({ error: 'No tables found in database' });
    }

    const availableTableNames = availableTablesResult.rows.map(row => (row as any).table_name);
    const invalidTables = dbTables.filter(name => !availableTableNames.includes(name));
    
    if (invalidTables.length > 0) {
      return reply.code(400).send({ 
        error: `Invalid table names: ${invalidTables.join(', ')}`
      });
    }

    // Clear database tables if any were specified
    let dbResult = null;
    if (dbTables.length > 0) {
      const quotedTableNames = dbTables.map(name => `"${name}"`).join(', ');
      dbResult = await request.db.execute(sql`
        TRUNCATE TABLE ${sql.raw(quotedTableNames)} CASCADE
      `);
    }

    // Clear Redis if requested
    let redisCleared = false;
    if (shouldClearRedis) {
      try {
        if (request.server.redis?.flushall) {
          await request.server.redis.flushall();
          redisCleared = true;
        }
        if (request.server.redis?.dosletra?.flushall) {
          await request.server.redis.dosletra.flushall();
          redisCleared = true;
        }
        // Small delay to ensure Redis applies the flush
        await new Promise(resolve => setTimeout(resolve, 200));
        console.log('Redis game state cleared successfully');
      } catch (e) {
        request.log.warn({ err: e }, 'Failed to clear Redis during clearSpecificTables');
      }
    }

    reply.code(200).send({
      message: `Tables cleared successfully ${redisCleared ? 'and Redis game state cleared' : ''}`,
      clearedTables: dbTables,
      totalTables: dbTables.length,
      redisCleared,
      clearedRedis: shouldClearRedis && redisCleared
    });

  } catch (error: any) {
    console.error('Error clearing specific tables:', error);
    reply.code(500).send({
      error: 'Internal server error',
      message: error.message
    });
  }
}

async function getAvailableTables(request: FastifyRequest, reply: FastifyReply) {
  try {
    const tablesResult = await request.db.execute(sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    if (!tablesResult.rows || tablesResult.rows.length === 0) {
      return reply.code(404).send({ error: 'No tables found in database' });
    }

    const tableNames = tablesResult.rows.map(row => (row as any).table_name);

    reply.code(200).send({
      message: 'Available tables retrieved successfully',
      totalTables: tableNames.length,
      tables: tableNames
    });

  } catch (error: any) {
    console.error('Error getting available tables:', error);
    reply.code(500).send({
      error: 'Internal server error',
      message: error.message
    });
  }
}

export async function resetRedisGameState(server: FastifyInstance) {
  try {
    let ok = false;

    if (server.redis?.flushall) {
      await server.redis.flushall();
      ok = true;
    }

    if (server.redis?.dosletra?.flushall) {
      await server.redis.dosletra.flushall();
      ok = true;
    }

    // Small delay to allow Redis to settle
    await new Promise(resolve => setTimeout(resolve, 200));

    return ok;
  } catch (error) {
    console.error('Failed to clear Redis via client:', error);
    return false;
  }
}

export default DebugRoutesPlugin;
