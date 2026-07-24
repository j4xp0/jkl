// database schema – a single table that stores every shortened link

import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const links = pgTable("links", {
  // surrogate primary key for internal joins and ordering; it is never
  // exposed in urls – sequential ids would let anyone enumerate all links,
  // so the public identifier is always the random slug below
  id: serial("id").primaryKey(),

  // short public identifier (nanoid, 7 chars today; 16 leaves headroom for
  // custom aliases). unique gives a database-level index and makes slug
  // collisions a hard constraint violation instead of silent data corruption
  slug: varchar("slug", { length: 16 }).unique().notNull(),

  // the destination url; text instead of varchar because validated input is
  // capped at the application layer and postgres treats both the same
  url: text("url").notNull(),

  // timestamptz stores an absolute point in time (utc) – plain timestamp
  // would silently depend on the server's timezone setting
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),

  // operational metric, incremented atomically in sql on every redirect
  clicks: integer("clicks").notNull().default(0),

  // null until the first redirect happens – "never clicked" is a real state
  // and null models it better than a fake epoch date
  lastClickedAt: timestamp("last_clicked_at", { withTimezone: true }),
});

// row types inferred straight from the table definition – the schema stays
// the single source of truth, no hand-written interfaces to drift out of sync
export type Link = typeof links.$inferSelect;
export type NewLink = typeof links.$inferInsert;
