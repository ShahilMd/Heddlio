CREATE TYPE "public"."permission_override_effect" AS ENUM('allow', 'deny');--> statement-breakpoint
CREATE TABLE "organization_audit_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "organization_audit_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" varchar(100) NOT NULL,
	"target_type" varchar(50),
	"target_id" varchar(100),
	"changes" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_member_permission_overrides" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"permission_key" varchar(100) NOT NULL,
	"effect" "permission_override_effect" NOT NULL,
	"reason" varchar(255),
	"granted_by" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_member_permission_overrides_organization_id_user_id_permission_key_pk" PRIMARY KEY("organization_id","user_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE "organization_role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_key" varchar(100) NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_role_permissions_role_id_permission_key_pk" PRIMARY KEY("role_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE "organization_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(64) NOT NULL,
	"slug" varchar(64) NOT NULL,
	"description" varchar(255),
	"rank" integer DEFAULT 0 NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_owner" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_roles_rank_chk" CHECK (rank >= 0)
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"resource" varchar(64) NOT NULL,
	"action" varchar(64) NOT NULL,
	"description" varchar(255) NOT NULL,
	"is_assignable" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "org_members_org_role_idx";--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD COLUMN "role_id" uuid;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD COLUMN "permission_overrides" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD COLUMN "message" varchar(500);--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD COLUMN "accepted_by" uuid;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD COLUMN "revoked_by" uuid;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD COLUMN "send_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD COLUMN "last_sent_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_members" ADD COLUMN "role_id" uuid;--> statement-breakpoint
ALTER TABLE "organization_audit_events" ADD CONSTRAINT "organization_audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_audit_events" ADD CONSTRAINT "organization_audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_member_permission_overrides" ADD CONSTRAINT "organization_member_permission_overrides_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_member_permission_overrides" ADD CONSTRAINT "organization_member_permission_overrides_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_member_permission_overrides" ADD CONSTRAINT "member_overrides_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "public"."organization_members"("organization_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_role_permissions" ADD CONSTRAINT "organization_role_permissions_role_id_organization_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."organization_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_role_permissions" ADD CONSTRAINT "organization_role_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_role_permissions" ADD CONSTRAINT "organization_role_permissions_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_roles" ADD CONSTRAINT "organization_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_audit_org_idx" ON "organization_audit_events" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "org_audit_actor_idx" ON "organization_audit_events" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "member_overrides_permission_idx" ON "organization_member_permission_overrides" USING btree ("permission_key");--> statement-breakpoint
CREATE INDEX "member_overrides_expiry_idx" ON "organization_member_permission_overrides" USING btree ("expires_at") WHERE expires_at is not null;--> statement-breakpoint
CREATE INDEX "role_permissions_permission_idx" ON "organization_role_permissions" USING btree ("permission_key");--> statement-breakpoint
CREATE UNIQUE INDEX "org_roles_slug_uq" ON "organization_roles" USING btree ("organization_id","slug") WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "org_roles_name_uq" ON "organization_roles" USING btree ("organization_id","name") WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "org_roles_owner_uq" ON "organization_roles" USING btree ("organization_id") WHERE is_owner = true and deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "org_roles_default_uq" ON "organization_roles" USING btree ("organization_id") WHERE is_default = true and deleted_at is null;--> statement-breakpoint
CREATE INDEX "org_roles_org_rank_idx" ON "organization_roles" USING btree ("organization_id","rank");--> statement-breakpoint
CREATE INDEX "permissions_resource_idx" ON "permissions" USING btree ("resource","action");--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_role_id_organization_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."organization_roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_role_id_organization_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."organization_roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_invites_role_idx" ON "organization_invitations" USING btree ("role_id") WHERE accepted_at is null and revoked_at is null;--> statement-breakpoint
CREATE INDEX "org_members_org_role_id_idx" ON "organization_members" USING btree ("organization_id","role_id");--> statement-breakpoint

/* ------------------------------------------------------------------ */
/* Data backfill (hand-written; drizzle does not generate this part). */
/* Keep this in sync with packages/auth/src/permissions.ts.           */
/* ------------------------------------------------------------------ */

INSERT INTO "permissions" ("key", "resource", "action", "description", "is_assignable") VALUES
  ('org.view', 'org', 'view', 'View the organization profile, members and settings.', true),
  ('org.update', 'org', 'update', 'Update organization name, slug, logo and settings.', true),
  ('org.delete', 'org', 'delete', 'Permanently delete the organization and all of its data.', false),
  ('org.transfer_ownership', 'org', 'transfer_ownership', 'Transfer organization ownership to another member.', false),
  ('audit.view', 'audit', 'view', 'Read the organization audit trail.', true),
  ('member.view', 'member', 'view', 'View organization members and their roles.', true),
  ('member.invite', 'member', 'invite', 'Create invitations for new organization members.', true),
  ('member.remove', 'member', 'remove', 'Remove members from the organization.', true),
  ('member.role.assign', 'member', 'assign', 'Change the role assigned to a member.', true),
  ('member.permission.manage', 'member', 'manage_permissions', 'Grant or deny individual permissions for a member.', true),
  ('role.view', 'role', 'view', 'View roles and their permission sets.', true),
  ('role.manage', 'role', 'manage', 'Create, update, delete roles and change role permissions.', true),
  ('invite.view', 'invite', 'view', 'View pending invitations.', true),
  ('invite.resend', 'invite', 'resend', 'Resend an invitation with a freshly rotated token.', true),
  ('invite.revoke', 'invite', 'revoke', 'Revoke a pending invitation.', true),
  ('project.view', 'project', 'view', 'View projects.', true),
  ('project.create', 'project', 'create', 'Create projects.', true),
  ('project.update', 'project', 'update', 'Update projects.', true),
  ('project.delete', 'project', 'delete', 'Delete or archive projects.', true),
  ('channel.view', 'channel', 'view', 'View channels and their messages.', true),
  ('channel.create', 'channel', 'create', 'Create channels.', true),
  ('channel.update', 'channel', 'update', 'Update channel name, topic and membership.', true),
  ('channel.delete', 'channel', 'delete', 'Archive or delete channels.', true),
  ('board.view', 'board', 'view', 'View whiteboards.', true),
  ('board.create', 'board', 'create', 'Create whiteboards.', true),
  ('board.update', 'board', 'update', 'Edit whiteboards and their contents.', true),
  ('board.delete', 'board', 'delete', 'Delete whiteboards.', true),
  ('issue.view', 'issue', 'view', 'View issues.', true),
  ('issue.create', 'issue', 'create', 'Create issues.', true),
  ('issue.update', 'issue', 'update', 'Edit issues, including status and assignee.', true),
  ('issue.delete', 'issue', 'delete', 'Delete issues.', true),
  ('file.upload', 'file', 'upload', 'Upload files and attach them to messages or issues.', true)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

INSERT INTO "organization_roles"
  ("organization_id", "name", "slug", "description", "rank", "is_system", "is_owner", "is_default")
SELECT
  o.id,
  v.name,
  v.slug,
  v.description,
  v.rank,
  v.is_system,
  v.is_owner,
  v.is_default
FROM "organizations" o
CROSS JOIN (VALUES
  ('Owner', 'owner', 'Full control of the organization, including ownership transfer.', 1000, true, true, false),
  ('Admin', 'admin', 'Manages members, roles, invitations and all workspace content.', 900, false, false, false),
  ('Manager', 'manager', 'Manages people and content, but cannot edit the role catalog.', 700, false, false, false),
  ('Developer', 'developer', 'Creates and edits projects, channels, boards and issues.', 500, false, false, false),
  ('Member', 'member', 'Reads workspace content and can create issues and files.', 300, false, false, true),
  ('Guest', 'guest', 'Read-only access to workspace content.', 100, false, false, false)
) AS v(name, slug, description, rank, is_system, is_owner, is_default);--> statement-breakpoint

/* Owner implicitly holds every key, but the rows are materialised so the role
   editor and "who holds this permission?" views have something to show. */
INSERT INTO "organization_role_permissions" ("role_id", "permission_key")
SELECT r.id, p.key
FROM "organization_roles" r
CROSS JOIN "permissions" p
WHERE r.is_owner = true AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO "organization_role_permissions" ("role_id", "permission_key")
SELECT r.id, p.key
FROM "organization_roles" r
CROSS JOIN "permissions" p
WHERE r.slug = 'admin' AND r.deleted_at IS NULL AND p.is_assignable = true
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO "organization_role_permissions" ("role_id", "permission_key")
SELECT r.id, v.permission_key
FROM "organization_roles" r
CROSS JOIN (VALUES
  ('org.view'), ('org.update'), ('audit.view'), ('member.view'), ('member.invite'),
  ('member.remove'), ('member.role.assign'), ('role.view'), ('invite.view'),
  ('invite.resend'), ('invite.revoke'), ('project.view'), ('project.create'),
  ('project.update'), ('project.delete'), ('channel.view'), ('channel.create'),
  ('channel.update'), ('channel.delete'), ('board.view'), ('board.create'),
  ('board.update'), ('board.delete'), ('issue.view'), ('issue.create'),
  ('issue.update'), ('issue.delete'), ('file.upload')
) AS v(permission_key)
WHERE r.slug = 'manager' AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO "organization_role_permissions" ("role_id", "permission_key")
SELECT r.id, v.permission_key
FROM "organization_roles" r
CROSS JOIN (VALUES
  ('org.view'), ('member.view'), ('role.view'), ('audit.view'), ('project.view'),
  ('project.create'), ('project.update'), ('channel.view'), ('channel.create'),
  ('channel.update'), ('board.view'), ('board.create'), ('board.update'),
  ('issue.view'), ('issue.create'), ('issue.update'), ('file.upload')
) AS v(permission_key)
WHERE r.slug = 'developer' AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO "organization_role_permissions" ("role_id", "permission_key")
SELECT r.id, v.permission_key
FROM "organization_roles" r
CROSS JOIN (VALUES
  ('org.view'), ('member.view'), ('role.view'), ('project.view'), ('channel.view'),
  ('board.view'), ('issue.view'), ('issue.create'), ('file.upload')
) AS v(permission_key)
WHERE r.slug = 'member' AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO "organization_role_permissions" ("role_id", "permission_key")
SELECT r.id, v.permission_key
FROM "organization_roles" r
CROSS JOIN (VALUES
  ('org.view'), ('project.view'), ('channel.view'), ('board.view'), ('issue.view')
) AS v(permission_key)
WHERE r.slug = 'guest' AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

UPDATE "organization_members" m
SET "role_id" = r.id
FROM "organization_roles" r
WHERE r.organization_id = m.organization_id
  AND r.slug = m.role::text
  AND r.deleted_at IS NULL;--> statement-breakpoint

UPDATE "organization_invitations" i
SET "role_id" = r.id
FROM "organization_roles" r
WHERE r.organization_id = i.organization_id
  AND r.slug = i.role::text
  AND r.deleted_at IS NULL;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "organization_members" WHERE "role_id" IS NULL) THEN
    RAISE EXCEPTION 'organization_members.role_id backfill left null rows';
  END IF;
  IF EXISTS (SELECT 1 FROM "organization_invitations" WHERE "role_id" IS NULL) THEN
    RAISE EXCEPTION 'organization_invitations.role_id backfill left null rows';
  END IF;
END $$;