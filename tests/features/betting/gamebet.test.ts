import { FastifyInstance } from "fastify";
import { Connection, Data, User } from "../../utils/utils.ts";
import { Utils } from "../../utils/utils.ts";
import ExcelJS from "exceljs";
import UserRoutesPlugin from "../../../src/api/UserRoutesPlugin.ts";
import DosLetraPlugin, { GameState, Channel, Message } from "../../../src/api/dosletra/DosLetraPlugin.ts";
import WebSocket from 'ws';
import TransactionRoutesPlugin from "../../../src/api/TransactionRoutesPlugin.ts";
import GameRoutesPlugin from "../../../src/api/GameRoutesPlugin.ts";
import WalletRoutesPlugin from "../../../src/api/WalletRoutesPlugin.ts";
import requestSupertest from 'supertest';
import RoomRoutesPlugin from "../../../src/api/RoomsRoutesPlugin.ts";
 
const port = 8021;
const defaultStudio = 'DL01';

describe('dosletra bet test', () => {
  const url = "postgresql://postgres:postgres@aggregator_db:5432/";
  const dbName = "kareraBetTest";
  let server: FastifyInstance;
  let utils: Utils = new Utils();
 
  beforeAll(async () => {
    const init_db = true;
    server = await utils.beforeAll(url, dbName, init_db);
 
    await server.register(UserRoutesPlugin);
    await server.register(TransactionRoutesPlugin);
    await server.register(GameRoutesPlugin);
    await server.register(WalletRoutesPlugin);
    await server.register(RoomRoutesPlugin);
    await server.register(DosLetraPlugin, { speed: 20.0, countdownSpeed: 100.0 });
 
    await server.redis.dosletra.select(1);
 
    await server.ready();
    await server.listen({ port: port });
  }, 30000);
 
  afterAll(async () => {
    if (server && server.authenticatedSockets) {
      server.authenticatedSockets.forEach(socket => {
        for (const [userMobile, userSocket] of socket) {
          if (userSocket.ws && userSocket.ws.readyState === WebSocket.OPEN) {
            userSocket.ws.close();
          }
        }
      });
    }
    await server.close();
    await utils.afterAll();
  });
 
  beforeEach(async () => {
    await utils.beforeEach();
    await server.clearDosLetraRedis();
  });
 
  afterEach(async () => {
    await utils.afterEach();
    await server.clearDosLetraRedis();
  });
 
  it('Users from bet.xlsx should be able to bet and the bet amount should be deducted from the wallet', async () => {
    const sheet = await getSheet('tests/features/betting/bet.xlsx');
    const users = await getUsersData(sheet, 13);
    let odds0 = toNumber(sheet.getCell(10, 3).result);
    let odds1 = toNumber(sheet.getCell(10, 4).result);
    const conns = await initConnections(server, users, port);
    // set game state to new game before opening the game
    let moderatorToken = (conns.get("09000000000")!.data as any).token;
    if (!moderatorToken) {
      throw new Error("Moderator token not found");
    }
    
    let gameid = await Utils.createInitialGame(server, moderatorToken);
    console.log('Game created:', gameid);

    // Start new game
    console.log('Starting new game...');
    await Utils.sendGameState(conns.get("09000000000")!.ws, GameState.NewGame, {
      "data": {"gameId": gameid}
    });
    await waitForGameState(conns.get("09000000000")!.ws, GameState.NewGame, 'moderator');
    console.log('New game started');
    
    // Open game for betting
    console.log('Opening game for betting...');
    await Utils.sendGameState(conns.get("09000000000")!.ws, GameState.Open, { data: {play:false} });
    await waitForGameState(conns.get("09000000000")!.ws, GameState.Open, 'moderator');
    console.log('Game opened for betting');
       

    let finalOdds = {A: 0, B: 0};
    
    // Store initial balances before betting
    const initialBalances = new Map<string, number>();
    for (let i = 1; i < conns.size; i++) {
      const mobileNumber = Utils.getMobileNumber(i);
      if (mobileNumber === "09000000000") {
        continue;
      }
      const conn = conns.get(mobileNumber);
      const data = conn.data as Data;
      if (data.amount && data.amount > 0) {
        const initialBalance = await Utils.getPlayerWalletBalance(server, (conn.data as any).token);
        initialBalances.set(mobileNumber, initialBalance);
      }
    }
    
    // Place bets one by one and wait for confirmation
    console.log('Players placing bets...');
    const betResults = new Map<string, any>();
    
    for (let i = 1; i < conns.size; i++) {
      const mobileNumber = Utils.getMobileNumber(i);
      // skip the moderator
      if (mobileNumber === "09000000000") {
        continue;
      }
      const conn = conns.get(mobileNumber);
 
      const data = conn.data as Data;
      if (!data.amount || data.amount === 0) {
        console.log(`Player ${data.mobile} is not betting`);
        continue;
      }
      let betAmount = data.amount;
      let choice = data.index === 0 ? 'A' : 'B';
      
      console.log(`Player ${data.mobile} placing bet: ${betAmount} on ${choice}`);
      
      // Send bet and wait for confirmation
      await Utils.sendGameState(conn.ws, GameState.Bet, {
        data: {
          choice: choice,
          amount: betAmount
        }
      });
      
      try {
        const betResponse = await waitForBetConfirmation(conn.ws, data.mobile);
        betResults.set(mobileNumber, betResponse);
        
        if (betResponse.data && betResponse.data.error) {
          throw new Error(`Bet failed for ${data.mobile}: ${betResponse.data.error}`);
        }
      } catch (error) {
        console.error(`Bet confirmation timeout for ${data.mobile}:`, error.message);
        throw error;
      }
    }
    
    console.log('All bets placed successfully');
    
    // Wait for odds to be calculated
    console.log('Waiting for odds calculation...');
    finalOdds = await Utils.waitForOdds(conns.get("09000000000")!.ws, GameState.Bet);
    console.log("Final odds calculated:", finalOdds);

    // Resume game for betting
    console.log('Resume game for betting...');
    await Utils.sendGameState(conns.get("09000000000")!.ws, GameState.Open, { data: {play:true} });
    console.log('Game resumed for betting');

    // Close betting
    console.log('Closing betting...');
    await Utils.sendGameState(conns.get("09000000000")!.ws, GameState.Closed, {});
    await waitForGameState(conns.get("09000000000")!.ws, GameState.Closed, 'moderator');
    console.log("Betting closed");
    
    // Start rolling
    console.log('Starting rolling...');
    await Utils.sendGameState(conns.get("09000000000")!.ws, GameState.Rolling, {});
    await waitForGameState(conns.get("09000000000")!.ws, GameState.Rolling, 'moderator');
    console.log('Rolling started');
    
    // Declare winner (let's say A wins)
    console.log('Declaring winner...');
    await Utils.sendGameState(conns.get("09000000000")!.ws, GameState.WinnerDeclared, {
      data: { choice: 'A' }
    });
    await waitForGameState(conns.get("09000000000")!.ws, GameState.WinnerDeclared, 'moderator');
    console.log('Winner declared: A');
    
    // Send payout
    console.log('Sending payout...');
    await Utils.sendGameState(conns.get("09000000000")!.ws, GameState.SendPayout, {});
    await waitForGameState(conns.get("09000000000")!.ws, GameState.SendPayout, 'moderator');
    console.log('Payout sent');
    
    // Wait for all processing to complete
    await Utils.delay(3000);
    
    // Check wallet balances after complete game cycle
    let messages = "\n";
    for (let i = 1; i < conns.size; i++) {
      const mobileNumber = Utils.getMobileNumber(i);
      if (mobileNumber === "09000000000") {
        console.log("Skipping moderator");
        continue;
      }
      const conn = conns.get(mobileNumber);
      const data = conn.data as Data;
      if (!data.amount || data.amount === 0) {
        continue;
      }
      
      let betAmount = data.amount;
      let choice = data.index === 0 ? 'A' : 'B';
      const initialBalance = initialBalances.get(mobileNumber) || 10000;
      const balanceNow = await Utils.getPlayerWalletBalance(server, (conn.data as any).token);
      // Calculate expected balance based on win/loss
      let expectedBalance;
      if (choice === 'A') {
        // Player bet on A and A won - they should get their bet back plus winnings
        const odds = data.odds || 1.0;
        const winnings = betAmount * odds;
        expectedBalance = initialBalance - betAmount + winnings;
      } else {
        // Player bet on B and A won - they lose their bet
        expectedBalance = initialBalance - betAmount;
      }
      
      if (Math.abs(Number(balanceNow) - expectedBalance) > 0.01) { // Allow for small floating point differences
        throw new Error(`Player ${data.mobile}: Expected balance ${expectedBalance}, got ${balanceNow}. Game result not properly processed.`);
      } else {
        const result = choice === 'A' ? 'WON' : 'LOST';
        messages += `Player ${data.mobile} betted ${betAmount} on ${choice} and ${result}! Balance: ${initialBalance} -> ${balanceNow}\n`;
      }
    }
    
    console.log("Messages:", messages);
    console.log("Expected odds0:", odds0);
    console.log("Expected odds1:", odds1);
    console.log("Final odds:", finalOdds);
 
    if (
      roundTo(finalOdds.A) !== roundTo(odds0) ||
      roundTo(finalOdds.B) !== roundTo(odds1)
    ) {
      throw new Error(`Final odds are not correct. Expected A:${odds0}, B:${odds1}, Got A:${finalOdds.A}, B:${finalOdds.B}`);
    } else {
      console.log("Final odds are correct");
    }
    
  }, 30000); // Increased timeout
 
});
 

// Helper function to wait for specific game state with better error handling
const waitForGameState = (ws: WebSocket, expectedState: GameState, user: string, timeout: number = 10000): Promise<void> => {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`waitForGameState exceeded ${timeout}ms waiting for ${expectedState} for ${user}`));
    }, timeout);

    const messageHandler = (event: any) => {
      try {
        const msg = JSON.parse(event.data.toString());
        if (msg.channel === Channel.Game && msg.state === expectedState) {
          clearTimeout(timeoutId);
          ws.removeEventListener('message', messageHandler);
          resolve();
        }
      } catch (e) {
        console.error(`Error parsing message for ${user}:`, e);
      }
    };

    ws.addEventListener('message', messageHandler);
  });
};

// Helper function to wait for bet confirmation
const waitForBetConfirmation = (ws: WebSocket, user: string, timeout: number = 5000): Promise<any> => {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`waitForBetConfirmation exceeded ${timeout}ms for ${user}`));
    }, timeout);

    const messageHandler = (event: any) => {
      try {
        const msg = JSON.parse(event.data.toString());
        if (msg.channel === Channel.Game && msg.state === GameState.Bet) {
          clearTimeout(timeoutId);
          ws.removeEventListener('message', messageHandler);
          resolve(msg);
        }
      } catch (e) {
        console.error(`Error parsing bet response for ${user}:`, e);
      }
    };

    ws.addEventListener('message', messageHandler);
  });
};
function roundTo(num, decimals = 4) {
  return Number(num.toFixed(decimals));
}
 
async function getSheet(path: string): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  return workbook.getWorksheet(1);
}
 
async function getUsersData(sheet: ExcelJS.Worksheet, startRow: number): Promise<Map<string, Data>> {
  const users = new Map<string, Data>();
 
  let odds0 = toNumber(sheet.getCell(10, 3).result);
  let odds1 = toNumber(sheet.getCell(10, 4).result);
 
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber < startRow) {
      return;
    }
 
    if (row.getCell(1).value === null) {
      return;
    }
 
    const data = new Data();
    data.mobile = row.getCell(1).value.toString().replace(/'/g, '');
    
    // Ensure the first user (09000000000) is a moderator
    if (data.mobile === "09000000000") {
      data.type = "moderator";
    } else {
      data.type = row.getCell(2).value.toString();
    }
 
    const amount0 = toNumber(row.getCell(3).value);
    if (amount0 !== null) {
      data.index = 0;
      data.amount = amount0;
      data.odds = odds0;
    }
 
    const amount1 = toNumber(row.getCell(4).value);
    if (amount1 !== null) {
      data.index = 1;
      data.amount = amount1;
      data.odds = odds1;
    }
 
    users.set(data.mobile, data);
  });
 
  return users;
}
 
async function initConnections(server: FastifyInstance, users: Map<string, Data>, port: number) {
  const connections: Map<string, Connection> = new Map();
  let moderatorToken = ""
  
  for (const user of users.values()) {
    const newUser: User = {
      firstName: user.mobile,
      lastName: user.mobile,
      userName: user.mobile,
      email: `test${user.mobile}@example.com`,
      mobile: user.mobile,
      type: user.type,
      password: 'password123',
    };
 
    // Register user with complete payload
    const registerComplete = async (base: User): Promise<any> => {
      const payload = {
        firstName: base.firstName,
        lastName: base.lastName,
        userName: base.userName,
        email: base.email,
        mobile: base.mobile,
        type: base.type,
        password: base.password,
        ekycTransactionId: `ekyc_${Date.now()}_${base.mobile}`,
        permanentAddress: 'Test Permanent Address',
        currentAddress: 'Test Current Address',
        birthDate: '1990-01-01',
        birthPlace: 'Test City',
        nationality: 'Test Nationality',
        gamingSite: 'Test Gaming Site',
        natureOfWork: 'Test Work',
        sourceOfIncome: 'Test Income',
      };
      
      try {
        const res = await requestSupertest(server.server).post('/register').send(payload).expect(201);
        return res.body;
      } catch (error) {
        console.error(`Registration failed for ${base.userName}:`, error.response?.body || error.message);
        throw error;
      }
    };
 
    let registeredUser = await registerComplete(newUser);

    const loggedUser = await requestSupertest(server.server)
          .post('/login')
          .send({
            userNameOrEmail: newUser.userName,
            password: newUser.password,
          }).expect(200);
    
    if (user.type === "moderator") {
      moderatorToken = loggedUser.body.token;
    }
    
    // Make initial deposit using the correct method
    const makeDeposit = async (token: string, amount: number): Promise<void> => {
      const response = await requestSupertest(server.server)
        .post('/deposit')
        .set('Authorization', `Bearer ${token}`)
        .send({
          amount: amount.toString(),
        })
        .expect(201);
    };
 
    await makeDeposit(loggedUser.body.token, 10000);
    
    // Connect WebSocket
    const ws = await Utils.connectWs(server, newUser, port);
    
    const connection = new Connection();
    connection.data = user;
    (connection.data as any).token = loggedUser.body.token;
    connection.ws = ws;
    connections.set(user.mobile, connection);
  }
 
  return connections;
}
 
function toNumber(value: any): number | null {
  if (typeof value === 'string') {
    return Number(value);
  } else if (typeof value === 'number') {
    return value;
  } else {
    return null;
  }
}