import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const feedState = sqliteTable("feed_state", {
  id:text("id").primaryKey(),
  snapshot:text("snapshot").notNull(),
  fetchedAt:integer("fetched_at").notNull().default(0),
  nextPollAt:integer("next_poll_at").notNull().default(0),
  windowStart:integer("window_start").notNull().default(0),
  requests:integer("requests").notNull().default(0),
  blockedUntil:integer("blocked_until").notNull().default(0),
  lastError:text("last_error"),
});

export const aircraftTrails=sqliteTable("aircraft_trails",{
  icao:text("icao").primaryKey(),
  state:text("state").notNull(),
  updatedAt:integer("updated_at").notNull(),
});

export const trailBudget=sqliteTable("trail_budget",{
  id:text("id").primaryKey(),
  windowStart:integer("window_start").notNull(),
  samples:integer("samples").notNull().default(0),
});
