import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@libsql/client"],
  outputFileTracingIncludes: {
    // Every DB-backed route initializes independently on a serverless host.
    "/api/**": ["./drizzle/*.sql", "./drizzle/meta/_journal.json"],
    "/api/agent": ["./fixtures/recordings/*.json"],
  },
};
export default config;
