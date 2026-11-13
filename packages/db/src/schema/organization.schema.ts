import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";

import {
  memberStatusEnum,
  organizationRoleEnum,
} from "./enums.schema.js";
import { users } from "./users.schema.js";

/**
 * The tenancy boundary - a Slack workspace / Jira site / Miro team.
 *
 * EVERY feature table in this package carries `organization_id`. That single
 * discipline buys us three things that are painful to add later:
 *   1. tenant isolation in one WHERE clause (and cheap Postgres RLS later),
 *   2. per-tenant partitioning/sharding if one tenant ever gets huge,
 *   3. the ability to purge a whole workspace with one cascading delete.
 *
 * `slug` backs subdomain routing (`acme.yourapp.com`), hence the tight length
 * and the unique constraint.
 */
export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    name: varchar("name", { length: 255 }).notNull(),

    slug: varchar("slug", { length: 110 }).notNull().unique(),

    logoUrl: varchar("logo_url", { length: 1024 }),

    /** Feature flags, branding, retention policy - open ended on purpose. */
    settings: jsonb("settings").default(sql`'{}'`).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Keeps tenant rows physically clustered when we later add an
    // `organization_id` partition key or a per-tenant backup job.
    index("organizations_created_idx").on(t.createdAt),
  ],
);

/**
 * Membership + role. Composite primary key instead of a surrogate id: this row
 * is only ever addressed as "this user in this org", so the pair IS the
 * identity, the uniqueness is enforced by the storage engine itself, and no
 * other table ever needs to reference it.
 */
export const organizationMembers = pgTable(
  "organization_members",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    role: organizationRoleEnum("role").default("member").notNull(),

    status: memberStatusEnum("status").default("active").notNull(),

    /** Who invited this member - null for the founder / SCIM provisioned rows. */
    invitedBy: uuid("invited_by").references(() => users.id, {
      onDelete: "set null",
    }),

    joinedAt: timestamp("joined_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.userId] }),

    // "Which workspaces am I in?" - the membership PK starts with
    // organization_id, so it cannot serve this direction.
    index("org_members_user_idx").on(t.userId),

    // Role audits: "who are the admins of this org?".
    index("org_members_org_role_idx").on(t.organizationId, t.role),
  ],
);

/**
 * Invite tokens. Only the SHA-256 hash is stored: a database dump must not be
 * enough to hijack an invitation.
 *
 * The partial unique index is what actually protects us - it rejects a second
 * *pending* invite for the same address while still allowing re-invites after
 * the first one is accepted, expires or is revoked.
 */
export const organizationInvitations = pgTable(
  "organization_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    email: varchar("email", { length: 255 }).notNull(),

    role: organizationRoleEnum("role").default("member").notNull(),

    tokenHash: varchar("token_hash", { length: 64 }).notNull(),

    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    acceptedAt: timestamp("accepted_at", { withTimezone: true }),

    revokedAt: timestamp("revoked_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // Lookup when the invitee clicks the link.
    uniqueIndex("org_invites_token_uq").on(t.tokenHash),

    index("org_invites_org_idx").on(t.organizationId, t.createdAt),

    // One live invite per address per workspace.
    uniqueIndex("org_invites_pending_uq")
      .on(t.organizationId, t.email)
      .where(sql`accepted_at is null and revoked_at is null`),

    // Expiry sweeper / "resend" UI.
    index("org_invites_expiry_idx").on(t.expiresAt).where(
      sql`accepted_at is null and revoked_at is null`,
    ),
  ],
);
