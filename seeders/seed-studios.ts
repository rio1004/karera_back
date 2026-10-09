import { db } from "../src/db/index.ts";
import { StudiosTable } from "../src/db/schema.ts";
import { sql } from "drizzle-orm";

const studios = [
  { studioNo: "DL01" },
  { studioNo: "DL02" },
  { studioNo: "DL03" },
  { studioNo: "DL04" },
  { studioNo: "DL05" },
];

async function seedStudios() {
  try {
    let inserted = 0;

    for (const studio of studios) {
      const exists = await db
        .select()
        .from(StudiosTable)
        .where(sql`${StudiosTable.studioNo} = ${studio.studioNo}`);

      if (exists.length === 0) {
        await db.insert(StudiosTable).values(studio);
        inserted++;
      }
    }

    console.log(`✅ Seeding complete. Inserted: ${inserted}`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Seeding failed:", err);
    process.exit(1);
  }
}

seedStudios();