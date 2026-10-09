import {FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply} from "fastify";
import { exec } from "child_process";
import util from "util";

const execPromise = util.promisify(exec);
const errorSchema = {
  type: "object",
  properties: { error: { type: "string" } },
};

const resetAllSchema = {
  description: "Truncate all listed tables and reseed",
  tags: ["admin", "reset"],
  response: {
    200: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        message: { type: "string" },
        tables: { type: "array", items: { type: "string" } },
        seeded: { type: "boolean" },
      },
    },
    500: errorSchema,
  },
};

const resetAllHandler = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const result = await req.db.execute(
      `SELECT tablename
       FROM pg_tables
       WHERE schemaname = 'public'
       ORDER BY tablename;`
    );
    
    const tableNames = result.rows.map((r: any) => r.tablename);
    
    for (const tableName of tableNames) {
      req.log.debug(`Truncating ${tableName}`);
      await req.db.execute(
        `TRUNCATE TABLE "${tableName}" RESTART IDENTITY CASCADE;`
      );
    }
    
    req.log.info("Running reseed scripts...");
    await execPromise("npm run seed:initial-data");
    
    return reply.send({
      success: true,
      message: "All tables truncated and reseeded successfully",
      tables: tableNames,
      seeded: true,
    });
    
  } catch (err: any) {
    req.log.error(err);
    return reply
      .code(500)
      .send({ error: "Failed to truncate/seed tables: " + err.message });
  }
};

const ResetAllPlugin: FastifyPluginAsync = async (server: FastifyInstance) => {
  server.register(async (r) => {
    // r.addHook("preHandler", r.authenticate);
    r.post("/reset-all", {schema: resetAllSchema},resetAllHandler);
  });
};


export default ResetAllPlugin;
