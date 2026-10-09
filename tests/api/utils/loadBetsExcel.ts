import ExcelJS from "exceljs";
import path from "path";

export async function loadExcelData() {
  const filePath = path.join('tests/api/game/bets.xlsx');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheet = workbook.worksheets[0]; // first sheet
  const rows: any[] = [];

  sheet.eachRow((row, rowNumber) => {
    rows.push(row.values);
  });

  return rows;
}
