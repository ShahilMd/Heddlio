import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  bigint,
  integer,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";

import { fileStatusEnum } from "./enums.schema.js";
import { messages } from "./message.schema.js";
import { issues } from "./issue.schema.js";
import { organizations } from "./organization.schema.js";
import { users } from "./users.schema.js";

/**
 * One uploaded object in storage, shared by messages, issues and boards.
 *
 * We store the storage KEY, never a public URL: objects stay private to the
 * workspace and every read goes through a short-lived signed URL issued after
 * an authorization check. A permanent public URL would make the CDN the
 * authorization layer, which is not one.
 *
 * `checksum` enables content-addressed de-duplication (the same 40 MB spec
 * uploaded twice is stored once) and lets us verify a completed upload.
 */
export const files = pgTable(
  "files",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    uploadedBy: uuid("uploaded_by").references(() => users.id, {
      onDelete: "set null",
    }),

    name: varchar("name", { length: 255 }).notNull(),

    mimeType: varchar("mime_type", { length: 100 }).notNull(),

    /** bigint, not integer: a 5 GB upload must not overflow an int4. */
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),

    storageKey: varchar("storage_key", { length: 1024 }).notNull(),

    /** Lowercase hex SHA-256 of the object bytes. */
    checksum: varchar("checksum", { length: 64 }),

    /** Cached image dimensions so the client can reserve layout space. */
    width: integer("width"),

    height: integer("height"),

    status: fileStatusEnum("status").default("pending").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // Referential integrity on the storage key - two rows must never claim
    // the same object path.
    uniqueIndex("files_storage_key_uq").on(t.storageKey),

    // Workspace file browser, newest first.
    index("files_org_created_idx").on(t.organizationId, t.createdAt),

    // De-duplication lookup ("do we already have these bytes?").
    index("files_org_checksum_idx").on(t.organizationId, t.checksum),
  ],
);

/**
 * Attachment ordering on a message. Composite PK keeps the join table
 * duplicate-free; the index on `file_id` covers the reverse question
 * ("where is this file used?") which the PK (leading with message_id) cannot.
 */
export const messageFiles = pgTable(
  "message_files",
  {
    messageId: bigint("message_id", { mode: "number" })
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),

    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),

    /** 0-based display order of the attachment inside the message. */
    position: integer("position").default(0).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.fileId] }),

    index("message_files_file_idx").on(t.fileId),
  ],
);

/** Same shape as `message_files`, for issue attachments. */
export const issueFiles = pgTable(
  "issue_files",
  {
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),

    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),

    position: integer("position").default(0).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.issueId, t.fileId] }),

    index("issue_files_file_idx").on(t.fileId),
  ],
);
