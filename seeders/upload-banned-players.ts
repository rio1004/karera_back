import { db, pool } from '../src/db/index.ts';
import { BannedPlayersTable } from '../src/db/schema.ts';
import XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// ES Module compatible __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper function to format date as YYYY-MM-DD
function formatDateToYYYYMMDD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

interface BannedPlayerData {
  systemId?: number;
  name?: string;
  nationality?: string;
  nameOrigin?: string;
  title?: string;
  listType?: string;
  unListType?: string;
  designation?: string;
  listedOn?: string;
  lastUpdate?: string;
  listedOnDate?: Date;
  lastUpdateDate?: Date;
  comments?: string;
  dataType?: string;
  gender?: string;
  age?: number;
  affiliationGroup?: string;
  notice?: string;
  sanction?: string;
  city?: string;
  region?: string;
  contacts?: string;
  entity?: string;
}

async function uploadBannedPlayers() {
  try {
    console.log('Starting banned players upload...');
    console.log('Testing database connection...');

    const client = await pool.connect();
    console.log('Database connection successful!');
    client.release();

    // Path to the Excel file
    const excelFilePath = path.join(__dirname, 'source', 'bannedPlayerList.xlsx');
    
    // Check if file exists
    if (!fs.existsSync(excelFilePath)) {
      throw new Error(`Excel file not found at: ${excelFilePath}`);
    }

    console.log(`Reading Excel file: ${excelFilePath}`);
    
    // Read the Excel file
    const workbook = XLSX.readFile(excelFilePath);
    const sheetName = workbook.SheetNames[0]; // Get first sheet
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert to JSON
    const rawData = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`Found ${rawData.length} rows in Excel file`);
    
    if (rawData.length === 0) {
      console.log('No data found in Excel file');
      return;
    }

    // Process and clean the data
    const bannedPlayers: BannedPlayerData[] = rawData.map((row: any) => {
      const player: BannedPlayerData = {};
      
      // Map Excel columns to database fields based on actual Excel column names
      if (row['SYSTEM ID'] !== undefined) player.systemId = Number(row['SYSTEM ID']);
      if (row['NAME'] !== undefined) player.name = String(row['NAME']);
      if (row['NATIONALITY'] !== undefined) player.nationality = String(row['NATIONALITY']);
      if (row['NAME ORIGIN'] !== undefined) player.nameOrigin = String(row['NAME ORIGIN']);
      if (row['TITLE'] !== undefined) player.title = String(row['TITLE']);
      if (row['LIST TYPE'] !== undefined) player.listType = String(row['LIST TYPE']);
      if (row['UN LIST TYPE'] !== undefined) player.unListType = String(row['UN LIST TYPE']);
      if (row['DESIGNATION'] !== undefined) player.designation = String(row['DESIGNATION']);
      // Handle date fields - keep original text and create formatted dates
      if (row['LISTED ON'] !== undefined) {
        // Store original text value
        player.listedOn = String(row['LISTED ON']);
        
        // Try to parse and create formatted date
        try {
          const listedDate = new Date(row['LISTED ON']);
          if (!isNaN(listedDate.getTime())) {
            player.listedOnDate = listedDate;
            // Also create a formatted text version in YYYY-MM-DD format
            console.log(`Converted '${row['LISTED ON']}' to date: ${formatDateToYYYYMMDD(listedDate)}`);
          }
        } catch (error) {
          // Skip invalid dates
        }
      }
      if (row['LAST UPDATE DATE'] !== undefined) {
        // Store original text value
        player.lastUpdate = String(row['LAST UPDATE DATE']);
        
        // Try to parse and create formatted date
        try {
          const lastUpdateDate = new Date(row['LAST UPDATE DATE']);
          if (!isNaN(lastUpdateDate.getTime())) {
            player.lastUpdateDate = lastUpdateDate;
            // Also create a formatted text version in YYYY-MM-DD format
            console.log(`Converted '${row['LAST UPDATE DATE']}' to date: ${formatDateToYYYYMMDD(lastUpdateDate)}`);
          }
        } catch (error) {
          // Skip invalid dates
        }
      }

      // Debug: Log what we're about to insert for the first few records
      if (rawData.indexOf(row) < 3) {
        console.log(`\nDebug - Record ${rawData.indexOf(row) + 1}:`);
        console.log(`  Original LISTED ON: ${row['LISTED ON']}`);
        console.log(`  Original LAST UPDATE DATE: ${row['LAST UPDATE DATE']}`);
        console.log(`  Processed player object:`, JSON.stringify(player, null, 2));
      }
      if (row['COMMENTS'] !== undefined) player.comments = String(row['COMMENTS']);
      if (row['DATA TYPE'] !== undefined) player.dataType = String(row['DATA TYPE']);
      if (row['GENDER'] !== undefined) player.gender = String(row['GENDER']);
      if (row['AGE'] !== undefined) player.age = Number(row['AGE']);
      if (row['AFFILIATION / GROUP'] !== undefined) player.affiliationGroup = String(row['AFFILIATION / GROUP']);
      if (row['NOTICE'] !== undefined) player.notice = String(row['NOTICE']);
      if (row['SANCTION'] !== undefined) player.sanction = String(row['SANCTION']);
      if (row['CITY'] !== undefined) player.city = String(row['CITY']);
      if (row['REGION'] !== undefined) player.region = String(row['REGION']);
      // Note: 'Contacts' and 'Entity' columns don't exist in the Excel file

      return player;
    });

    // Filter out rows with no meaningful data
    const validPlayers = bannedPlayers.filter(player => 
      player.name || player.systemId || player.nationality
    );

    console.log(`Processing ${validPlayers.length} valid banned player records...`);

    // Insert in batches to avoid memory issues
    const batchSize = 100;
    let insertedCount = 0;

    for (let i = 0; i < validPlayers.length; i += batchSize) {
      const batch = validPlayers.slice(i, i + batchSize);
      
      console.log(`Inserting batch ${Math.floor(i / batchSize) + 1} (${batch.length} records)...`);
      
      try {
        // Debug: Log the first record of each batch to see what we're inserting
        if (i === 0) {
          console.log(`\nDebug - First record of first batch:`);
          console.log(JSON.stringify(batch[0], null, 2));
        }
        
        await db.insert(BannedPlayersTable).values(batch);
        insertedCount += batch.length;
        console.log(`Batch ${Math.floor(i / batchSize) + 1} inserted successfully`);
      } catch (error) {
        console.error(`Error inserting batch ${Math.floor(i / batchSize) + 1}:`, error);
        // Continue with next batch instead of failing completely
      }
    }

    console.log(`Successfully uploaded ${insertedCount} banned players to database`);
    console.log(`Total records processed: ${rawData.length}`);
    console.log(`Valid records inserted: ${insertedCount}`);

  } catch (error) {
    console.error('Error uploading banned players:', error);
    console.error({
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    throw error;
  } finally {
    await pool.end();
    console.log('Database pool closed.');
  }
}

// Run seeder
console.log('Banned Players Seeder script started...');
uploadBannedPlayers()
  .then(() => {
    console.log('Seeder completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Seeder failed:', error);
    process.exit(1);
  });

export { uploadBannedPlayers };
