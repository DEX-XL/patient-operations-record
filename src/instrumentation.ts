// Server startup adapter for the Vercel/Turso marketplace's namespaced secrets.
// Keep credentials in the server process; never export them to client config.
export function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  if (!process.env.DATABASE_URL && process.env.DATABASE_TURSO_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.DATABASE_TURSO_DATABASE_URL;
  }
  if (!process.env.DATABASE_AUTH_TOKEN && process.env.DATABASE_TURSO_AUTH_TOKEN) {
    process.env.DATABASE_AUTH_TOKEN = process.env.DATABASE_TURSO_AUTH_TOKEN;
  }
}
