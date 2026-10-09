import {FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply, RouteHandlerMethod} from "fastify";
import {UsersTable, UserSessionTable} from "../db/schema.ts";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcrypt";
import { globalAuthentication } from "../app.ts";

const resp = {200: {type: "object", properties: {message: {type: "string"}}}};

const schema = (withOld: boolean) => ({
  tags: ["Password"],
  body: {
    type: "object",
    required: withOld
      ? ["oldPassword", "newPassword", "newRepeatPassword"]
      : ["newPassword", "newRepeatPassword"],
    properties: {
      ...(withOld && {oldPassword: {type: "string", minLength: 6}}),
      newPassword: {type: "string", minLength: 6},
      newRepeatPassword: {type: "string", minLength: 6},
    },
  },
  response: resp,
});

type Body = { oldPassword?: string; newPassword: string; newRepeatPassword: string };

const handleChange = (requireOld: boolean): RouteHandlerMethod =>
  async (req: FastifyRequest<{ Body: Body }>, reply: FastifyReply) => {
    const userId = req.user?.id;
    const {oldPassword, newPassword, newRepeatPassword} = req.body;

    if (newPassword !== newRepeatPassword)
      return reply.code(400).send({error: "Passwords do not match"});

    const [user] = await req.db
      .select({hashedPassword: UsersTable.hashedPassword})
      .from(UsersTable)
      .where(eq(UsersTable.id, userId));

    if (!user) return reply.code(404).send({error: "User not found"});

    if (requireOld) {
      if (!(await bcrypt.compare(oldPassword ?? "", user.hashedPassword)))
        return reply.code(401).send({error: "Incorrect old password"});
      if (await bcrypt.compare(newPassword, user.hashedPassword))
        return reply.code(400).send({error: "New password cannot be the same as old"});
    }

    await req.db
      .update(UsersTable)
      .set({hashedPassword: await bcrypt.hash(newPassword, 10), updatedAt: new Date()})
      .where(eq(UsersTable.id, userId));

    return reply.send({message: "Password changed successfully"});
  };

const PasswordRoutesPlugin: FastifyPluginAsync = async (server: FastifyInstance) => {
  globalAuthentication(server);

  server.register(
    async (r) => {
      r.addHook("preHandler", r.authenticate);
      r.patch("/change", {schema: schema(true)}, handleChange(true));
      r.patch("/reset", {schema: schema(false)}, handleChange(false));
    },
    {prefix: "/password"}
  );
};

export default PasswordRoutesPlugin;
