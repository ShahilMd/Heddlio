import { relations } from "drizzle-orm";

import { users } from "./users.schema.js";
import {
  organizations,
  organizationMembers,
  organizationInvitations,
} from "./organization.schema.js";
import { channels, channelMembers } from "./channel.schema.js";
import {
  messages,
  messageReactions,
  messageMentions,
} from "./message.schema.js";
import {
  projects,
  workflowStatuses,
  labels,
} from "./project.schema.js";
import {
  issues,
  issueComments,
  issueLabels,
  issueLinks,
  issueActivity,
} from "./issue.schema.js";
import { boards, boardMembers, boardObjects } from "./board.schema.js";
import { files, messageFiles, issueFiles } from "./file.schema.js";
import { notifications } from "./notification.schema.js";

/**
 * Relational graph for `db.query.*.findMany({ with: { ... } })`.
 *
 * Kept in one file instead of next to each table so that no two schema modules
 * import each other - the tables themselves only ever reference each other
 * through lazy `references(() => ...)` thunks, which makes the module graph a
 * clean DAG and removes any chance of a circular-import TDZ failure.
 *
 * Self-referencing relations (message threads, issue parents, board groups)
 * MUST carry an explicit `relationName`: without it drizzle cannot tell the
 * "parent" direction apart from the "children" direction and the generated
 * types silently collapse.
 */

/* ----------------------------- identity ----------------------------- */

export const usersRelations = relations(users, ({ many }) => ({
  organizationMemberships: many(organizationMembers),
  sentInvitations: many(organizationInvitations, { relationName: "inviter" }),
  ownedChannels: many(channels, { relationName: "channelCreator" }),
  channelMemberships: many(channelMembers),
  sentMessages: many(messages, { relationName: "messageAuthor" }),
  reactions: many(messageReactions),
  mentions: many(messageMentions),
  reportedIssues: many(issues, { relationName: "issueReporter" }),
  assignedIssues: many(issues, { relationName: "issueAssignee" }),
  issueComments: many(issueComments),
  issueActivity: many(issueActivity),
  createdBoards: many(boards, { relationName: "boardCreator" }),
  boardMemberships: many(boardMembers),
  uploadedFiles: many(files),
  notifications: many(notifications, { relationName: "notificationRecipient" }),
  actedOnNotifications: many(notifications, {
    relationName: "notificationActor",
  }),
}));

export const organizationsRelations = relations(
  organizations,
  ({ many }) => ({
    members: many(organizationMembers),
    invitations: many(organizationInvitations),
    channels: many(channels),
    projects: many(projects),
    boards: many(boards),
    files: many(files),
    notifications: many(notifications),
  }),
);

export const organizationMembersRelations = relations(
  organizationMembers,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [organizationMembers.organizationId],
      references: [organizations.id],
    }),
    user: one(users, {
      fields: [organizationMembers.userId],
      references: [users.id],
    }),
    inviter: one(users, {
      fields: [organizationMembers.invitedBy],
      references: [users.id],
      relationName: "inviter",
    }),
  }),
);

export const organizationInvitationsRelations = relations(
  organizationInvitations,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [organizationInvitations.organizationId],
      references: [organizations.id],
    }),
    invitedBy: one(users, {
      fields: [organizationInvitations.invitedBy],
      references: [users.id],
      relationName: "inviter",
    }),
  }),
);

/* ----------------------------- messaging ---------------------------- */

export const channelsRelations = relations(channels, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [channels.organizationId],
    references: [organizations.id],
  }),
  creator: one(users, {
    fields: [channels.createdBy],
    references: [users.id],
    relationName: "channelCreator",
  }),
  members: many(channelMembers),
  messages: many(messages),
}));

export const channelMembersRelations = relations(
  channelMembers,
  ({ one }) => ({
    channel: one(channels, {
      fields: [channelMembers.channelId],
      references: [channels.id],
    }),
    user: one(users, {
      fields: [channelMembers.userId],
      references: [users.id],
    }),
  }),
);

export const messagesRelations = relations(messages, ({ one, many }) => ({
  channel: one(channels, {
    fields: [messages.channelId],
    references: [channels.id],
  }),
  author: one(users, {
    fields: [messages.userId],
    references: [users.id],
    relationName: "messageAuthor",
  }),
  threadRoot: one(messages, {
    fields: [messages.threadRootId],
    references: [messages.id],
    relationName: "messageThread",
  }),
  replies: many(messages, { relationName: "messageThread" }),
  reactions: many(messageReactions),
  mentions: many(messageMentions),
  files: many(messageFiles),
}));

export const messageReactionsRelations = relations(
  messageReactions,
  ({ one }) => ({
    message: one(messages, {
      fields: [messageReactions.messageId],
      references: [messages.id],
    }),
    user: one(users, {
      fields: [messageReactions.userId],
      references: [users.id],
    }),
  }),
);

export const messageMentionsRelations = relations(
  messageMentions,
  ({ one }) => ({
    message: one(messages, {
      fields: [messageMentions.messageId],
      references: [messages.id],
    }),
    user: one(users, {
      fields: [messageMentions.userId],
      references: [users.id],
    }),
    channel: one(channels, {
      fields: [messageMentions.channelId],
      references: [channels.id],
    }),
  }),
);

/* --------------------------- work tracking -------------------------- */

export const projectsRelations = relations(projects, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [projects.organizationId],
    references: [organizations.id],
  }),
  lead: one(users, {
    fields: [projects.leadId],
    references: [users.id],
  }),
  statuses: many(workflowStatuses),
  labels: many(labels),
  issues: many(issues),
  boards: many(boards),
}));

export const workflowStatusesRelations = relations(
  workflowStatuses,
  ({ one, many }) => ({
    project: one(projects, {
      fields: [workflowStatuses.projectId],
      references: [projects.id],
    }),
    issues: many(issues),
  }),
);

export const labelsRelations = relations(labels, ({ one, many }) => ({
  project: one(projects, {
    fields: [labels.projectId],
    references: [projects.id],
  }),
  issues: many(issueLabels),
}));

export const issuesRelations = relations(issues, ({ one, many }) => ({
  project: one(projects, {
    fields: [issues.projectId],
    references: [projects.id],
  }),
  status: one(workflowStatuses, {
    fields: [issues.statusId],
    references: [workflowStatuses.id],
  }),
  assignee: one(users, {
    fields: [issues.assigneeId],
    references: [users.id],
    relationName: "issueAssignee",
  }),
  reporter: one(users, {
    fields: [issues.reporterId],
    references: [users.id],
    relationName: "issueReporter",
  }),
  parent: one(issues, {
    fields: [issues.parentId],
    references: [issues.id],
    relationName: "issueHierarchy",
  }),
  subissues: many(issues, { relationName: "issueHierarchy" }),
  comments: many(issueComments),
  labels: many(issueLabels),
  links: many(issueLinks, { relationName: "outgoingIssueLinks" }),
  backlinks: many(issueLinks, { relationName: "incomingIssueLinks" }),
  activity: many(issueActivity),
  files: many(issueFiles),
}));

export const issueCommentsRelations = relations(
  issueComments,
  ({ one }) => ({
    issue: one(issues, {
      fields: [issueComments.issueId],
      references: [issues.id],
    }),
    user: one(users, {
      fields: [issueComments.userId],
      references: [users.id],
    }),
  }),
);

export const issueLabelsRelations = relations(issueLabels, ({ one }) => ({
  issue: one(issues, {
    fields: [issueLabels.issueId],
    references: [issues.id],
  }),
  label: one(labels, {
    fields: [issueLabels.labelId],
    references: [labels.id],
  }),
}));

/**
 * One table, two relations - the classic self-join. `relationName` is what
 * tells drizzle that `issueLinks.issueId` is "outgoing" and
 * `issueLinks.linkedIssueId` is "incoming" instead of two views of one edge.
 */
export const issueLinksRelations = relations(issueLinks, ({ one }) => ({
  issue: one(issues, {
    fields: [issueLinks.issueId],
    references: [issues.id],
    relationName: "outgoingIssueLinks",
  }),
  linkedIssue: one(issues, {
    fields: [issueLinks.linkedIssueId],
    references: [issues.id],
    relationName: "incomingIssueLinks",
  }),
}));

export const issueActivityRelations = relations(issueActivity, ({ one }) => ({
  issue: one(issues, {
    fields: [issueActivity.issueId],
    references: [issues.id],
  }),
  actor: one(users, {
    fields: [issueActivity.actorId],
    references: [users.id],
  }),
}));

/* ---------------------------- whiteboard ---------------------------- */

export const boardsRelations = relations(boards, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [boards.organizationId],
    references: [organizations.id],
  }),
  project: one(projects, {
    fields: [boards.projectId],
    references: [projects.id],
  }),
  creator: one(users, {
    fields: [boards.createdBy],
    references: [users.id],
    relationName: "boardCreator",
  }),
  members: many(boardMembers),
  objects: many(boardObjects),
}));

export const boardMembersRelations = relations(boardMembers, ({ one }) => ({
  board: one(boards, {
    fields: [boardMembers.boardId],
    references: [boards.id],
  }),
  user: one(users, {
    fields: [boardMembers.userId],
    references: [users.id],
  }),
}));

export const boardObjectsRelations = relations(
  boardObjects,
  ({ one, many }) => ({
    board: one(boards, {
      fields: [boardObjects.boardId],
      references: [boards.id],
    }),
    parent: one(boardObjects, {
      fields: [boardObjects.parentId],
      references: [boardObjects.id],
      relationName: "boardObjectTree",
    }),
    children: many(boardObjects, { relationName: "boardObjectTree" }),
    creator: one(users, {
      fields: [boardObjects.createdBy],
      references: [users.id],
    }),
    updater: one(users, {
      fields: [boardObjects.updatedBy],
      references: [users.id],
    }),
  }),
);

/* ------------------------------ files ------------------------------- */

export const filesRelations = relations(files, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [files.organizationId],
    references: [organizations.id],
  }),
  uploader: one(users, {
    fields: [files.uploadedBy],
    references: [users.id],
  }),
  messages: many(messageFiles),
  issues: many(issueFiles),
}));

export const messageFilesRelations = relations(messageFiles, ({ one }) => ({
  message: one(messages, {
    fields: [messageFiles.messageId],
    references: [messages.id],
  }),
  file: one(files, {
    fields: [messageFiles.fileId],
    references: [files.id],
  }),
}));

export const issueFilesRelations = relations(issueFiles, ({ one }) => ({
  issue: one(issues, {
    fields: [issueFiles.issueId],
    references: [issues.id],
  }),
  file: one(files, {
    fields: [issueFiles.fileId],
    references: [files.id],
  }),
}));

/* --------------------------- notifications -------------------------- */

export const notificationsRelations = relations(
  notifications,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [notifications.organizationId],
      references: [organizations.id],
    }),
    recipient: one(users, {
      fields: [notifications.userId],
      references: [users.id],
      relationName: "notificationRecipient",
    }),
    actor: one(users, {
      fields: [notifications.actorId],
      references: [users.id],
      relationName: "notificationActor",
    }),
    channel: one(channels, {
      fields: [notifications.channelId],
      references: [channels.id],
    }),
    message: one(messages, {
      fields: [notifications.messageId],
      references: [messages.id],
    }),
    issue: one(issues, {
      fields: [notifications.issueId],
      references: [issues.id],
    }),
    board: one(boards, {
      fields: [notifications.boardId],
      references: [boards.id],
    }),
  }),
);
