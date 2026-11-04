import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

export function connectDatabase(url: string, authToken?: string) {
  const client = createClient({ url, authToken });
  return { client, db: drizzle(client, { schema }) };
}
export type DatabaseConnection = ReturnType<typeof connectDatabase>;
