import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  bigint,
  boolean,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";

import {
  channelRoleEnum,
  channelTypeEnum,
  notificationLevelEnum,
} from "./enums.schema.js";
import { organizations } from "./organization.schema.js";
import { users } from "./users.schema.js";

/**
 * A conversation container: public/private channels, 1:1 DMs and group DMs.
 *
 * DMs share this table (Slack's model) so that history, search, threads,
 * reactions and file storage all have exactly one code path. A DM simply has
 * `type = 'dm'` and a NULL `name`.
 */
export const channels = pgTable(
  "channels",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    type: channelTypeEnum("type").default("public").notNull(),

    /** NULL for DMs. Lowercase, hyphenated, <= 80 chars - enforced app-side. */
    name: varchar("name", { length: 80 }),

    topic: varchar("topic", { length: 255 }),

    purpose: text("purpose"),

    isArchived: boolean("is_archived").default(false).notNull(),

    archivedAt: timestamp("archived_at", { withTimezone: true }),

    /**
     * Denormalised from the newest message on write.
     *
     * The workspace sidebar needs "channel + last activity" for every channel a
     * user is in. Without these two columns that is one query per channel (N+1)
     * or a join over the largest table in the system. The cost is one extra row
     * update per posted message; the win is a single ordered read for the whole
     * sidebar.
     */
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),

    lastMessagePreview: varchar("last_message_preview", { length: 255 }),

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
    // Channel names are unique per workspace but only for named channels -
    // DMs have a NULL name and NULLs do not collide in a unique index, so no
    // extra predicate is needed for them.
    uniqueIndex("channels_org_name_uq").on(t.organizationId, t.name),

    // "Channels I belong to, most recently active first" - the sidebar query.
    index("channels_org_activity_idx").on(
      t.organizationId,
      t.lastMessageAt,
    ),

    // Directory listing / channel browser filters by type.
    index("channels_org_type_idx").on(t.organizationId, t.type),
  ],
);

/**
 * Membership, read state and per-channel preferences for one user.
 *
 * Composite PK because the row only exists as the pair, and because the hot
 * write ("mark this channel read") is always a lookup by that exact pair.
 *
 * `last_read_message_id` is a pointer into `messages.id`, NOT a timestamp:
 * message ids come from a monotonic sequence, so an unread count is a single
 * indexed comparison (`id > last_read`) with no clock-skew ambiguity, and it
 * stays correct across edits, deletions and out-of-order deliveries.
 *
 * It intentionally has no foreign key - FKs force the database to locate and
 * lock this row every time a message is hard-deleted, which is write
 * amplification on the busiest path in the product for no real benefit (the
 * value degrades to "0 unread", not to corrupt data).
 */
export const channelMembers = pgTable(
  "channel_members",
  {
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    role: channelRoleEnum("role").default("member").notNull(),

    notificationLevel: notificationLevelEnum("notification_level")
      .default("all")
      .notNull(),

    isMuted: boolean("is_muted").default(false).notNull(),

    lastReadMessageId: bigint("last_read_message_id", { mode: "number" })
      .default(0)
      .notNull(),

    lastReadAt: timestamp("last_read_at", { withTimezone: true }),

    joinedAt: timestamp("joined_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.userId] }),

    // "Which channels am I in?" - the PK starts with channel_id, so this
    // direction needs its own index. Also drives the unreads query
    // (`where user_id = ? and last_read_message_id < latest`).
    index("channel_members_user_idx").on(t.userId),

    // Channel roster rendering ("members of #general").
    index("channel_members_channel_idx").on(t.channelId),
  ],
);
