import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  BetsTable,
  depositsTable,
  GameSessionsTable,
  GamesTable,
  TransactionsTable,
  TransactionTypeEnum,
  TransactionStatusEnum,
  UsersTable,
  withdrawsTable,
} from "../src/db/schema.ts";
import { eq, sql } from "drizzle-orm";

// Config
const TOTAL_PER_CATEGORY = 15; // per category overall (not per user)
const DAYS_BACK = 30; // randomize createdAt within this range

function randBetween(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function randomAmount(min = 10, max = 500, decimals = 4) {
  return Number(randBetween(min, max).toFixed(decimals)).toFixed(decimals);
}

function randomDateWithinDays(daysBack: number): Date {
  const now = new Date();
  const past = new Date(now.getTime() - Math.floor(Math.random() * daysBack) * 24 * 60 * 60 * 1000);
  past.setUTCHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60), Math.floor(Math.random() * 60), 0);
  return past;
}

async function ensureDemoGame(db: ReturnType<typeof drizzle>) {
  const [game] = await db.select().from(GamesTable).limit(1);
  if (game) return game;

  const [newGame] = await db
    .insert(GamesTable)
    .values({ name: "Demo Game", choices: ["A", "B"], commission: "0.0500" })
    .returning();
  return newGame;
}

async function ensureDemoSession(db: ReturnType<typeof drizzle>, gameId: number) {
  const [session] = await db.select().from(GameSessionsTable).limit(1);
  if (session) return session;
  const [newSession] = await db
    .insert(GameSessionsTable)
    .values({ gameId, round: `R-${Date.now()}` })
    .returning();
  return newSession;
}

async function main() {
  const connectionString = `postgresql://${process.env.DATABASE_USER}:${process.env.DATABASE_PASS}@${process.env.DATABASE_HOST}:${process.env.DATABASE_PORT}/${process.env.DATABASE_NAME}`;
  const pool = new Pool({ connectionString });
  const db = drizzle(pool);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    console.log("Seeding dummy transactions (deposit/withdraw/game)...");

    const users = await db.select({ id: UsersTable.id }).from(UsersTable).limit(20);
    if (users.length === 0) {
      throw new Error("No users found. Run testUsersSeeder first.");
    }

    // Ensure game/session for bets
    const game = await ensureDemoGame(db);
    const session = await ensureDemoSession(db, game.id);

    // Helper to pick a random user id
    const pickUserId = () => users[Math.floor(Math.random() * users.length)]!.id;

    // Deposits
    for (let i = 0; i < TOTAL_PER_CATEGORY; i++) {
      const userId = pickUserId();
      const amount = randomAmount();
      const when = randomDateWithinDays(DAYS_BACK);
      const [tx] = await db
        .insert(TransactionsTable)
        .values({
          userId,
          amount,
          type: "deposit" as (typeof TransactionTypeEnum.enumValues)[number],
          status: "completed" as (typeof TransactionStatusEnum.enumValues)[number],
          createdAt: when,
          updatedAt: when,
        })
        .returning({ id: TransactionsTable.id });

        await db
        .insert(depositsTable)
        .values({
          transactionId: tx.id,
          status: "completed",
          meta: {
            previousBalance: 0,
            updatedBalance: Number(amount),
          },
          createdAt: when,
          updatedAt: when,
        });
    }

    // Withdraws
    for (let i = 0; i < TOTAL_PER_CATEGORY; i++) {
      const userId = pickUserId();
      const amount = randomAmount(5, 300);
      const when = randomDateWithinDays(DAYS_BACK);
      const [tx] = await db
        .insert(TransactionsTable)
        .values({
          userId,
          amount,
          type: "withdraw" as (typeof TransactionTypeEnum.enumValues)[number],
          status: "completed" as (typeof TransactionStatusEnum.enumValues)[number],
          createdAt: when,
          updatedAt: when,
        })
        .returning({ id: TransactionsTable.id });

        await db
        .insert(withdrawsTable)
        .values({
          transactionId: tx.id,
          status: "completed",
          meta: {
            previousBalance: Number(amount),
            updatedBalance: 0,
          },
          createdAt: when,
          updatedAt: when,
        });
    }

    // Game bets (some wins, some losses)
    const choices = ["A", "B"];
    for (let i = 0; i < TOTAL_PER_CATEGORY; i++) {
      const userId = pickUserId();
      const amount = randomAmount(1, 200);
      const when = randomDateWithinDays(DAYS_BACK);
      const [tx] = await db
        .insert(TransactionsTable)
        .values({
          userId,
          amount,
          type: "bet" as (typeof TransactionTypeEnum.enumValues)[number],
          status: "completed" as (typeof TransactionStatusEnum.enumValues)[number],
          createdAt: when,
          updatedAt: when,
        })
        .returning({ id: TransactionsTable.id });

      const choice = choices[Math.floor(Math.random() * choices.length)];
      const isWin = Math.random() < 0.5; // 50% chance a bet has a winAmount
      const odds = "1.9500";
      const winAmount = isWin ? Number((Number(amount) * Number(odds)).toFixed(4)).toFixed(4) : "0.0000";
      await db
      .insert(BetsTable)
      .values({
        transactionId: tx.id,
        amount,
        odds,
        choice,
        winAmount,
        gameSessionId: session.id,
        createdAt: when,
        updatedAt: when,
      });
    }

    await client.query("COMMIT");
    console.log(
      `Seeded dummy transactions: ${TOTAL_PER_CATEGORY} deposits, ${TOTAL_PER_CATEGORY} withdraws, ${TOTAL_PER_CATEGORY} bets.`
    );
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seeding dummy transactions failed, rolled back.", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();


