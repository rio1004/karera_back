import "dotenv/config";
import bcrypt from "bcrypt";
import { UsersTable, WalletTable, GamesTable, ProfilesTable, EkycTable } from "../src/db/schema.ts";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "../src/db/index.ts";
import { Utils } from "../tests/utils/utils.ts";

const USER_COUNTS = {
  player: 10,
  admin: 1,
  moderator: 1,
  host: 2,
};

const PASSWORD = "GlobalX@2025";
const SALT_ROUNDS = 10;
const EMAIL_DOMAIN = "globalx.com.ph";
const INITIAL_DEPOSIT = "10000.0000";

async function ensureUser(userRow: any) {
  const existing = await db
    .select()
    .from(UsersTable)
    .where(eq(UsersTable.email, userRow.email))
    .limit(1);
  
  if (existing.length) {
    console.log(`User already exists: ${userRow.email}`);
    return existing[0];
  }
  
  const [inserted] = await db.insert(UsersTable).values(userRow).returning();
  console.log(`Created new user: ${userRow.email}`);
  return inserted;
}

async function ensureProfile(userId: string, hostProfile: any) {
  const existing = await db
    .select()
    .from(ProfilesTable)
    .where(eq(ProfilesTable.userId, userId))
    .limit(1);
  
  if (existing.length) {
    console.log(`Profile already exists for userId=${userId}`);
    return existing[0];
  }
  
  const [inserted] = await db
    .insert(ProfilesTable)
    .values({
      permanentAddress: hostProfile.location,
      birthDate: hostProfile.birthDate,
      meta: sql`${JSON.stringify(hostProfile)}::jsonb`,
      userId,
    })
    .returning();
  
  console.log(`Created profile for userId=${userId}`);
  return inserted;
}

async function ensureEkyc(userId: string) {
  const existing = await db
    .select()
    .from(EkycTable)
    .where(eq(EkycTable.userId, userId))
    .limit(1);
  
  if (existing.length) {
    console.log(`eKYC already exists for userId=${userId}`);
    return existing[0];
  }
  
  const ekyc = await Utils.createEkyc(db, { userId });
  console.log(`Created eKYC for userId=${userId}`);
  return ekyc;
}

async function ensureWallet(userId: string) {
  const existing = await db
    .select()
    .from(WalletTable)
    .where(eq(WalletTable.userId, userId))
    .limit(1);
  
  if (existing.length) {
    console.log(`Wallet already exists for userId=${userId}`);
    return existing[0];
  }
  
  const now = new Date();
  const [inserted] = await db
    .insert(WalletTable)
    .values({
      userId,
      balance: INITIAL_DEPOSIT,
      onHoldBalance: "0",
      status: "active",
      createdAt: now,
      updatedAt: now,
      pinHash: null,
    })
    .returning();
  
  console.log(`Created wallet for userId=${userId} with balance ${INITIAL_DEPOSIT}`);
  return inserted;
}

async function ensureGame(defaultGame: any) {
  await db.insert(GamesTable).values(defaultGame).onConflictDoNothing({ target: GamesTable.name });
  console.log(`Default game ensured: ${defaultGame.name}`);
}

async function main() {
  const client = await pool.connect();
  console.log("Database connection successful!");
  
  try {
    await client.query("BEGIN");
    console.log("Seeding test users...");
    
    const hashedPassword = await bcrypt.hash(PASSWORD, SALT_ROUNDS);
    
    const hostProfiles = [
      { location: "Cavite City", birthDate: "1990-05-12", zodiac: "Taurus", talent: "Singing" },
      { location: "Manila City", birthDate: "1987-11-03", zodiac: "Scorpio", talent: "Dancing" },
      { location: "Taguig City", birthDate: "1995-07-21", zodiac: "Cancer", talent: "Acting" },
      { location: "Pasay City", birthDate: "1992-02-28", zodiac: "Pisces", talent: "Magic" },
    ];
    
    let idCounter = 1;
    let hostCounter = 1;
    const processedUsers: any[] = [];
    
    for (const [role, count] of Object.entries(USER_COUNTS)) {
      for (let i = 0; i < count; i++) {
        let email: string;
        let userName: string;
        let firstName: string;
        let lastName: string;
        let mobile: string;
        
        if (role === "player") {
          email = `${role}${idCounter}@${EMAIL_DOMAIN}`;
          userName = `${role}${idCounter}`;
          firstName = `PlayerFirst${idCounter}`;
          lastName = `PlayerLast${idCounter}`;
          mobile = `+639${String(900000000 + idCounter).padStart(9, "0")}`;
        } else if (role === "host") {
          email = `host${hostCounter}@${EMAIL_DOMAIN}`;
          userName = `host${hostCounter}`;
          firstName = `HostFirst${hostCounter}`;
          lastName = `HostLast${hostCounter}`;
          mobile = `+639${String(910000000 + hostCounter).padStart(9, "0")}`; // 👈 host mobiles follow host index
          hostCounter++;
        } else {
          email = `${role}@${EMAIL_DOMAIN}`;
          userName = role;
          firstName = `${role.charAt(0).toUpperCase() + role.slice(1)}First`;
          lastName = `${role.charAt(0).toUpperCase() + role.slice(1)}Last`;
          mobile = `+639${String(920000000 + idCounter).padStart(9, "0")}`;
        }
        
        const userRow = {
          firstName,
          lastName,
          userName,
          email,
          mobile,
          type: role as "player" | "admin" | "moderator" | "host",
          hashedPassword,
        };
        
        const user = await ensureUser(userRow);
        
        if (role === "host") {
          const hostProfile = hostProfiles[i];
          if (!hostProfile) throw new Error(`Not enough hostProfiles for ${count} hosts`);
          await ensureProfile(user.id, hostProfile);
        }
        
        await ensureEkyc(user.id);
        await ensureWallet(user.id);
        
        processedUsers.push(user);
        idCounter++;
      }
    }
    
    await ensureGame({
      name: "Dos Letra",
      choices: ["A", "B"],
      commission: "0.08",
    });
    
    await client.query("COMMIT");
    console.log(`Seeder finished. Processed ${processedUsers.length} users.`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seeding failed, rolled back changes:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
