import { db, pool } from "../src/db/index.ts";
import { UsersTable } from "../src/db/schema.ts";
import bcrypt from 'bcrypt';

type UserInsert = {
    firstName: string;
    lastName: string;
    userName: string;
    email: string;
    mobile: string;
    type: 'player';
    hashedPassword: string;
}

function randomAplhaNumberic(length = 10, chars = 
    'abcdefghijklmnopqrstuvwxyz0123456789'): string {
    let string = '';

    for (let i = 0; i < length; i++) {
        string += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return string;
}

function generateUniqueUsernames(count: number, length = 10, existing = new Set<string>()) {
    const seen = new Set(existing);
    const list: string[] = [];

    while (list.length < count) {
        const username = randomAplhaNumberic(length);
        if (!seen.has(username)) {
            list.push(username);
            seen.add(username);
        }
    }

    return { list, seen };
}

async function createUsers() {
    const totalUsers = 10;
    const batchSize = 10;
    const usernameLen = 10;

    try {
        console.log(`Starting creation of ${totalUsers} users...`);
        const client = await pool.connect();
        console.log('Database connection successful!');
        client.release();

        const password = 'password123';
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        console.log('Password hashed successfully');

        let createdCount = 0;
        let idCounter = 0;
        
        
        // Track usernames generated in this run to avoid duplicates pre‑DB
        let seenUsernames = new Set<string>();

        for (let batchStart = 0; batchStart < totalUsers; batchStart += batchSize) {
            const size = Math.min(batchSize, totalUsers - batchStart);

            const { list: usernames, seen } = generateUniqueUsernames(size, usernameLen, seenUsernames);
            seenUsernames = seen;

            const usersBatch: UserInsert[] = usernames.map((userName) => {
                idCounter += 1;

                const firstName = `TestFirst${idCounter}`;
                const lastName = `TestLast${idCounter}`;
                const email = `${userName}@example.com`;
                const mobile = `+639${String(900000000 + idCounter).padStart(9, '0')}`;

                return {
                    firstName,
                    lastName,
                    userName,
                    email,
                    mobile,
                    type: 'player',
                    hashedPassword,
                }
            });

            console.log(`Inserting batch ${Math.floor(batchStart / batchSize) + 1} (${usersBatch.length} users)...`);
            
            await db.insert(UsersTable).values(usersBatch);

            createdCount += usersBatch.length;
        }

        console.log(`Successfully created ${createdCount} users`);
        console.log(`All users have password: ${password}`);
    } catch (error) {
        console.error('Error creating users:', error);
        console.error({
            message: error.message,
            stack: error.stack,
            name: error.name,
        });
        throw error;
    } finally {
        await pool.end();
        console.log('Database pool closed.');
    }
}

// Run seeder
console.log('Seeder script started...');
createUsers()
  .then(() => {
    console.log('Seeder completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Seeder failed:', error);
    process.exit(1);
  });

export { createUsers };