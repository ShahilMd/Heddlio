import { pgTable, uuid, varchar, timestamp, index } from "drizzle-orm/pg-core";

import { userStatusEnum } from "./enums.schema.js";

/**
 * Global identity. Deliberately NOT scoped to an organization: one human has
 * one row and joins many workspaces through `organization_members`.
 *
 * `password` keeps its historical name so the already-migrated `users` table
 * receives an additive change only (no column drop/recreate). Rename to
 * `password_hash` by hand if you want the conventional name - it must store a
 * bcrypt/argon2 hash, never a plaintext password.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    name: varchar("name", { length: 255 }).notNull(),

    email: varchar("email", { length: 255 }).notNull().unique(),

    password: varchar("password", { length: 255 }).notNull(),

    status: userStatusEnum("status").default("active").notNull(),

    avatarUrl: varchar("avatar_url", { length: 1024 }),

    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),

    /**
     * Last time we saw the user's socket connect. Presence itself lives in
     * Redis (ephemeral, high churn) - this column is the durable fallback used
     * for "active 3d ago" style queries and must never be written per heartbeat.
     */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Admin user management filters ("disabled accounts") without a seq scan.
    index("users_status_idx").on(t.status),
  ],
);
