// database client – one shared drizzle instance over neon's http driver

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// next.js loads .env.local into process.env at startup, so no env-file
// loader is needed here (unlike in drizzle.config.ts, which runs outside next)
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  // names the variable, never the value – connection strings carry credentials
  throw new Error("DATABASE_URL is not set");
}

// neon-http sends each query as an https request instead of keeping a tcp
// connection open – a good fit for serverless, where long-lived connection
// pools leak across short-lived function instances
const sql = neon(databaseUrl);

// registering the schema enables the fully typed relational query api
// (db.query.links.findFirst(...)) on top of the sql-like builder
export const db = drizzle({ client: sql, schema });
