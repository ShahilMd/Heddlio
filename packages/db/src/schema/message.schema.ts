import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  bigint,
  integer,
  jsonb,
  index,
  primaryKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { messageTypeEnum } from "./enums.schema.js";
import { channels } from "./channel.schema.js";
import { users } from "./users.schema.js";

/**
 * The highest-volume table in the system - treat every column here as if it
 * costs money, because at scale it does.
 *
 * Primary key is `bigint ... GENERATED ALWAYS AS IDENTITY` rather than uuid:
 *   - 8 bytes instead of 16, which halves the size of every index that
 *     references a message (reactions, mentions, files, read pointers),
 *   - values are assigned in insertion order, so the PK B-tree appends to the
 *     right-hand page instead of scattering random uuids and splitting pages,
 *   - it doubles as a monotonic cursor for keyset pagination and unread counts.
 *
 * Downside to know about: a `bigint` id must not be exposed as a JS `number`
 * beyond 2^53 - drizzle is configured with `mode: 'number'`, which is safe for
 * any row count this product will ever reach, but switch to `mode: 'bigint'`
 * if you ever generate synthetic ids.
 */
export const messages = pgTable(
  "messages",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),

    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),

    /** NULL for system messages ("X joined the channel", "topic changed"). */
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    type: messageTypeEnum("type").default("user").notNull(),

    /**
     * Threading. NULL means "this is a root message"; a reply points at its
     * root. Keeping the root's own thread_root_id NULL lets us distinguish
     * "root" from "reply" without a second flag column, and the partial index
     * below keeps thread lookups off the hot path of normal channel history.
     */
    threadRootId: bigint("thread_root_id", { mode: "number" }).references(
      (): AnyPgColumn => messages.id,
      { onDelete: "set null" },
    ),

    body: text("body").notNull(),

    /** Slack-style structured blocks (buttons, inputs, app payloads). */
    blocks: jsonb("blocks").default(sql`'{}'`),

    /** Denormalised onto the root so thread previews cost zero extra reads. */
    replyCount: integer("reply_count").default(0).notNull(),

    lastReplyAt: timestamp("last_reply_at", { withTimezone: true }),

    editedAt: timestamp("edited_at", { withTimezone: true }),

    /**
     * Soft delete. Messages are almost never hard-deleted: compliance,
     * moderation appeals, "delete for everyone vs delete for me" and undo all
     * need the row to survive. Hard deletion of a channel still cascades.
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    /**
     * THE hot index. `channel_id` equality + `id` ordering gives:
     *   - channel history with keyset pagination (`where id < ?`), no sort,
     *   - unread counts (`where id > last_read_message_id`), no sort,
     *   - "jump to message" by id.
     * It is deliberately ordered by id, not created_at: id IS the insert
     * order, so this index stays perfectly append-only.
     */
    index("messages_channel_cursor_idx").on(t.channelId, t.id),

    /**
     * Thread replies. Partial so that the millions of unthreaded messages are
     * never indexed here - this index only holds rows that actually belong to
     * a thread.
     */
    index("messages_thread_idx")
      .on(t.threadRootId, t.id)
      .where(sql`thread_root_id is not null`),

    /**
     * BRIN, not B-tree: a few kilobytes for the whole table instead of
     * gigabytes. Because `created_at` is monotonic on an append-only table,
     * a block-range index answers retention sweeps, "messages since date"
     * and analytics scans just as well as a B-tree at ~1/1000th the size.
     */
    index("messages_created_brin").using("brin", t.createdAt),
  ],
);

/**
 * One row per (message, user, emoji). Composite PK gives uniqueness for free
 * and means the prefix `(message_id)` already serves "who reacted to this?" -
 * no extra index required.
 */
export const messageReactions = pgTable(
  "message_reactions",
  {
    messageId: bigint("message_id", { mode: "number" })
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** Short unicode emoji or a custom `:shortcode:` - never a free-form blob. */
    emoji: varchar("emoji", { length: 32 }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.userId, t.emoji] }),
  ],
);

/**
 * "@channel" / "@user" targets for a message.
 *
 * `channel_id` is denormalised on purpose. The unread-mentions badge - one of
 * the most frequently executed queries in the product - is otherwise
 * `message_mentions join messages` on the largest table in the database.
 * Storing the channel here turns it into a single covered index lookup
 * (`channel_id, user_id, message_id`).
 */
export const messageMentions = pgTable(
  "message_mentions",
  {
    messageId: bigint("message_id", { mode: "number" })
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.userId] }),

    // "Unread mentions for me in this channel" - the badge query.
    index("mentions_channel_user_idx").on(
      t.channelId,
      t.userId,
      t.messageId,
    ),

    // "Everything I was ever mentioned in" (notification history / inbox).
    index("mentions_user_idx").on(t.userId, t.createdAt),
  ],
);
