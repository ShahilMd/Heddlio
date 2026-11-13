import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  date,
  bigint,
  integer,
  numeric,
  jsonb,
  customType,
  index,
  uniqueIndex,
  primaryKey,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import {
  issueLinkTypeEnum,
  issuePriorityEnum,
  issueTypeEnum,
} from "./enums.schema.js";
import { labels, projects, workflowStatuses } from "./project.schema.js";
import { users } from "./users.schema.js";

/**
 * `tsvector` is not a first-class drizzle column, so we declare it as a custom
 * type. drizzle-kit then emits the correct `tsvector` DDL, while the runtime
 * mapper simply hands the value back as a string.
 */
const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

/**
 * A Jira-style issue.
 *
 * Human readable key = `<projects.key>-<sequence>` (e.g. `ENG-142`), rendered
 * by the application from the two columns - it is never stored, so the key can
 * never drift from the row it names.
 */
export const issues = pgTable(
  "issues",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    /** Per-project counter; see `projects.issueSequence`. */
    sequence: integer("sequence").notNull(),

    title: varchar("title", { length: 500 }).notNull(),

    description: text("description"),

    type: issueTypeEnum("type").default("task").notNull(),

    statusId: uuid("status_id")
      .notNull()
      .references(() => workflowStatuses.id, { onDelete: "restrict" }),

    priority: issuePriorityEnum("priority").default("none").notNull(),

    assigneeId: uuid("assignee_id").references(() => users.id, {
      onDelete: "set null",
    }),

    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),

    /** Epic -> child issue hierarchy (subtasks roll up to their parent). */
    parentId: uuid("parent_id").references((): AnyPgColumn => issues.id, {
      onDelete: "set null",
    }),

    startDate: date("start_date"),

    dueDate: date("due_date"),

    /** Story points / t-shirt sizing - numeric so 0.5 and 8.5 both work. */
    estimate: numeric("estimate", { precision: 6, scale: 2, mode: "number" }),

    /**
     * LexoRank-style sort string (`a0`, `a1`, `aa`...) for drag-and-drop
     * ordering of boards and backlogs. Text ranks reorder in O(1) by
     * rewriting only the two neighbours, whereas a numeric `position` forces
     * an UPDATE of every row after the insertion point.
     */
    rank: text("rank").default("").notNull(),

    /** Set when the status category becomes `completed` - drives burndown. */
    completedAt: timestamp("completed_at", { withTimezone: true }),

    deletedAt: timestamp("deleted_at", { withTimezone: true }),

    /**
     * Generated column: title + description kept as a Postgres full-text
     * vector, so issue search needs no second system and no trigger to stay
     * in sync - the database recomputes it on every write.
     * Served by the GIN index below.
     */
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))`,
    ),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // The issue key itself. Also serves "all issues of this project".
    uniqueIndex("issues_project_seq_uq").on(t.projectId, t.sequence),

    /**
     * THE board query: `where project_id = ? and status_id in (...) order by
     * rank`. Leading equality columns + the ordering column in one index means
     * each board column is read in index order with zero sort.
     */
    index("issues_board_idx").on(t.projectId, t.statusId, t.rank),

    // "My issues" / assignee workload, filtered to live rows only so the
    // index stays small and dense.
    index("issues_assignee_status_idx")
      .on(t.assigneeId, t.statusId)
      .where(sql`deleted_at is null`),

    // Reporter's backlog and FK integrity on delete.
    index("issues_reporter_idx").on(t.reporterId),

    // Epic / subtask rollup.
    index("issues_parent_idx")
      .on(t.parentId)
      .where(sql`parent_id is not null`),

    // "Due this week" list views - partial so completed/closed rows drop out.
    index("issues_due_idx")
      .on(t.dueDate)
      .where(sql`deleted_at is null and due_date is not null`),

    // Full-text issue search (`websearch_to_tsquery`).
    index("issues_search_gin").using("gin", t.searchVector),

    check("issues_seq_chk", sql`"sequence" > 0`),

    // An issue cannot be its own parent.
    check(
      "issues_parent_self_chk",
      sql`parent_id is null or parent_id <> id`,
    ),
  ],
);

/**
 * Discussion on an issue. Separate from `messages` on purpose: different
 * retention, different permissions, different notification semantics, and
 * keeping them apart means neither table inherits the other's indexes.
 */
export const issueComments = pgTable(
  "issue_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),

    body: text("body").notNull(),

    editedAt: timestamp("edited_at", { withTimezone: true }),

    deletedAt: timestamp("deleted_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Comment thread pagination (oldest first, keyset on created_at).
    index("issue_comments_issue_idx").on(t.issueId, t.createdAt),
  ],
);

/**
 * Issue <-> label join. Composite PK: the pair is the identity, uniqueness is
 * free, and `(issue_id)` prefix lookups ("labels on this issue") need no
 * extra index.
 */
export const issueLabels = pgTable(
  "issue_labels",
  {
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),

    labelId: uuid("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.issueId, t.labelId] }),

    // Reverse direction: "every issue carrying this label" (filter panels).
    index("issue_labels_label_idx").on(t.labelId, t.issueId),
  ],
);

/**
 * Directed links between issues (`ENG-1 blocks ENG-2`).
 *
 * Composite PK guarantees no duplicate edge of the same type. The reverse
 * lookup (`linked_issue_id`) needs its own index because the PK leads with
 * `issue_id`.
 *
 * Note the pair is stored once, in the direction given: the application writes
 * both `A blocks B` and `B blocked_by A` when it needs a symmetric view, which
 * keeps the "what blocks me?" query index-only instead of requiring an OR.
 */
export const issueLinks = pgTable(
  "issue_links",
  {
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),

    linkedIssueId: uuid("linked_issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),

    type: issueLinkTypeEnum("type").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.issueId, t.linkedIssueId, t.type] }),

    index("issue_links_target_idx").on(t.linkedIssueId, t.type),

    check(
      "issue_links_self_chk",
      sql`issue_id <> linked_issue_id`,
    ),
  ],
);

/**
 * Append-only audit trail: every field change on an issue.
 *
 * `bigint` identity PK for the same reason as `messages` - this table only ever
 * grows, and a monotonic id keeps the B-tree append-only.
 *
 * `action` is deliberately `varchar` rather than an enum: audit vocabulary
 * grows with the product ("sprint_started", "due_date_shifted"...) and adding
 * an enum value requires a migration, while audit code should never be blocked
 * on one.
 */
export const issueActivity = pgTable(
  "issue_activity",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),

    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),

    /** NULL actor means the system (automation, import, status rule). */
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),

    action: varchar("action", { length: 50 }).notNull(),

    /**
     * Field-level before/after, e.g.
     * `{"status":{"from":"todo","to":"done"}}`. Structured (not a rendered
     * sentence) so the activity feed can be localised and diffed later.
     */
    changes: jsonb("changes").default(sql`'{}'`).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // Issue activity feed, newest first, keyset paginated on id.
    index("issue_activity_issue_idx").on(t.issueId, t.id),

    // "What did this person change?" + index coverage for the FK when a user
    // row is removed (`set null` would otherwise scan).
    index("issue_activity_actor_idx").on(t.actorId, t.createdAt),
  ],
);
