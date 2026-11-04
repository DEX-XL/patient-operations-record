import { mkdir } from "node:fs/promises";
import { migrate } from "drizzle-orm/libsql/migrator";
import { connectDatabase } from "./client";

let initialized: Promise<ReturnType<typeof connectDatabase>> | undefined;
export function runtimeDatabase() {
  if (!initialized) initialized = (async () => {
    const url = process.env.DATABASE_URL ?? "file:data/patient-ops.db";
    if (url === "file:data/patient-ops.db") await mkdir("data", { recursive: true });
    const connection = connectDatabase(url, process.env.DATABASE_AUTH_TOKEN);
    await migrate(connection.db, { migrationsFolder: "./drizzle" });
    return connection;
  })().catch((error) => { initialized = undefined; throw error; });
  return initialized;
}
