import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  bigint,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

import { notificationTypeEnum } from "./enums.schema.js";
import { boards } from "./board.schema.js";
import { channels } from "./channel.schema.js";
import { messages } from "./message.schema.js";
import { issues } from "./issue.schema.js";
import { organizations } from "./organization.schema.js";
import { users } from "./users.schema.js";

/**
 * Durable inbox for everything that needs a badge: mentions, assignments,
 * replies, invites, shares.
 *
 * The four reference columns are explicit nullable foreign keys rather than a
 * polymorphic `entity_type`/`entity_id` pair. Polymorphism cannot be enforced
 * by the database (nothing stops `entity_type = 'message'` pointing at an
 * issue id), whereas these four columns give real referential integrity,
 * cascade behaviour, and a direct index for "clean up notifications for this
 * deleted issue".
 *
 * All of them are `set null`: losing the link must never delete the
 * notification, it just degrades to a plain text entry.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    /** Recipient. */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** Who caused it - null for system/automation notifications. */
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),

    type: notificationTypeEnum("type").notNull(),

    title: varchar("title", { length: 255 }).notNull(),

    body: text("body"),

    channelId: uuid("channel_id").references(() => channels.id, {
      onDelete: "set null",
    }),

    messageId: bigint("message_id", { mode: "number" }).references(
      () => messages.id,
      { onDelete: "set null" },
    ),

    issueId: uuid("issue_id").references(() => issues.id, {
      onDelete: "set null",
    }),

    boardId: uuid("board_id").references(() => boards.id, {
      onDelete: "set null",
    }),

    /** Render-time payload (counts, label diffs, invite links). */
    data: jsonb("data").default(sql`'{}'`),

    readAt: timestamp("read_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // The inbox feed: "everything for me, newest first", keyset on id/created.
    index("notifications_user_feed_idx").on(t.userId, t.createdAt),

    /**
     * The unread badge. Partial so it only holds the unread rows - typically a
     * handful per user out of thousands, which keeps it in memory and makes
     * `count()` effectively free.
     */
    index("notifications_user_unread_idx")
      .on(t.userId)
      .where(sql`read_at is null`),

    /**
     * Intentionally NO standalone indexes on channel_id / message_id /
     * issue_id / board_id. They are only ever touched by cascade cleanups
     * (rare) and each extra index is a tax on the insert path of a table that
     * is written on every mention and comment. Add them the day a query
     * actually filters on them.
     */
  ],
);
