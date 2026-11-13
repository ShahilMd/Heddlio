import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  numeric,
  jsonb,
  boolean,
  index,
  primaryKey,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { boardObjectTypeEnum, boardRoleEnum } from "./enums.schema.js";
import { organizations } from "./organization.schema.js";
import { projects } from "./project.schema.js";
import { users } from "./users.schema.js";

/**
 * A Miro-style whiteboard, optionally hanging off a Jira project
 * (`project_id` lets a project own its discovery/board space).
 */
export const boards = pgTable(
  "boards",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),

    name: varchar("name", { length: 255 }).notNull(),

    description: text("description"),

    backgroundColor: varchar("background_color", { length: 7 }),

    thumbnailUrl: varchar("thumbnail_url", { length: 1024 }),

    /** Canvas bounds in board units - objects outside are simply off-screen. */
    width: numeric("width", {
      precision: 12,
      scale: 2,
      mode: "number",
    }).default(5000),

    height: numeric("height", {
      precision: 12,
      scale: 2,
      mode: "number",
    }).default(5000),

    isArchived: boolean("is_archived").default(false).notNull(),

    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Workspace board gallery, "recently edited first".
    index("boards_org_activity_idx").on(t.organizationId, t.updatedAt),

    // "Boards of this project" (nullable FK -> partial index keeps NULLs out).
    index("boards_project_idx")
      .on(t.projectId)
      .where(sql`project_id is not null`),
  ],
);

/** Per-board ACL. Composite PK = one role per user per board, enforced. */
export const boardMembers = pgTable(
  "board_members",
  {
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    role: boardRoleEnum("role").default("viewer").notNull(),

    addedAt: timestamp("added_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.boardId, t.userId] }),

    // "Which boards can I open?" - PK leads with board_id, so this needs one.
    index("board_members_user_idx").on(t.userId),
  ],
);

/**
 * Everything drawn on a canvas: sticky notes, shapes, frames, connectors...
 *
 * Geometry lives in dedicated numeric columns rather than inside `data`
 * because the viewport query has to filter and order on it - predicates over
 * jsonb keys cannot use a b-tree index the way real columns can.
 *
 * Ids are client-generated uuids: a real-time canvas mints ids offline and
 * syncs them later, so the server must accept an id it did not allocate.
 */
export const boardObjects = pgTable(
  "board_objects",
  {
    id: uuid("id").primaryKey(),

    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),

    type: boardObjectTypeEnum("type").notNull(),

    /** Nesting: objects inside a frame or group. */
    parentId: uuid("parent_id").references((): AnyPgColumn => boardObjects.id, {
      onDelete: "set null",
    }),

    x: numeric("x", { precision: 12, scale: 2, mode: "number" })
      .default(0)
      .notNull(),

    y: numeric("y", { precision: 12, scale: 2, mode: "number" })
      .default(0)
      .notNull(),

    width: numeric("width", { precision: 12, scale: 2, mode: "number" })
      .default(0)
      .notNull(),

    height: numeric("height", { precision: 12, scale: 2, mode: "number" })
      .default(0)
      .notNull(),

    /** Degrees; rendering handles rotation, the DB only stores it. */
    rotation: numeric("rotation", {
      precision: 6,
      scale: 2,
      mode: "number",
    })
      .default(0)
      .notNull(),

    /** Paint order for the renderer - the sort key of the hot query. */
    zIndex: integer("z_index").default(0).notNull(),

    /** Colours, strokes, font sizes, corner radius... */
    style: jsonb("style").default(sql`'{}'`),

    /** Content: note text, shape label, image url, connector endpoints... */
    data: jsonb("data").default(sql`'{}'`),

    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),

    updatedBy: uuid("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),

    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    /**
     * The render query: `where board_id = ? and deleted_at is null
     * order by z_index`. Partial so deleted objects (which are numerous on a
     * busy board and linger until compaction) never bloat the index.
     */
    index("board_objects_render_idx")
      .on(t.boardId, t.zIndex)
      .where(sql`deleted_at is null`),

    // Children of a frame/group, fetched on expand.
    index("board_objects_children_idx")
      .on(t.boardId, t.parentId)
      .where(sql`parent_id is not null`),

    // Objects are never their own parent.
    check(
      "board_objects_parent_self_chk",
      sql`parent_id is null or parent_id <> id`,
    ),
  ],
);
