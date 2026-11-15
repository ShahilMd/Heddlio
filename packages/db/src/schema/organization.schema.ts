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
  boolean,
  integer,
  bigint,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";

import {
  memberStatusEnum,
  permissionOverrideEffectEnum,
} from "./enums.schema.js";
import { permissions } from "./permission.schema.js";
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
 * A role owned by one organization.
 *
 * Roles are rows, not an enum, so an org can define Developer, Manager,
 * Contractor, On-call, ... without a migration. The hierarchy is expressed as
 * an integer `rank`: every escalation check is `actor.rank > target.rank`,
 * which is cheap to evaluate and impossible to turn into a cycle.
 *
 * The six seeded templates live in `@heddlio/auth`. Only the owner row is
 * protected (`is_system` + `is_owner`); every other row is ordinary data.
 */
export const organizationRoles = pgTable(
  "organization_roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    name: varchar("name", { length: 64 }).notNull(),

    /** Stable, URL-safe identifier used by clients and audit rows. */
    slug: varchar("slug", { length: 64 }).notNull(),

    description: varchar("description", { length: 255 }),

    /** Higher ranks outrank lower ones. See the note above. */
    rank: integer("rank").default(0).notNull(),

    /** System roles cannot be edited or deleted (currently only `owner`). */
    isSystem: boolean("is_system").default(false).notNull(),

    /** Exactly one owner role per organization; implicitly holds every key. */
    isOwner: boolean("is_owner").default(false).notNull(),

    /** Assigned to new members when no explicit role is requested. */
    isDefault: boolean("is_default").default(false).notNull(),

    /**
     * Soft delete. A role referenced by audit rows, invitations or historical
     * memberships stays understandable after it is retired; a hard delete would
     * turn those references into opaque uuids or block on the FK.
     */
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
    // Slug and name are unique among live roles only, so a deleted role's name
    // can be reused without a second "archived names" registry.
    uniqueIndex("org_roles_slug_uq")
      .on(t.organizationId, t.slug)
      .where(sql`deleted_at is null`),

    uniqueIndex("org_roles_name_uq")
      .on(t.organizationId, t.name)
      .where(sql`deleted_at is null`),

    // Composite FK target. `id` is already unique, but Postgres requires a
    // unique constraint on the exact referenced pair, and this pair is what
    // lets members/invitations prove their role belongs to the same tenant.
    uniqueIndex("org_roles_org_id_id_uq").on(t.organizationId, t.id),

    // Structural invariants enforced by storage, not by application hope.
    uniqueIndex("org_roles_owner_uq")
      .on(t.organizationId)
      .where(sql`is_owner = true and deleted_at is null`),

    uniqueIndex("org_roles_default_uq")
      .on(t.organizationId)
      .where(sql`is_default = true and deleted_at is null`),

    // Role picker, ordered by authority.
    index("org_roles_org_rank_idx").on(t.organizationId, t.rank),

    check("org_roles_rank_chk", sql`rank >= 0`),
  ],
);

/**
 * Membership + role. Composite primary key instead of a surrogate id: this row
 * is only ever addressed as "this user in this org", so the pair IS the
 * identity, the uniqueness is enforced by the storage engine itself, and no
 * other table ever needs to reference it.
 *
 * `role_id` replaced the original `organization_role` enum in migration 0002.
 * One role per member keeps the mental model simple; per-member overrides in
 * `organization_member_permission_overrides` cover the "just this one person"
 * case without inventing multi-role merge semantics.
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

    roleId: uuid("role_id").notNull(),

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

    // A role can only be assigned inside its own organization. A plain FK on
    // role_id would happily accept another tenant's role uuid; the composite
    // FK makes cross-tenant assignment impossible at the storage layer.
    foreignKey({
      name: "org_members_role_fk",
      columns: [t.organizationId, t.roleId],
      foreignColumns: [organizationRoles.organizationId, organizationRoles.id],
    }).onDelete("restrict"),

    // "Which workspaces am I in?" - the membership PK starts with
    // organization_id, so it cannot serve this direction.
    index("org_members_user_idx").on(t.userId),

    // Member list / "who has the Manager role?".
    index("org_members_org_role_id_idx").on(t.organizationId, t.roleId),

    // Member directory: tenant-scoped, newest-joined first, keyset paginated.
    index("org_members_org_joined_idx").on(
      t.organizationId,
      t.joinedAt,
      t.userId,
    ),
  ],
);

/**
 * Role -> permission grants.
 *
 * Composite primary key again: the pair is the identity, so duplicate grants
 * are impossible without a second unique index. `permission_key` is the natural
 * key from `permissions`; that keeps grants readable and lets the catalog be
 * projected without rewriting uuids.
 */
export const organizationRolePermissions = pgTable(
  "organization_role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => organizationRoles.id, { onDelete: "cascade" }),

    permissionKey: varchar("permission_key", { length: 100 })
      .notNull()
      .references(() => permissions.key, { onDelete: "restrict" }),

    grantedBy: uuid("granted_by").references(() => users.id, {
      onDelete: "set null",
    }),

    grantedAt: timestamp("granted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permissionKey] }),

    // Reverse lookup: "which roles hold org.transfer_ownership?" - used by the
    // permission editor and by security reviews.
    index("role_permissions_permission_idx").on(t.permissionKey),
  ],
);

/**
 * Per-member permission overrides - the "same role, but only Sam may do this"
 * requirement.
 *
 * `allow` adds a capability on top of the role, `deny` removes one. The pair
 * (member, permission) is the primary key, so both effects can never collide.
 * `expires_at` supports temporary elevation (incident response, coverage)
 * without a manual cleanup job; the resolver ignores expired rows.
 *
 * The composite FK guarantees an override cannot outlive its membership or
 * exist for a user who was never in the organization.
 */
export const organizationMemberPermissionOverrides = pgTable(
  "organization_member_permission_overrides",
  {
    organizationId: uuid("organization_id").notNull(),

    userId: uuid("user_id").notNull(),

    permissionKey: varchar("permission_key", { length: 100 })
      .notNull()
      .references(() => permissions.key, { onDelete: "restrict" }),

    effect: permissionOverrideEffectEnum("effect").notNull(),

    /** Free-text justification; shown in the audit trail. */
    reason: varchar("reason", { length: 255 }),

    grantedBy: uuid("granted_by").references(() => users.id, {
      onDelete: "set null",
    }),

    /** Null = permanent. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    primaryKey({
      columns: [t.organizationId, t.userId, t.permissionKey],
    }),

    foreignKey({
      name: "member_overrides_member_fk",
      columns: [t.organizationId, t.userId],
      foreignColumns: [
        organizationMembers.organizationId,
        organizationMembers.userId,
      ],
    }).onDelete("cascade"),

    // "Who has this one-off grant?" for access reviews.
    index("member_overrides_permission_idx").on(t.permissionKey),

    // Expiry sweeper indexes only rows that can actually expire.
    index("member_overrides_expiry_idx")
      .on(t.expiresAt)
      .where(sql`expires_at is not null`),
  ],
);

export interface InvitationPermissionOverride {
  permissionKey: string;
  effect: "allow" | "deny";
  /** ISO timestamp; omitted/null means it never expires. */
  expiresAt?: string | null;
}

/**
 * Invite tokens. Only the SHA-256 hash is stored: a database dump must not be
 * enough to hijack an invitation.
 *
 * The partial unique index is what actually protects us - it rejects a second
 * *pending* invite for the same address while still allowing re-invites after
 * the first one is accepted, expires or is revoked. Because a partial index
 * predicate cannot call `now()`, the service revokes an expired row before
 * inserting the replacement.
 *
 * `permission_overrides` is deliberately JSONB: an invitation is a short-lived,
 * bounded list of grants that is validated on write and copied into the real
 * override table on accept. Normalising it would add a table and a cascade for
 * data that never needs to be queried independently.
 */
export const organizationInvitations = pgTable(
  "organization_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    email: varchar("email", { length: 255 }).notNull(),

    roleId: uuid("role_id").notNull(),

    tokenHash: varchar("token_hash", { length: 64 }).notNull(),

    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    permissionOverrides: jsonb("permission_overrides")
      .$type<InvitationPermissionOverride[]>()
      .default(sql`'[]'`)
      .notNull(),

    /** Optional note rendered in the invitation email. */
    message: varchar("message", { length: 500 }),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    acceptedAt: timestamp("accepted_at", { withTimezone: true }),

    acceptedBy: uuid("accepted_by").references(() => users.id, {
      onDelete: "set null",
    }),

    revokedAt: timestamp("revoked_at", { withTimezone: true }),

    revokedBy: uuid("revoked_by").references(() => users.id, {
      onDelete: "set null",
    }),

    /** Resend bookkeeping; the token itself is rotated, not reused. */
    sendCount: integer("send_count").default(1).notNull(),

    lastSentAt: timestamp("last_sent_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // Lookup when the invitee clicks the link.
    uniqueIndex("org_invites_token_uq").on(t.tokenHash),

    // Same tenant-integrity guarantee as membership: an invitation cannot
    // point at a role owned by a different organization.
    foreignKey({
      name: "org_invites_role_fk",
      columns: [t.organizationId, t.roleId],
      foreignColumns: [organizationRoles.organizationId, organizationRoles.id],
    }).onDelete("restrict"),

    index("org_invites_org_idx").on(t.organizationId, t.createdAt),

    // One live invite per address per workspace.
    uniqueIndex("org_invites_pending_uq")
      .on(t.organizationId, t.email)
      .where(sql`accepted_at is null and revoked_at is null`),

    // Expiry sweeper / "resend" UI.
    index("org_invites_expiry_idx").on(t.expiresAt).where(
      sql`accepted_at is null and revoked_at is null`,
    ),

    // "Which pending invitations target this role?" - role deletion revokes
    // them before retiring the role.
    index("org_invites_role_idx")
      .on(t.roleId)
      .where(sql`accepted_at is null and revoked_at is null`),
  ],
);

/**
 * Append-only audit trail for security-sensitive tenancy changes.
 *
 * Authorization bugs are only debuggable if you can answer "who granted this,
 * when, and from what?". Bigint identity because the table only ever grows and
 * the id doubles as a keyset pagination cursor.
 *
 * General workspace activity (issues, messages) lives in `issue_activity` and
 * the message stream; this table is specifically the permission/role/invite
 * timeline.
 */
export const organizationAuditEvents = pgTable(
  "organization_audit_events",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),

    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    /** Null actor = system/automation. */
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),

    action: varchar("action", { length: 100 }).notNull(),

    targetType: varchar("target_type", { length: 50 }),

    targetId: varchar("target_id", { length: 100 }),

    /** Structured before/after payload, never a rendered sentence. */
    changes: jsonb("changes").default(sql`'{}'`).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // Organization audit feed, newest first, keyset paginated on id.
    index("org_audit_org_idx").on(t.organizationId, t.id),

    // "What did this admin change?" for incident review.
    index("org_audit_actor_idx").on(t.actorId, t.createdAt),
  ],
);
