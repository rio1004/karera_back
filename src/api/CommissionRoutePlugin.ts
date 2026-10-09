import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { FastifyPluginAsync } from 'fastify';
import { UsersTable, ReferralsTable, ReferralRepCodesTable, CommissionsTable, BetsTable, TransactionsTable, UserSessionTable } from "../db/schema.ts";
import { eq, sql, and, isNull, or, isNotNull } from 'drizzle-orm';
import {alias} from "drizzle-orm/pg-core";
import { globalAuthentication } from '../app.ts';

// =================
// ROUTES PLUGIN
// =================
const CommissionRoutePlugin: FastifyPluginAsync = async (server: FastifyInstance, opts) => {
  globalAuthentication(server);

  server.get(
    '/commission/history',
    { preHandler: server.authenticate, schema: commissionHistorySchema },
    getCommissionHistory
  );
};

// =================
// SCHEMAS
// =================
export const commissionHistorySchema = {
  tags: ["Commission"],
  querystring: {
    type: "object",
    properties: {
      sortBy: { type: "string", enum: ["date", "earnings", "name"], default: "date" },
      order: { type: "string", enum: ["asc", "desc"], default: "desc" },
      from: { type: "string", format: "date" },
      to: { type: "string", format: "date" },
      search: { type: "string" },
      page: { type: "number", minimum: 1, default: 1 },
      limit: { type: "number", minimum: 1, maximum: 100, default: 10 },
    },
    additionalProperties: false,
  },
  response: {
    200: {
      type: "object",
      properties: {
        totalPlayers: { type: "number" },
        totalReps: { type: "number" },
        totalCount: { type: "number" },
        page: { type: "number" },
        limit: { type: "number" },
        commissions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "number" },
              type: { type: "string" },
              fullName: { type: "string" },
              userName: { type: "string" },
              amount: { type: "number" },
              createdAt: { type: "string", format: "date-time" },
            },
            required: ["id", "type", "fullName", "userName", "amount", "createdAt"],
          },
        },
      },
      required: ["totalPlayers", "totalReps", "totalCount", "page", "limit", "commissions"],
    },
  },
};

// =================
// HANDLER
// =================
async function getCommissionHistory(request: FastifyRequest, reply: FastifyReply) {
  const loggedUser: any = request.user;
  const userId = loggedUser?.id;
  const userType = loggedUser?.type;

  const {
    page = 1,
    limit = 10,
    sortBy = "date",
    order = "desc",
    from,
    to,
    search,
  } = request.query as any;

  if (!userId) return reply.code(401).send({ error: "Unauthorized" });
  if (!["operator", "representative"].includes(userType)) {
    return reply.code(403).send({ error: "Only operator or representatives can view commission history" });
  }

  const Rep1Alias = alias(UsersTable, "rep1");
  const Rep2Alias = alias(UsersTable, "rep2");

  let base = request.db
    .select({
      id: CommissionsTable.id,
      createdAt: CommissionsTable.createdAt,
      opAmount: CommissionsTable.opAmount,
      rep1Amount: CommissionsTable.rep1Amount,
      rep2Amount: CommissionsTable.rep2Amount,
      operatorId: CommissionsTable.operatorId,
      rep1Id: CommissionsTable.rep1Id,
      rep2Id: CommissionsTable.rep2Id,

      playerId: UsersTable.id,
      playerFirstName: UsersTable.firstName,
      playerLastName: UsersTable.lastName,
      playerUserName: UsersTable.userName,

      rep1FirstName: Rep1Alias.firstName,
      rep1LastName: Rep1Alias.lastName,
      rep1UserName: Rep1Alias.userName,

      rep2FirstName: Rep2Alias.firstName,
      rep2LastName: Rep2Alias.lastName,
      rep2UserName: Rep2Alias.userName,
    })
    .from(CommissionsTable)
    .innerJoin(BetsTable, eq(BetsTable.id, CommissionsTable.betId))
    .innerJoin(TransactionsTable, eq(TransactionsTable.id, BetsTable.transactionId))
    .innerJoin(UsersTable, eq(UsersTable.id, TransactionsTable.userId))
    .innerJoin(ReferralsTable, eq(ReferralsTable.playerId, UsersTable.id))
    .leftJoin(Rep1Alias, eq(CommissionsTable.rep1Id, Rep1Alias.id))
    .leftJoin(Rep2Alias, eq(CommissionsTable.rep2Id, Rep2Alias.id))
    .where(
      or(
        eq(CommissionsTable.operatorId, userId),
        eq(CommissionsTable.rep1Id, userId),
        eq(CommissionsTable.rep2Id, userId)
      )
    );

  // ✅ Date filtering
  if (from) {
    base = base.where(sql`"commissions"."createdAt" >= ${from}`);
  }
  if (to) {
    base = base.where(sql`"commissions"."createdAt" <= ${to}`);
  }

  const rows = await base;

  const repCodes = await request.db
    .select()
    .from(ReferralRepCodesTable)
    .where(eq(ReferralRepCodesTable.repId, userId));

  const recruitedUserIds = repCodes.map(rc => rc.recruitedUserId);

  const mapped = rows.flatMap(r => {
    const items: any[] = [];

    if (userType === "operator") {
      if (r.operatorId === userId && r.opAmount && Number(r.opAmount) > 0) {
        items.push({
          id: r.id,
          type: "player",
          fullName: `${r.playerFirstName ?? ""} ${r.playerLastName ?? ""}`.trim(),
          userName: r.playerUserName ?? "",
          amount: Number(r.opAmount),
          createdAt: r.createdAt,
        });
      }

      if (r.rep1Amount && Number(r.rep1Amount) > 0) {
        items.push({
          id: r.id,
          type: "rep1",
          fullName: `${r.rep1FirstName ?? ""} ${r.rep1LastName ?? ""}`.trim(),
          userName: r.rep1UserName ?? "",
          amount: Number(r.rep1Amount),
          createdAt: r.createdAt,
        });
      }

      if (recruitedUserIds.includes(r.rep2Id) && r.rep2Amount && Number(r.rep2Amount) > 0) {
        items.push({
          id: r.id,
          type: "rep2",
          fullName: `${r.rep2FirstName ?? ""} ${r.rep2LastName ?? ""}`.trim(),
          userName: r.rep2UserName ?? "",
          amount: Number(r.rep2Amount),
          createdAt: r.createdAt,
        });
      }
    }

    if (userType === "representative") {
      if (r.rep1Id === userId && r.rep1Amount && Number(r.rep1Amount) > 0) {
        items.push({
          id: r.id,
          type: "player",
          fullName: `${r.playerFirstName ?? ""} ${r.playerLastName ?? ""}`.trim(),
          userName: r.playerUserName ?? "",
          amount: Number(r.rep1Amount),
          createdAt: r.createdAt,
        });
      }

      if (r.rep2Id === userId && r.rep2Amount && Number(r.rep2Amount) > 0) {
        items.push({
          id: r.id,
          type: "rep2",
          fullName: `${r.playerFirstName ?? ""} ${r.playerLastName ?? ""}`.trim(),
          userName: r.playerUserName ?? "",
          amount: Number(r.rep2Amount),
          createdAt: r.createdAt,
        });
      }

      if (recruitedUserIds.includes(r.rep2Id) && r.rep2Amount && Number(r.rep2Amount) > 0) {
        items.push({
          id: r.id,
          type: "player",
          fullName: `${r.rep2FirstName ?? ""} ${r.rep2LastName ?? ""}`.trim(),
          userName: r.rep2UserName ?? "",
          amount: Number(r.rep2Amount),
          createdAt: r.createdAt,
        });
      }
    }

    return items;
  });

  // ✅ Search filtering
  const filtered = search
    ? mapped.filter(m =>
        m.fullName.toLowerCase().includes(search.toLowerCase()) ||
        m.userName.toLowerCase().includes(search.toLowerCase())
      )
    : mapped;

  // ✅ Sorting
  const sorted = filtered.sort((a, b) => {
    let compareVal = 0;

    if (sortBy === "date") {
      compareVal = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    } else if (sortBy === "earnings") {
      compareVal = a.amount - b.amount;
    } else if (sortBy === "name") {
      compareVal = a.fullName.localeCompare(b.fullName);
    }

    return order === "asc" ? compareVal : -compareVal;
  });

    // ✅ Totals from ReferralsTable instead of sorted commissions
    const referrals = await request.db
    .select({
      id: ReferralsTable.id,
      rep1Id: ReferralsTable.rep1Id,
      rep2Id: ReferralsTable.rep2Id,
      playerId: ReferralsTable.playerId,
      operatorId: ReferralsTable.operatorId,
    })
    .from(ReferralsTable)
    .where(eq(ReferralsTable.operatorId, userId));

  const totalPlayers = referrals.filter(r => r.playerId !== null).length;
  const totalReps = referrals.filter(r => r.rep1Id !== null || r.rep2Id !== null).length;

  // 👉 internal only (not in response)
  const directRep1 = referrals.filter(r => r.rep1Id !== null && r.rep2Id === null).length;
  const directRep2 = referrals.filter(r => r.rep2Id !== null && r.rep1Id === null).length;
  const directPlayers = referrals.filter(
    r => r.playerId !== null && r.rep1Id === null && r.rep2Id === null
  ).length;

  const start = (page - 1) * limit;
  const paginated = sorted.slice(start, start + limit);

  return reply.code(200).send({
    totalPlayers,
    totalReps,
    totalCount: sorted.length,
    page,
    limit,
    commissions: paginated,
  });
}

export default CommissionRoutePlugin;
