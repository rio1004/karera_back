import { db } from "../src/db/index.ts";
import { ChatSessionTypes } from "../src/db/schema.ts";

const sessionTypes = [
  { name: "Withdrawal Concern", code: "withdrawal" },
  { name: "Deposit Concern", code: "deposit" },
  { name: "Account Verification", code: "verification" },
  { name: "Game Inquiry", code: "game" },
  { name: "Others", code: "others" },
];

async function seedChatSessionTypes() {
  try {
    const result = await db.insert(ChatSessionTypes)
      .values(sessionTypes)
      .onConflictDoNothing({ target: ChatSessionTypes.code });

    console.log("✅ ChatSessionTypes seeding complete");
    process.exit(0);
  } catch (err) {
    console.error("❌ ChatSessionTypes seeding failed:", err);
    process.exit(1);
  }
}

seedChatSessionTypes();
