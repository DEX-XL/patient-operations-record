import { defineConfig } from "drizzle-kit";

// No dotenv: secret files are deliberately never loaded by tooling.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: { url: process.env.DATABASE_URL ?? "file:data/patient-ops.db", authToken: process.env.DATABASE_AUTH_TOKEN },
});
