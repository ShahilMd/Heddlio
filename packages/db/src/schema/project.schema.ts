import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  boolean,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";

import { workflowCategoryEnum } from "./enums.schema.js";
import { organizations } from "./organization.schema.js";
import { users } from "./users.schema.js";

/**
 * A Jira-style project inside a workspace: owns an issue-key prefix, a
 * workflow and a label vocabulary.
 *
 * `issueSequence` is the single-writer counter behind human readable keys
 * (`ENG-142`). It is incremented with an atomic
 * `UPDATE projects SET issue_sequence = issue_sequence + 1 ... RETURNING`
 * inside the same transaction that inserts the issue - no separate counter
 * table, no gap-producing sequence, no `SELECT MAX(sequence)` race.
 */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    /** Short uppercase key used as the issue prefix, e.g. `ENG`. */
    key: varchar("key", { length: 10 }).notNull(),

    name: varchar("name", { length: 255 }).notNull(),

    description: text("description"),

    avatarUrl: varchar("avatar_url", { length: 1024 }),

    leadId: uuid("lead_id").references(() => users.id, {
      onDelete: "set null",
    }),

    issueSequence: integer("issue_sequence").default(0).notNull(),

    isArchived: boolean("is_archived").default(false).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // `ENG` is unique per workspace, not globally - two orgs may both have an
    // ENG project. This is the constraint that makes issue keys unambiguous.
    uniqueIndex("projects_org_key_uq").on(t.organizationId, t.key),

    index("projects_org_idx").on(t.organizationId),

    check(
      "projects_key_format_chk",
      sql`"key" ~ '^[A-Z][A-Z0-9]{1,9}$'`,
    ),
  ],
);

/**
 * Workflow columns. Scoped per project (Jira semantics) so each project can
 * model its own process, while `category` keeps cross-project reporting
 * possible: dashboards group by category, boards group by column.
 *
 * Deleting a status is blocked by `restrict` on `issues.status_id` - a
 * workflow change must move its issues first, never silently orphan them.
 */
export const workflowStatuses = pgTable(
  "workflow_statuses",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    name: varchar("name", { length: 50 }).notNull(),

    category: workflowCategoryEnum("category").notNull(),

    /** Left-to-right column order on the board. */
    position: integer("position").notNull(),

    /** Hex colour for the board chip, e.g. `#EB5757`. */
    color: varchar("color", { length: 7 }),

    isDefault: boolean("is_default").default(false).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("workflow_project_name_uq").on(t.projectId, t.name),

    // Board rendering order without a sort at read time.
    uniqueIndex("workflow_project_position_uq").on(t.projectId, t.position),

    // Exactly one landing column per project - a partial unique index enforces
    // that without the `false`-value trick a plain unique index would need.
    uniqueIndex("workflow_project_default_uq")
      .on(t.projectId)
      .where(sql`is_default = true`),

    check("workflow_position_chk", sql`"position" >= 0`),
  ],
);

/**
 * Project-scoped labels (Jira semantics). Colour + name is the whole model -
 * no nesting, no global label table: labels are a filtering vocabulary for
 * one project, and keeping them local avoids cross-project rename collisions.
 */
export const labels = pgTable(
  "labels",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    name: varchar("name", { length: 50 }).notNull(),

    color: varchar("color", { length: 7 }).notNull(),

    description: varchar("description", { length: 255 }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("labels_project_name_uq").on(t.projectId, t.name),
  ],
);
