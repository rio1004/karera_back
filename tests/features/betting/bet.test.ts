// import { FastifyInstance } from "fastify";
// import { Connection, Data, User } from "../utils.ts";
// import { Utils } from "../utils.ts";
// import ExcelJS from "exceljs";
// import UserRoutesPlugin from "../../src/api/UserRoutesPlugin.ts";
// import DosLetraPlugin, { Channel, GameState, Message } from "../../src/api/dosletra/DosLetraPlugin.ts";
// import { UsersTable, userTypeValues } from "../../src/db/schema.ts";
// import requestSupertest from 'supertest';
// import WebSocket from 'ws';
// import { Bet } from "../../src/api/dosletra/Player.ts";
//

import { FastifyInstance } from "fastify";
import { Connection, Data, Utils } from "../../utils/utils.js";
import ExcelJS from "exceljs";
import UserRoutesPlugin from "../../../src/api/UserRoutesPlugin.js";
import DosLetraPlugin, { Channel, GameState, Message } from "../../../src/api/dosletra/DosLetraPlugin.ts";
import WebSocket from "ws";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import {faker} from '@faker-js/faker';

const port = 3001;
const webSocketport = 8000;
describe('dosletra bet test', () => {
  const url = "postgresql://postgres:postgres@aggregator_db:5432/postgres";
  const dbName = "kareraBetTest";
  let server: FastifyInstance;
  let utils: Utils = new Utils();

  beforeAll(async () => {
    const init_db = true;
    server = await utils.beforeAll(url, dbName, init_db);

    await server.register(UserRoutesPlugin);
    await server.register(DosLetraPlugin, { speed: 1000.0 });

    await server.redis.dosletra.select(1);

    await server.ready();
    await server.listen({ port: port });
  });

  afterAll(async () => {
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

  it('Load the right odds from bet.xlsx file', async () => {
    const sheet = await getSheet('tests/features/betting/bet.xlsx');
    const users = await getUsersData(sheet, 13);
    const conns = await initConnections(server, users, webSocketport);

    let odds0 = toNumber(sheet.getCell(10, 3).result);
    let odds1 = toNumber(sheet.getCell(10, 4).result);

    const ws = conns.get("09000000000")!.ws;

    const waitOpen = Utils.waitGameState(ws, GameState.Open, 5000);

    setTimeout(() => {
      Utils.sendGameState(ws, GameState.Open, "");
    }, 0);

    const test = await waitOpen;


    let receivedCount = 0;
    // for (let i = 1; i < conns.size; i++) {
    //   const mobileNumber = Utils.getMobileNumber(i);
    //   const conn = conns.get(mobileNumber);
    //
    //   conn.ws.send(
    //     JSON.stringify(
    //       new Message(Channel.Game, GameState.Bet, JSON.stringify(new Bet(conn.data.index, conn.data.amount)))
    //     )
    //   );
    //
    //   waitForOdds(conn.ws, (odds) => {
    //     if (isSameOdds(odds, odds0, odds1)) {
    //       receivedCount++;
    //     }
    //   });
    //
    //   await Utils.delay(10);
    // }

    // await new Promise((resolve, reject) => {
    //   const id = setInterval(() => {
    //     if (receivedCount >= users.size - 2) {
    //       clearInterval(id);
    //       resolve(true);
    //     }
    //   }, 10);
    //
    //   timeOut(conns, 1000, id, reject);
    // });
  }, 15000);

  /*   it('LoadBetsFileWinIndex0', async () => {
      const sheet = await getSheet('tests/dosletra/bet.xlsx');
      const users = await getUsersData(sheet, 13);
      const conns = await initConnections(server, users, port);

      let odds0 = toNumber(sheet.getCell(10, 3).result);
      let odds1 = toNumber(sheet.getCell(10, 4).result);

      Utils.sendGameState(conns.get("09000000000")!.ws, GameState.Start, "");
      await Utils.waitGameState(conns.get("09000000000")!.ws, GameState.Start);

      let receivedCount = 0;
      for (let i = 1; i < conns.size; i++) {
        const mobileNumber = Utils.getMobileNumber(i);
        const conn = conns.get(mobileNumber);

        conn.ws.send(
          JSON.stringify(
            new Message(GameEvent.Bet, JSON.stringify(new Bet(conn.data.index, conn.data.amount)))
          )
        );

        // waitForOdds(conn.ws, (odds) => {
        //   if (isSameOdds(odds, odds0, odds1)) {
        //     receivedCount++;
        //   }
        // });

        await Utils.delay(10);
      }

      await new Promise((resolve, reject) => {
        const id = setInterval(() => {
          // if (receivedCount >= users.size - 2) {
          //   clearInterval(id);
          //   resolve(true);
          // }
        }, 10);

        timeOut(conns, 1000, id, reject);
      });
    }); */
});


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
    data.type = row.getCell(2).value.toString();

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

  for (const data of users.values()) {

    const newUser = {
      firstName: faker.person.firstName(),
      lastName: faker.person.lastName(),
      userName: faker.internet.username().toLowerCase(),
      email:faker.internet.email().toLowerCase(),
      mobile: data.mobile,
      type: data.type,
      password: 'password123',
    };


    await Utils.registerUser(server, newUser);
    const ws = await Utils.connectWs(server, newUser, port);
    const connection = new Connection();
    connection.data = data;
    connection.ws = ws;
    connections.set(data.mobile, connection);
  }

  return connections;
}

async function timeOut(
  conns: Map<string, Connection>,
  timeout: number,
  intervalId: NodeJS.Timeout,
  reject: (reason?: any) => void
) {
  const timeoutId = setTimeout(() => {
    conns.forEach((connection, mobile) => {
      connection.ws.close();
    });
    clearTimeout(timeoutId);
    clearInterval(intervalId);

    reject(new Error("Received count does not match the number of users"));
  }, timeout);
}


function isSameOdds(odds: string, odds0: number, odds1: number): boolean {
  return withDecimalStr(odds["0"]) === withDecimalStr(odds0) && withDecimalStr(odds["1"]) === withDecimalStr(odds1);
}


function waitForOdds(ws: WebSocket, cbFn: (odds: string) => void) {
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data.toString());
    if (msg.channel === Channel.Game && msg.state === GameState.Bet) {
      const data = JSON.parse(msg.data);
      cbFn(data.odds);
    }
  }
}

function onWinnerGetPrizes(ws: WebSocket, cbFn: (odds: string) => void) {
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data.toString());
    if (msg.type === Channel.Game && msg.data.state === GameState.WinnerDeclared) {

      cbFn(msg.data);
    }
  }
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

function withDecimalStr(value: number | string): string {
  if (typeof value === 'number') {
    return value.toFixed(4);
  } else {
    return parseFloat(value).toFixed(4);
  }
}


/**
 * Load the Bet.xlsx file
 * Setup server
 * Connect moderator
 * Connect players
 * Input the bets
 * Match the odds
 */