import { db } from "../src/db/index.ts";
import { 
  TransactionsTable, 
  BetsTable, 
  depositsTable, 
  withdrawsTable, 
  GiftsTable, 
  UsersTable, 
  GamesTable, 
  GameSessionsTable,
  RoomsTable,
  StudiosTable
} from "../src/db/schema.ts";
import { eq } from "drizzle-orm";

async function seedPlayerTransactions() {
  try {
    console.log("Fetching player users...");
    const players = await db.select().from(UsersTable).where(eq(UsersTable.type, "player"));
    console.log("Fetching games...");
    const games = await db.select().from(GamesTable);
    console.log("Fetching game sessions...");
    let sessions = await db.select().from(GameSessionsTable);
  
    if (!sessions.length) {
      if (!games.length) throw new Error("Missing games. Run: npm run seed:test-game-and-users");
      console.log("No sessions found. Creating a room and session...");
  
      const [moderator] = await db.select().from(UsersTable).where(eq(UsersTable.type, "moderator")).limit(1);
      if (!moderator) throw new Error("Missing moderator. Run: npm run seed:test-game-and-users");
  
      const studios = await db.select().from(StudiosTable);
      if (!studios.length) throw new Error("Missing studios. Run: npm run seed:studios");
  
      const game = games[Math.floor(Math.random() * games.length)];
      const studio = studios[Math.floor(Math.random() * studios.length)];
  
      const [room] = await db.insert(RoomsTable).values({
        gameId: game.id,
        moderatorId: moderator.id,
        studioNo: studio.studioNo,
        createdByUserId: moderator.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();
  
      const [session] = await db.insert(GameSessionsTable).values({
        gameId: game.id,
        roomId: room.id,
        status: "in progress",
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();
  
      sessions = [session];
    }
  
    if (!players.length || !games.length || !sessions.length) {
      throw new Error("Missing players, games, or sessions. Please seed them first.");
    }

    const transactions: any[] = [];
    const bets: any[] = [];
    const deposits: any[] = [];
    const withdraws: any[] = [];
    const gifts: any[] = [];

    const today = new Date();

    for (const user of players) {
      for (let i = 0; i < 5; i++) {
        const daysAgo = Math.floor(Math.random() * 7);
        const createdAt = new Date(today);
        createdAt.setDate(today.getDate() - daysAgo);

        const game = games[Math.floor(Math.random() * games.length)];
        const session = sessions[Math.floor(Math.random() * sessions.length)];
        const amount = parseFloat((Math.random() * 100).toFixed(4));
        const winAmount = Math.random() > 0.5 ? parseFloat((amount * 2).toFixed(4)) : 0;

        // Pick a type randomly
        const types = ["bet", "deposit", "withdraw", "gift"];
        const type = types[Math.floor(Math.random() * types.length)];

        // ---- Bet ----
        if (type === "bet") {
          const betTx = {
            userId: user.id,
            type: "bet",
            status: "completed",
            amount,
            createdAt,
            updatedAt: createdAt,
          };
          transactions.push({ tx: betTx, kind: "bet", sessionId: session.id, amount, winAmount });
        }

        // ---- Deposit ----
        if (type === "deposit") {
          const depositTx = {
            userId: user.id,
            type: "deposit",
            status: "completed",
            amount,
            createdAt,
            updatedAt: createdAt,
          };
          transactions.push({ tx: depositTx, kind: "deposit" });
        }

        // ---- Withdraw ----
        if (type === "withdraw") {
          const withdrawTx = {
            userId: user.id,
            type: "withdraw",
            status: "completed",
            amount,
            createdAt,
            updatedAt: createdAt,
          };
          transactions.push({ tx: withdrawTx, kind: "withdraw" });
        }

        // ---- Gift ----
        if (type === "gift") {
          const receiver = players[Math.floor(Math.random() * players.length)];
          if (receiver.id === user.id) continue;
          const giftTx = {
            userId: user.id,
            type: "gift",
            status: "completed",
            amount,
            createdAt,
            updatedAt: createdAt,
          };
          transactions.push({ tx: giftTx, kind: "gift", receiverId: receiver.id });
        }
      }
    }

    console.log(`Inserting ${transactions.length} transactions...`);
    const inserted = await db
      .insert(TransactionsTable)
      .values(transactions.map(t => t.tx))
      .returning({ id: TransactionsTable.id, type: TransactionsTable.type });

    let betIdx = 0, depositIdx = 0, withdrawIdx = 0, giftIdx = 0;

    inserted.forEach((row, idx) => {
      const original = transactions[idx];
      if (original.kind === "bet") {
        bets.push({
          transactionId: row.id,
          gameSessionId: original.sessionId,
          choice: "A",
          amount: original.amount,
          fee: 0,
          winAmount: original.winAmount,
          odds: 2.0,
          meta: { round: 1 },
          createdAt: original.tx.createdAt,
          updatedAt: original.tx.updatedAt,
          deletedAt: null,
        });
        betIdx++;
      }
      if (original.kind === "deposit") {
        deposits.push({ transactionId: row.id, status: "success", meta: { method: "GCash" } });
        depositIdx++;
      }
      if (original.kind === "withdraw") {
        withdraws.push({ transactionId: row.id, status: "success", meta: { method: "Bank" } });
        withdrawIdx++;
      }
      if (original.kind === "gift") {
        gifts.push({ transactionId: row.id, receiverId: original.receiverId, status: "sent", meta: { note: "Seeder gift" } });
        giftIdx++;
      }
    });

    if (bets.length) await db.insert(BetsTable).values(bets);
    if (deposits.length) await db.insert(depositsTable).values(deposits);
    if (withdraws.length) await db.insert(withdrawsTable).values(withdraws);
    if (gifts.length) await db.insert(GiftsTable).values(gifts);

    console.log("✅ Seeding player transactions completed!");
  } catch (err) {
    console.error("❌ Error seeding player transactions:", err);
  }
}

seedPlayerTransactions();
