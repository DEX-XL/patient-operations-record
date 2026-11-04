import { mkdir } from "node:fs/promises";
import { migrate } from "drizzle-orm/libsql/migrator";
import { connectDatabase } from "../src/db/client";

async function main() {
  const url = process.env.DATABASE_URL ?? "file:data/patient-ops.db";
  if (url === "file:data/patient-ops.db") await mkdir("data", { recursive: true });
  const { client, db } = connectDatabase(url, process.env.DATABASE_AUTH_TOKEN);
  try { await migrate(db, { migrationsFolder: "./drizzle" }); console.log("Synthetic database migrations applied."); }
  finally { client.close(); }
}
main().catch(() => { console.error("Migration failed. Database details withheld."); process.exitCode = 1; });
