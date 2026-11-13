import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Central enum registry.
 *
 * Postgres ENUM types are global to the schema and are created by drizzle-kit
 * in dependency order. Keeping every enum in one file makes the closed
 * vocabularies of the product auditable at a glance, and guarantees that the
 * drizzle-kit glob (`*.schema.ts`) picks them up during `generate`.
 *
 * Rule of thumb used here:
 *  - ENUM  -> the set of values is small, stable, and queried with equality
 *             (so PG gets a compact 4-byte label and can build tiny indexes).
 *  - VARCHAR / TEXT -> the value grows at runtime (names, actions, tokens).
 */

/* ------------------------------------------------------------------ */
/* Identity & tenancy                                                  */
/* ------------------------------------------------------------------ */

export const userStatusEnum = pgEnum("user_status", [
  "active",
  "invited",
  "disabled",
]);

export const organizationRoleEnum = pgEnum("organization_role", [
  "owner",
  "admin",
  "member",
  "guest",
]);

export const memberStatusEnum = pgEnum("member_status", [
  "invited",
  "active",
  "suspended",
  "removed",
]);

/* ------------------------------------------------------------------ */
/* Messaging (Slack-like)                                              */
/* ------------------------------------------------------------------ */

export const channelTypeEnum = pgEnum("channel_type", [
  "public",
  "private",
  "dm",
  "group_dm",
]);

export const channelRoleEnum = pgEnum("channel_role", ["owner", "member"]);

export const notificationLevelEnum = pgEnum("notification_level", [
  "all",
  "mentions",
  "none",
]);

export const messageTypeEnum = pgEnum("message_type", [
  "user",
  "system",
  "bot",
  "file_share",
  "join_leave",
  "topic_change",
]);

/* ------------------------------------------------------------------ */
/* Work tracking (Jira-like)                                           */
/* ------------------------------------------------------------------ */

export const issueTypeEnum = pgEnum("issue_type", [
  "epic",
  "story",
  "task",
  "bug",
  "subtask",
]);

export const issuePriorityEnum = pgEnum("issue_priority", [
  "none",
  "low",
  "medium",
  "high",
  "urgent",
]);

/**
 * Board columns are grouped by category so that reporting and cross-project
 * dashboards can answer "how much work is started?" without knowing every
 * project's custom status name.
 */
export const workflowCategoryEnum = pgEnum("workflow_category", [
  "backlog",
  "todo",
  "started",
  "completed",
  "canceled",
]);

export const issueLinkTypeEnum = pgEnum("issue_link_type", [
  "blocks",
  "blocked_by",
  "relates_to",
  "duplicates",
  "duplicated_by",
]);

/* ------------------------------------------------------------------ */
/* Whiteboard (Miro-like)                                              */
/* ------------------------------------------------------------------ */

export const boardRoleEnum = pgEnum("board_role", [
  "owner",
  "editor",
  "commenter",
  "viewer",
]);

export const boardObjectTypeEnum = pgEnum("board_object_type", [
  "frame",
  "sticky_note",
  "shape",
  "text",
  "connector",
  "image",
  "group",
  "pen",
  "table",
  "mind_map",
  "card",
]);

/* ------------------------------------------------------------------ */
/* Cross-cutting                                                       */
/* ------------------------------------------------------------------ */

export const notificationTypeEnum = pgEnum("notification_type", [
  "mention",
  "reply",
  "assign",
  "status_change",
  "comment",
  "reaction",
  "invite",
  "share",
  "system",
]);

/**
 * Upload lifecycle. Rows are created as `pending` before the client receives
 * storage credentials and flipped to `ready` by the completion callback, so a
 * crash mid-upload never leaves an attachment that points at nothing.
 */
export const fileStatusEnum = pgEnum("file_status", [
  "pending",
  "uploading",
  "ready",
  "failed",
]);
