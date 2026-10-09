import { FastifyInstance } from "fastify";
import request from "supertest";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { Utils } from "../../utils/utils.js";
import TransactionRoutesPlugin from "../../../src/api/TransactionRoutesPlugin.ts";
import UserRoutesPlugin from "../../../src/api/UserRoutesPlugin.ts";
import * as schema from "../../../src/db/schema.ts";
import ExcelJS from "exceljs";
import path from "path";
import { sql } from "drizzle-orm";

describe("Transactions Report", () => {
  const url = "postgresql://postgres:postgres@aggregator_db:5432/postgres";
  const dbName = "transactionReportTest";
  let server: FastifyInstance;
  let utils: Utils = new Utils();

  beforeAll(async () => {
    // ensure audit fee is set for report calc: auditFee = (ggr * 0.15) * AUDIT_FEE
    process.env.AUDIT_FEE = process.env.AUDIT_FEE || "0.10";

    server = await utils.beforeAll(url, dbName, true);
    server.register(UserRoutesPlugin);
    server.register(TransactionRoutesPlugin);
    await server.ready();
  });

  afterAll(async () => {
    await utils.afterAll();
  });

  beforeEach(async () => {
    await utils.beforeEach();
  });

  afterEach(async () => {
    await utils.afterEach();
  });

  it("should return rows and totals matching report data from Excel file", async () => {
    const db = server.db!;
    // NOTE: truncate the transactions table cascade
    // as the migrated data is still incorrect, we need to truncate the table and re-seed the data based on the Excel file
    await db.execute(sql`TRUNCATE TABLE transactions CASCADE`);
    
    // Try to read data from Excel file, fallback to hardcoded data if it fails
    let expectedData;
    try {
      expectedData = await readExcelReportData();
    } catch (error) {
      console.log('Failed to read Excel file, using hardcoded data:', error.message);
    }
    
    // Create games and sessions for the test data
    const game = ((await db.insert(schema.GamesTable).values({
      name: `December Report Test Game`,
      choices: ["A", "B"],
      commission: "0.08",
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning()) as any[])[0];

    // Seed transactions only for days that have actual data (non-zero values)
    for (const dayData of expectedData.dailyData) {
      if (dayData.betAmount > 0) { // Only create data for days with actual bets

        const day = new Date(Date.UTC(2024, 11, dayData.day, 12, 0, 0)); // December 2024 (month 11 = December)
        const sessionNo = `DEC-202412${dayData.day.toString().padStart(2, '0')}-${Date.now()}-${Math.random()}`;
        const session = ((await db.insert(schema.GameSessionsTable).values({
          gameId: game.id,
          sessionNo: sessionNo,
          createdAt: day,
        }).returning()) as any[])[0];

        // Create bet transactions
        const betTx = ((await db.insert(schema.TransactionsTable).values({
          type: "bet",
          amount: dayData.betAmount.toString(),
          status: "completed",
          gameId: game.id,
          gameSessionId: session.id,
          createdAt: day,
          updatedAt: day,
        }).returning()) as any[])[0];

        // Create win transactions
        const winTx = ((await db.insert(schema.TransactionsTable).values({
          type: "win",
          amount: dayData.winAmount.toString(),
          status: "completed",
          gameId: game.id,
          gameSessionId: session.id,
          createdAt: day,
          updatedAt: day,
        }).returning()) as any[])[0];

        await db.insert(schema.WinsTable).values({
          sessionId: session.id,
          transactionId: winTx.id,
          choice: "A",
          createdAt: day,
        });
      }
    }

    // Determine date range from Excel data
    const days = expectedData.dailyData.map(d => d.day);
    const minDay = Math.min(...days);
    const maxDay = Math.max(...days);
    
    // Use December 2024 for the test data
    const startDate = `202412${minDay.toString().padStart(2, '0')}`;
    const endDate = `202412${maxDay.toString().padStart(2, '0')}`;

    const res = await request(server.server)
      .get(`/transactions/report`)
      .query({ startDate, endDate })
      .expect(200);
    
    expect(res.body).toBeTruthy();
    expect(Array.isArray(res.body.rows)).toBe(true);
    expect(res.body.rows.length).toBe(expectedData.dailyData.length);

    // Verify each day's data matches the expected data
    for (let i = 0; i < expectedData.dailyData.length; i++) {
      const expectedDay = expectedData.dailyData[i];
      const actualRow = res.body.rows[i];
      
      expect(actualRow.date).toBe(`12/${expectedDay.day}/2024`);
      expect(actualRow.betAmount).toBeCloseTo(expectedDay.betAmount, 2);
      expect(actualRow.winAmount).toBeCloseTo(expectedDay.winAmount, 2);
      expect(actualRow.ggr).toBeCloseTo(expectedDay.ggr, 2);
      expect(actualRow.pagcorShare).toBeCloseTo(expectedDay.pagcorShare, 2);
      expect(actualRow.auditFee).toBeCloseTo(expectedDay.auditFee, 2);
    }

    // Verify totals match the expected data from Excel file
    const totals = res.body.totals;
    expect(totals.betAmount).toBeCloseTo(expectedData.totals.betAmount, 2);
    expect(totals.winAmount).toBeCloseTo(expectedData.totals.winAmount, 2);
    expect(totals.ggr).toBeCloseTo(expectedData.totals.ggr, 2);
    expect(totals.pagcorShare).toBeCloseTo(expectedData.totals.pagcorShare, 2);
    expect(totals.auditFee).toBeCloseTo(expectedData.totals.auditFee, 2);
  });
});

// Helper function to read Excel file and extract report data
async function readExcelReportData(): Promise<{
  dailyData: Array<{
    day: number;
    betAmount: number;
    winAmount: number;
    ggr: number;
    pagcorShare: number;
    auditFee: number;
  }>;
  totals: {
    betAmount: number;
    winAmount: number;
    ggr: number;
    pagcorShare: number;
    auditFee: number;
  };
}> {
  const workbook = new ExcelJS.Workbook();
  const filePath = path.join(__dirname, "report.xlsx");
  await workbook.xlsx.readFile(filePath);
  
  const worksheet = workbook.getWorksheet(1);
  if (!worksheet) {
    throw new Error("No worksheet found in Excel file");
  }

  const dailyData: Array<{
    day: number;
    betAmount: number;
    winAmount: number;
    ggr: number;
    pagcorShare: number;
    auditFee: number;
  }> = [];

  let totals = {
    betAmount: 0,
    winAmount: 0,
    ggr: 0,
    pagcorShare: 0,
    auditFee: 0
  };

  // Read data from Excel file - skip header row (row 1), start from row 2
  for (let rowNumber = 2; rowNumber <= 6; rowNumber++) { // Updated to start from row 2 and go to row 6
    const row = worksheet.getRow(rowNumber);
    if (!row) continue;
    
    // Get cell values based on the actual Excel structure from the debug output
    const dateCell = row.getCell(1).value; // Date column (A) - Date object
    const betAmountCell = row.getCell(2).value; // Bet amount column (B)
    const winAmountCell = row.getCell(3).value; // Win amount column (C)
    const ggrCell = row.getCell(5).value; // GGR column (E)
    const pagcorShareCell = row.getCell(9).value; // PAGCOR SHARE column (I)
    const auditFeeCell = row.getCell(10).value; // AUDIT FEE column (J)

    // Extract date from Date object
    if (dateCell && dateCell instanceof Date) {
      const day = dateCell.getDate();
      const month = dateCell.getMonth() + 1; // JavaScript months are 0-indexed
      const year = dateCell.getFullYear();
      
      if (month === 12 && year === 2024) { // December 2024
        // Parse the values from Excel, handling both string and number formats
        const betAmount = typeof betAmountCell === 'string' 
          ? parseFloat(betAmountCell.replace(/[₱,]/g, '')) 
          : parseFloat(betAmountCell?.toString() || '0') || 0;
        
        const winAmount = typeof winAmountCell === 'string' 
          ? parseFloat(winAmountCell.replace(/[₱,]/g, '')) 
          : parseFloat(winAmountCell?.toString() || '0') || 0;
        
        const ggr = typeof ggrCell === 'string' 
          ? parseFloat(ggrCell.replace(/[₱,]/g, '')) 
          : parseFloat(ggrCell?.toString() || '0') || 0;
        
        const pagcorShare = typeof pagcorShareCell === 'string' 
          ? parseFloat(pagcorShareCell.replace(/[₱,]/g, '')) 
          : parseFloat(pagcorShareCell?.toString() || '0') || 0;
        
        const auditFee = typeof auditFeeCell === 'string' 
          ? parseFloat(auditFeeCell.replace(/[₱,]/g, '')) 
          : parseFloat(auditFeeCell?.toString() || '0') || 0;
        
        const dayData = {
          day: day,
          betAmount: betAmount,
          winAmount: winAmount,
          ggr: ggr,
          pagcorShare: pagcorShare,
          auditFee: auditFee
        };
        
        dailyData.push(dayData);
        
        // Accumulate totals
        totals.betAmount += dayData.betAmount;
        totals.winAmount += dayData.winAmount;
        totals.ggr += dayData.ggr;
        totals.pagcorShare += dayData.pagcorShare;
        totals.auditFee += dayData.auditFee;
      }
    }
  }

  return { dailyData, totals };
}