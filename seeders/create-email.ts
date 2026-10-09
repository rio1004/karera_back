// backend/seeders/create-email.ts
import "dotenv/config";
import { db } from "../src/db/index.ts";
import { EmailTable } from "../src/db/schema.ts";
import { sql, and, eq } from "drizzle-orm";

async function seedEmails() {
  console.log("🌱 Starting email seeder...");

  // Sample userId (replace with real user IDs from UsersTable)
  const userId = 15;

  const emails = [
    {
      userId,
      subject: "Happy Birthday! May gift kami para sa’yo 🎉",
      body: "Birthday mo ngayon? Bigyan ng Bente yan! Dahil birthday mo, may gift kaming P20 wallet credits...",
      status: "unread" as const,
    },
    {
      userId,
      subject: "Welcome to Karera Live!",
      body: "We’re so happy that you’re here! You may now enjoy and immerse yourself in the thrill of live games...",
      status: "read" as const,
    },
    {
      userId,
      subject: "Your deposit request has been received",
      body: "Your deposit request for ₱250.00 from your GCash account number 09123456789 to your Karera wallet has been received...",
      status: "unread" as const,
    },
    {
      userId,
      subject: "Your deposit request has been approved",
      body: "You have deposited an amount of ₱250.00 from your GCash account number 09123456789 to your Karera wallet...",
      status: "read" as const,
    },
    {
      userId,
      subject: "Your deposit request has been declined",
      body: "We regret to inform you that your deposit request of ₱250.00 from your GCash account number 09123456789 has been declined...",
      status: "unread" as const,
    }
  ];

  try {
    for (const email of emails) {
      // Check if an email for this userId + subject already exists
      const existingEmail = await db
        .select()
        .from(EmailTable)
        .where(
          and(
            eq(EmailTable.userId, email.userId),
            eq(EmailTable.subject, email.subject)
          )
        )
        .limit(1);

      if (existingEmail.length === 0) {
        await db.insert(EmailTable).values({
          userId: email.userId,
          subject: email.subject,
          body: email.body,
          status: email.status,
          createdAt: new Date(),
        });
        console.log(`✅ Inserted email for userId: ${email.userId}, subject: "${email.subject}"`);
      } else {
        console.log(`ℹ️ Skipping duplicate email for userId: ${email.userId}, subject: "${email.subject}"`);
      }
    }

    console.log("✅ Email seeding completed successfully!");
  } catch (error) {
    console.error("❌ Failed to seed emails:", error);
  } finally {
    process.exit(0);
  }
}

seedEmails();
