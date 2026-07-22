// drizzle-kit configuration — tells the cli where the schema lives and how to
// reach the database when pushing schema changes or opening the studio

import { defineConfig } from "drizzle-kit";

// loads .env.local into process.env for this cli process only — drizzle-kit
// does not read env files on its own. node's built-in loader (v20.12+) does
// the same job as the dotenv package without adding a dependency, and it
// never prints any of the loaded values
process.loadEnvFile(".env.local");

// fails fast when the variable is missing; the error names the variable but
// never echoes its value — connection strings contain credentials and must
// stay out of logs and terminal output
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set in .env.local");
}

export default defineConfig({
  // single source of truth for the database structure
  schema: "./src/db/schema.ts",

  // output folder for generated migration files, if migrations replace
  // push-based syncing later
  out: "./drizzle",

  dialect: "postgresql",

  // the guard above narrows the type to string, so no non-null assertion needed
  dbCredentials: { url: databaseUrl },
});
