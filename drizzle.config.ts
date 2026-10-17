import { defineConfig } from "drizzle-kit";
import { resolveDbPath } from "./src/lib/db/path";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: resolveDbPath(),
  },
  verbose: true,
  strict: true,
  migrations: {
    table: "__drizzle_migrations",
    schema: "main",
  },
});
