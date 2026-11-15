import {
  boolean,
  index,
  pgTable,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Global permission catalog.
 *
 * `key` is the primary key instead of a surrogate uuid: keys are stable,
 * human-readable, and every authorization decision already works in terms of
 * keys. That makes grants (`organization_role_permissions`) and overrides
 * self-describing in a psql session, and removes a join from the hot path.
 *
 * Rows are projected from `@heddlio/auth` at boot and by the migration. This
 * table exists so foreign keys and reporting can rely on the vocabulary; it is
 * never the place to invent permissions.
 */
export const permissions = pgTable(
  "permissions",
  {
    key: varchar("key", { length: 100 }).primaryKey(),

    /** Coarse grouping for the admin UI (`org`, `member`, `issue`, ...). */
    resource: varchar("resource", { length: 64 }).notNull(),

    action: varchar("action", { length: 64 }).notNull(),

    description: varchar("description", { length: 255 }).notNull(),

    /**
     * False for owner-only capabilities such as `org.delete`. Custom roles and
     * per-member overrides can never carry these.
     */
    isAssignable: boolean("is_assignable").default(true).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // "Show me every permission for the Issues screen".
    index("permissions_resource_idx").on(t.resource, t.action),
  ],
);
