# Seeders

This directory contains database seeders for populating the database with initial data.

## Available Seeders

### User Management
- `create-users.ts` - Creates test users (10,000 users by default)
- `testUsersSeeder.ts` - Creates test users for testing purposes
- `leaderboard-users.ts` - Creates users for leaderboard testing

### Game & Session Management
- `create-game.ts` - Creates game records
- `create-game-session.ts` - Creates game sessions
- `seed-game-simulation.ts` - Simulates game scenarios
- `seed-new-game.ts` - Seeds new game data

### Financial & Transaction Management
- `create-wallets.ts` - Creates user wallets
- `create-deposits-all-users.ts` - Creates deposits for all users
- `seed-transaction-wonprize.ts` - Seeds transaction data for won prizes
- `generate-tokens-csv.ts` - Generates CSV with user tokens

### Compliance & Security
- `upload-banned-players.ts` - Uploads banned players from Excel file to database

### Utility
- `recreateDb.ts` - Recreates the entire database

## Running Seeders

### Using npm scripts (recommended)
```bash
# Create users
npm run create-users

# Create wallets
npm run create-wallets

# Create deposits
npm run create-deposits-all-users

# Create games
npm run create-game

# Create game sessions
npm run create-game-session

# Seed game simulation
npm run seed-game-simulation

# Seed new game
npm run seed-new-game

# Generate tokens CSV
npm run generate-tokens-csv

# Seed leaderboard
npm run seed:leaderboard

# import banned players
npm run import:banned-players

# Recreate database
npm run recreate-db
```

### Using tsx directly
```bash
npx tsx seeders/[filename].ts
```

### Using ts-node
```bash
npx ts-node seeders/[filename].ts
```

## Banned Players Seeder

The `upload-banned-players.ts` seeder reads data from `source/bannedPlayerList.xlsx` and inserts it into the `bannedPlayers` table.

### Features
- Reads Excel files using the `xlsx` library
- Processes data in batches to avoid memory issues
- Maps Excel columns to database fields
- Filters out invalid/empty records
- Provides detailed logging and error handling
- Continues processing even if individual batches fail

### Excel Column Mapping
The seeder expects the following column names in your Excel file:
- System ID → systemId
- Name → name
- Nationality → nationality
- Name Origin → nameOrigin
- Title → title
- List Type → listType
- UnList Type → unListType
- Designation → designation
- Listed Date → listedDate
- Last Update Date → lastUpdateDate
- Comments → comments
- Data Type → dataType
- Gender → gender
- Age → age
- Affiliation Group → affiliationGroup
- Notice → notice
- Sanction → sanction
- City → city
- Region → region
- Contacts → contacts
- Entity → entity

### Usage
```bash
npm run seed:banned-players
```

### Requirements
- Excel file must be located at `seeders/source/bannedPlayerList.xlsx`
- Database connection must be properly configured
- Required dependencies: `xlsx`, `drizzle-orm`, `pg`

## Notes

- Most seeders use batch processing to handle large datasets efficiently
- Seeders automatically close database connections when complete
- Error handling is implemented to provide clear feedback on failures
- Some seeders include data validation and cleaning
- All seeders are designed to be idempotent (can be run multiple times safely)
