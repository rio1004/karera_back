import { Pool, PoolClient } from "pg";
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { FastifyInstance, FastifyRequest } from "fastify";
import { create_app } from "../../src/app.ts";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from '../../src/db/schema.ts';
import { Channel, GameState, Message, SupportState } from "../../src/api/dosletra/DosLetraPlugin.ts";
import requestSupertest from 'supertest';
import WebSocket from 'ws';
import ExcelJS from "exceljs";
import  Workbook  from "exceljs";
import { EkycTable, StudiosTable } from "../../src/db/schema.ts";
import { and, eq, sql } from "drizzle-orm";

export class Utils {
  pool: Pool;
  server: FastifyInstance;
  pgClient: PoolClient | null = null;
  transactionalDb: NodePgDatabase<typeof schema> | null = null;
  dbName: string;

  /**
   *
   * @param url
   * @param dbName
   * @param createNewDb Set to false if the database is already created to run faster
   * @returns
   */
  async beforeAll(url: string, dbName: string, createNewDb: boolean = true, isMigrate: boolean = true): Promise<FastifyInstance> {
    this.dbName = dbName;
    if (createNewDb) {
      if (isMigrate){
        await Utils.create_test_db(url + dbName, dbName);
      } else {
        await Utils.create_test_db_from_template(url + dbName, dbName)
      }
    }

    this.pool = new Pool({
      connectionString: url + dbName,
      max: 10,
    });
    this.server = create_app(true)
    this.server.addHook('onRequest', async (request: FastifyRequest, reply) => {
      if (this.transactionalDb) {
        request.db = this.transactionalDb;
      } else {
        reply.code(500).send({ message: "Internal Test Error: Database context not available." });
        throw new Error("Internal Test Error: Database context not available for test request.");
      }
    });

    return this.server;
  }

  async afterAll() {
    if (this.pool) {
      await this.pool.end();
    }
    if (this.server) {
      await this.server.close();
    }
  }

  async beforeEach() {
    this.pgClient = await this.pool.connect();
    await this.pgClient.query('BEGIN');
    this.transactionalDb = drizzle(this.pgClient, { schema });
    this.server.db = this.transactionalDb;
    Utils.populateStudios(this.server.db);
  }

  async afterEach() {
    if (this.pgClient) {
      await this.pgClient.query('ROLLBACK');
      this.pgClient.release();
      this.pgClient = null;
      this.transactionalDb = null;
    }
    Utils.drop_test_db(this.dbName);
  }

  static async create_test_db(dbUrl: string, configName: string) {
    
    console.time('drizzle migration')
    const tempConfigPath = path.resolve(process.cwd(), configName);
    const drizzleConfigContent = `
    import { defineConfig } from 'drizzle-kit';
  
    export default defineConfig({
      schema: './src/db/schema.ts',
      out: './drizzle',
      dialect: 'postgresql',
      dbCredentials: {
        url: "${dbUrl}",
      }
    });
    `;
    fs.writeFileSync(tempConfigPath, drizzleConfigContent);
    const dbName = new URL(dbUrl).pathname.substring(1);
    const adminDbUrl = dbUrl.substring(0, dbUrl.lastIndexOf('/')) + '/postgres';

    // 3. Connect to the admin DB to manage the test database
    const adminPool = new Pool({ connectionString: adminDbUrl });
    const adminClient = await adminPool.connect();

    // 4. Recreate the test database
    try {
      await adminClient.query(`SELECT pg_terminate_backend(pg_stat_activity.pid) FROM pg_stat_activity WHERE pg_stat_activity.datname = '${dbName}';`);
      await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
      await adminClient.query(`CREATE DATABASE "${dbName}";`);
    } catch (error) {
      console.error('Failed to recreate the test database.', error);
      throw error;
    } finally {
      adminClient.release();
      await adminPool.end();
    }

    // 5. Run Drizzle migrations using the temporary config file
    try {
      execSync(`npx drizzle-kit migrate --config=${tempConfigPath}`, { stdio: 'inherit' });
    } catch (error: any) {
      console.error('Failed to run Drizzle migrations.');
      // The stderr from the failed command should give us the reason.
      if (error.stderr) {
        console.error(error.stderr.toString());
      }
      throw error;
    }
    console.timeEnd('drizzle migration')
  }


  static async create_test_db_from_template(dbUrl: string, configName: string) {
    
    console.time('drizzle migration') 
    
    const dbName = new URL(dbUrl).pathname.substring(1);
    const adminDbUrl = dbUrl.substring(0, dbUrl.lastIndexOf('/')) + '/postgres';

    // 3. Connect to the admin DB to manage the test database
    const adminPool = new Pool({ connectionString: adminDbUrl });
    const adminClient = await adminPool.connect();

    // 4. Recreate the test database
    try {
      await adminClient.query(`SELECT pg_terminate_backend(pg_stat_activity.pid) FROM pg_stat_activity WHERE pg_stat_activity.datname = '${dbName}';`);
      await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
      await adminClient.query(`CREATE DATABASE "${dbName}" WITH TEMPLATE = karera;`);
    } catch (error) {
      console.error('Failed to recreate the test database.', error);
      throw error;
    } finally {
      adminClient.release();
      await adminPool.end();
    }
 
    console.timeEnd('drizzle migration')
  }

  static async drop_test_db(configName: string) {
    const tempConfigPath = path.resolve(process.cwd(), configName);
    if (fs.existsSync(tempConfigPath)) {
      fs.unlinkSync(tempConfigPath);
    }
  }


  public static async delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      let timeout = setTimeout(() => {
        clearTimeout(timeout);
        resolve();
      }, ms);
    });
  }


  public static async registerUser(server: FastifyInstance, user: User): Promise<any> {
    const response = await requestSupertest(server.server)
      .post('/register')
      .send(user)
      .expect(201);
    return response.body;
  }

  public static async initialDeposit(server: FastifyInstance, token: string): Promise<void> {
    const response = await requestSupertest(server.server)
      .post('/deposit')
      .set('Authorization', `Bearer ${token}`)
      .send({
        amount: `1000`,
      })
      .expect(201);
  }

  // create initial game using moderator token that will return game id
  public static async createInitialGame(server: FastifyInstance, moderatorToken: string): Promise<string> {
    const response = await requestSupertest(server.server)
      .post('/game')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({
        name: `Game Test for Betting ${Date.now()}`,
        choices: ['A', 'B'],
        commission: 0.10,
      }).expect(201);
    const gameId = response.body.id;

    const hostIdentifier = Math.random();
    const hostNumber = '09' + Math.floor(100000000 + hostIdentifier * 900000000);
    
    const payload = {
      firstName: 'Host Fname',
      lastName: 'Host Lname',
      userName: `Hostusername${hostNumber}`,
      email: `hostemail${hostNumber}@example.com`,
      mobile: hostNumber,
      type: 'host',
      password: 'password123',
      ekycTransactionId: `ekyc_${Date.now()}_${hostNumber}`,
      permanentAddress: 'Test Permanent Address',
      currentAddress: 'Test Current Address',
      birthDate: '1990-01-01',
      birthPlace: 'Test City',
      nationality: 'Test Nationality',
      gamingSite: 'Test Gaming Site',
      natureOfWork: 'Test Work',
      sourceOfIncome: 'Test Income',
    };
    
    await requestSupertest(server.server).post('/register').send(payload);
    
    await requestSupertest(server.server)
      .post('/login')
      .send({
        userNameOrEmail: payload.userName,
        password: payload.password,
      }).expect(200);

    const host = await server.db.query.UsersTable.findFirst({
      where: and(
        eq(schema.UsersTable.type, 'host'),
        eq(schema.UsersTable.userName, payload.userName)
      )
    })
    const roomRes = await requestSupertest(server.server)
      .post('/rooms')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({
        gameId: gameId,
        hostId: host.id,
        studioNo: 'DL01'
      }).expect(201)
    return gameId;
  }

  public static async populateStudios(targetdb:NodePgDatabase<typeof schema>) {
    const studios = [
      { studioNo: "DL01" },
      { studioNo: "DL02" },
      { studioNo: "DL03" },
      { studioNo: "DL04" },
      { studioNo: "DL05" },
    ];
    try {
      for (const studio of studios) {
        const exists = await targetdb
          .select()
          .from(StudiosTable)
          .where(sql`${StudiosTable.studioNo} = ${studio.studioNo}`);
  
        if (exists.length === 0) {
          await targetdb.insert(StudiosTable).values(studio);
        }
      }
    } catch (err) {
      console.error("Populating studios failed:", err);
    }
  }

  // create get player wallet balance using player token and return balance
  public static async getPlayerWalletBalance(server: FastifyInstance, playerToken: string): Promise<number> {
    const response = await requestSupertest(server.server)
      .get('/balance')
      .set('Authorization', `Bearer ${playerToken}`)
      .expect(200);

    const walletLists:any[] = response.body.wallets;
    const gameWallet = walletLists.find(wallet => wallet.type === 'game');
    return gameWallet.balance;
  }

  public static async connectWs(server: FastifyInstance, user: User, port: number): Promise<WebSocket> {
    const login = await requestSupertest(server.server)
      .post('/login')
      .send({
        userNameOrEmail: user.userName,
        password: user.password,
      })
      .expect(200);

    const ws = new WebSocket(`ws://localhost:${port}/api/studio/DL01`);

    return new Promise<WebSocket>((resolve, reject) => {
      ws.onopen = (event) => {
        ws.send(JSON.stringify(new Message(Channel.Game, GameState.Authenticate, {
          data: {
            token: login.body.token,
          }
        })));
        resolve(ws);
      };
    });
  }

  public static async connectWsWithToken(token: string, port: number): Promise<WebSocket> {
    const ws = new WebSocket(`ws://localhost:${port}/api/studio/DL01`);
    return new Promise<WebSocket>((resolve, reject) => {
      ws.onopen = () => {
        ws.send(JSON.stringify(new Message(Channel.Game, GameState.Authenticate, {
          data: { token }
        })));
        resolve(ws);
      };
      ws.onerror = (err) => reject(err as any);
    });
  }

  public static getMobileNumber(index: number): string {
    const indexString = String(index);
    // Pad with leading zeros to at least 9 digits, then take the last 9 digits
    // to ensure it's exactly 9 digits long, truncating from the left if needed.
    const formattedIndex = indexString.padStart(9, '0').slice(-9);
    return `09${formattedIndex}`;
  }

  public static sendGameState(ws: WebSocket, state: SupportState | GameState, data: any) {
    const msg = new Message(Channel.Game, state, data); // just pass data
    ws.send(JSON.stringify(msg));
  }

  public static async waitGameState(
    ws: WebSocket, 
    state: GameState, 
    clearFn: () => void = () => {},
    stateName: string = ""
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let id = setTimeout(() => {
        clearFn();
        clearTimeout(id);
        reject(new Error('waitGameState exceeded 500ms'));
      }, 5000);
  
      ws.onmessage = (event) => {
        const parsedMessage = JSON.parse(event.data.toString());
        if (parsedMessage.channel === Channel.Game && parsedMessage.state === state) {
          clearTimeout(id);
          resolve();
        }
      }
  
      
    });
  }


  public static waitForOdds(
    ws: WebSocket, 
    state: GameState, 
    clearFn: () => void = () => {},
    stateName: string = ""
  ): Promise<{A: number, B: number}> {
    return new Promise<{A: number, B: number}>((resolve, reject) => {
      
      ws.onmessage = (event) => {
        const parsedMessage = JSON.parse(event.data.toString());
        
        // Check if this is an Update message with odds data
        if (parsedMessage.channel === Channel.Game && 
            parsedMessage.state === "Update" && 
            parsedMessage.data && 
            parsedMessage.data.odds) {
          const odds = parsedMessage.data.odds;
          resolve(odds);
        }
      }
    });
  }

  public static getUpdate(ws: WebSocket) {
    ws.send(JSON.stringify(new Message(Channel.Game, GameState.Update, {data:JSON.stringify({})})));
  }

    // inside Utils class

    public static async createGameSession(server: FastifyInstance, moderatorToken: string, gameId: string): Promise<string> {
      const response = await requestSupertest(server.server)
        .post('/session')
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({
          gameId,
          state: 'Open',
        })
        .expect(201);
      return response.body.id;
    }
  
    public static async createBetAndWin(
      server: FastifyInstance,
      playerToken: string,
      sessionId: string,
      betAmount: number,
      winAmount: number
    ): Promise<void> {
      // Place bet
      await requestSupertest(server.server)
        .post('/bet')
        .set('Authorization', `Bearer ${playerToken}`)
        .send({
          sessionId,
          choice: "A",   // hardcoded choice for test
          amount: betAmount,
        })
        .expect(201);
  
      // Record win
      await requestSupertest(server.server)
        .post('/win')
        .set('Authorization', `Bearer ${playerToken}`)
        .send({
          sessionId,
          choice: "A",
          odds: { A: winAmount / betAmount }, // make odds produce desired winAmount
          winners: [playerToken],
        })
        .expect(201);
    }

    public static async createEkyc(
      db: NodePgDatabase<typeof schema>,
      { userId }: { userId: number }
    ) {
      // 1️⃣ Check if the user exists
      const user = await db.query.UsersTable.findFirst({
        where: (user, { eq }) => eq(user.id, userId),
      });
      if (!user) throw new Error("User does not exist");
  
      // 2️⃣ Check if an eKYC record already exists
      const existingEkyc = await db.query.EkycTable.findFirst({
        where: (ekyc, { eq }) => eq(ekyc.userId, userId),
      });
      if (existingEkyc) throw new Error("eKYC already exists for this user");
  
      // 3️⃣ Insert a new eKYC record
      const [inserted] = await db.insert(EkycTable).values({
        userId,
        status: "UNVERIFIED",
      }).returning();
  
      // 4️⃣ Return the inserted record
      return inserted;
    }
  
}

export class User {
  firstName: string;
  lastName: string;
  userName: string;
  email: string;
  mobile: string;
  type: string;
  password: string;
}

export class Data {
  mobile: string;
  type: string;
  index: number;
  odds: number;
  amount: number;
  token?: string;
}

export class Connection {
  data: Data;
  ws: WebSocket;
}


export async function readExcelTable(filePath: string, sheetName: string): Promise<Record<string, string>[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath)
  const worksheet = workbook.getWorksheet(sheetName);

  const content:string[][] = []
  worksheet?.eachRow({includeEmpty:true},(row) => {
    const cel = []
    row.eachCell({includeEmpty:true}, (col) => {
      cel.push(col.value || "");
    })
    content.push(cel);
  });
  const headers = content[0];
  const body = content.slice(1);

  return body.map(row => headers.reduce((obj, key, index) => {
    obj[key] = row[index];
    return obj;
  },{}));
}

