/**
 * The permission catalog is code-defined on purpose.
 *
 * A permission that no piece of code checks is worse than no permission at all:
 * it looks like access was granted, but nothing enforces it. Keeping the closed
 * vocabulary here means every new permission goes through review, gets a typed
 * key, and can be asserted in a controller with `@RequirePermission(...)`.
 *
 * The same catalog is mirrored into the `permissions` table at boot (and in the
 * migration) so role/permission joins stay referentially sound and the admin UI
 * can render labels. The database is a projection of this file, never the
 * source of truth.
 */

export interface PermissionDefinition {
  /** Stable `<resource>.<action>` key. Persisted, so never rename in place. */
  readonly key: string;
  readonly resource: string;
  readonly action: string;
  readonly description: string;
  /**
   * Permissions that may be attached to a custom role or a per-member override.
   * Destructive ownership operations are deliberately excluded: they are only
   * reachable through the implicit owner role.
   */
  readonly assignable: boolean;
}

export const PERMISSIONS = [
  /* ------------------------------ organization ----------------------------- */
  {
    key: "org.view",
    resource: "org",
    action: "view",
    description: "View the organization profile, members and settings.",
    assignable: true,
  },
  {
    key: "org.update",
    resource: "org",
    action: "update",
    description: "Update organization name, slug, logo and settings.",
    assignable: true,
  },
  {
    key: "org.delete",
    resource: "org",
    action: "delete",
    description: "Permanently delete the organization and all of its data.",
    assignable: false,
  },
  {
    key: "org.transfer_ownership",
    resource: "org",
    action: "transfer_ownership",
    description: "Transfer organization ownership to another member.",
    assignable: false,
  },
  {
    key: "audit.view",
    resource: "audit",
    action: "view",
    description: "Read the organization audit trail.",
    assignable: true,
  },

  /* --------------------------------- members -------------------------------- */
  {
    key: "member.view",
    resource: "member",
    action: "view",
    description: "View organization members and their roles.",
    assignable: true,
  },
  {
    key: "member.invite",
    resource: "member",
    action: "invite",
    description: "Create invitations for new organization members.",
    assignable: true,
  },
  {
    key: "member.remove",
    resource: "member",
    action: "remove",
    description: "Remove members from the organization.",
    assignable: true,
  },
  {
    key: "member.role.assign",
    resource: "member",
    action: "assign",
    description: "Change the role assigned to a member.",
    assignable: true,
  },
  {
    key: "member.permission.manage",
    resource: "member",
    action: "manage_permissions",
    description: "Grant or deny individual permissions for a member.",
    assignable: true,
  },

  /* ---------------------------------- roles --------------------------------- */
  {
    key: "role.view",
    resource: "role",
    action: "view",
    description: "View roles and their permission sets.",
    assignable: true,
  },
  {
    key: "role.manage",
    resource: "role",
    action: "manage",
    description: "Create, update, delete roles and change role permissions.",
    assignable: true,
  },

  /* --------------------------------- invites -------------------------------- */
  {
    key: "invite.view",
    resource: "invite",
    action: "view",
    description: "View pending invitations.",
    assignable: true,
  },
  {
    key: "invite.resend",
    resource: "invite",
    action: "resend",
    description: "Resend an invitation with a freshly rotated token.",
    assignable: true,
  },
  {
    key: "invite.revoke",
    resource: "invite",
    action: "revoke",
    description: "Revoke a pending invitation.",
    assignable: true,
  },

  /* --------------------------------- projects -------------------------------- */
  {
    key: "project.view",
    resource: "project",
    action: "view",
    description: "View projects.",
    assignable: true,
  },
  {
    key: "project.create",
    resource: "project",
    action: "create",
    description: "Create projects.",
    assignable: true,
  },
  {
    key: "project.update",
    resource: "project",
    action: "update",
    description: "Update projects.",
    assignable: true,
  },
  {
    key: "project.delete",
    resource: "project",
    action: "delete",
    description: "Delete or archive projects.",
    assignable: true,
  },

  /* --------------------------------- channels -------------------------------- */
  {
    key: "channel.view",
    resource: "channel",
    action: "view",
    description: "View channels and their messages.",
    assignable: true,
  },
  {
    key: "channel.create",
    resource: "channel",
    action: "create",
    description: "Create channels.",
    assignable: true,
  },
  {
    key: "channel.update",
    resource: "channel",
    action: "update",
    description: "Update channel name, topic and membership.",
    assignable: true,
  },
  {
    key: "channel.delete",
    resource: "channel",
    action: "delete",
    description: "Archive or delete channels.",
    assignable: true,
  },

  /* ---------------------------------- boards --------------------------------- */
  {
    key: "board.view",
    resource: "board",
    action: "view",
    description: "View whiteboards.",
    assignable: true,
  },
  {
    key: "board.create",
    resource: "board",
    action: "create",
    description: "Create whiteboards.",
    assignable: true,
  },
  {
    key: "board.update",
    resource: "board",
    action: "update",
    description: "Edit whiteboards and their contents.",
    assignable: true,
  },
  {
    key: "board.delete",
    resource: "board",
    action: "delete",
    description: "Delete whiteboards.",
    assignable: true,
  },

  /* ---------------------------------- issues --------------------------------- */
  {
    key: "issue.view",
    resource: "issue",
    action: "view",
    description: "View issues.",
    assignable: true,
  },
  {
    key: "issue.create",
    resource: "issue",
    action: "create",
    description: "Create issues.",
    assignable: true,
  },
  {
    key: "issue.update",
    resource: "issue",
    action: "update",
    description: "Edit issues, including status and assignee.",
    assignable: true,
  },
  {
    key: "issue.delete",
    resource: "issue",
    action: "delete",
    description: "Delete issues.",
    assignable: true,
  },

  /* ---------------------------------- files ---------------------------------- */
  {
    key: "file.upload",
    resource: "file",
    action: "upload",
    description: "Upload files and attach them to messages or issues.",
    assignable: true,
  },
] as const satisfies readonly PermissionDefinition[];

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSIONS.map(
  (permission) => permission.key,
);

const permissionKeySet: ReadonlySet<string> = new Set(PERMISSION_KEYS);

export const isPermissionKey = (value: string): value is PermissionKey =>
  permissionKeySet.has(value);

export const PERMISSION_BY_KEY: ReadonlyMap<PermissionKey, PermissionDefinition> =
  new Map(PERMISSIONS.map((permission) => [permission.key, permission]));

export interface RoleTemplate {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  /**
   * Higher rank == more authority. A member can only manage roles whose rank is
   * strictly below their own, which makes every escalation check a comparison
   * instead of a graph walk.
   */
  readonly rank: number;
  /** The owner role cannot be edited or deleted. */
  readonly isSystem: boolean;
  /** Exactly one owner role per organization; it implicitly holds every key. */
  readonly isOwner: boolean;
  /** Role assigned to new members when no role is specified. */
  readonly isDefault: boolean;
  /** `"all"` means the implicit owner set, including non-assignable keys. */
  readonly permissions: readonly PermissionKey[] | "all";
}

const developerPermissions = [
  "org.view",
  "member.view",
  "role.view",
  "audit.view",
  "project.view",
  "project.create",
  "project.update",
  "channel.view",
  "channel.create",
  "channel.update",
  "board.view",
  "board.create",
  "board.update",
  "issue.view",
  "issue.create",
  "issue.update",
  "file.upload",
] as const satisfies readonly PermissionKey[];

const managerPermissions = [
  "org.view",
  "org.update",
  "audit.view",
  "member.view",
  "member.invite",
  "member.remove",
  "member.role.assign",
  "role.view",
  "invite.view",
  "invite.resend",
  "invite.revoke",
  "project.view",
  "project.create",
  "project.update",
  "project.delete",
  "channel.view",
  "channel.create",
  "channel.update",
  "channel.delete",
  "board.view",
  "board.create",
  "board.update",
  "board.delete",
  "issue.view",
  "issue.create",
  "issue.update",
  "issue.delete",
  "file.upload",
] as const satisfies readonly PermissionKey[];

const adminPermissions = [
  ...PERMISSION_KEYS.filter(
    (key) => key !== "org.delete" && key !== "org.transfer_ownership",
  ),
] as readonly PermissionKey[];

/**
 * Default roles created for every organization.
 *
 * They are ordinary rows, not a hard-coded enum: an org can rename or re-scope
 * Manager/Developer/etc. Only `owner` is protected, because its rank is what
 * every escalation check ultimately compares against.
 */
export const SYSTEM_ROLE_TEMPLATES = [
  {
    slug: "owner",
    name: "Owner",
    description:
      "Full control of the organization, including ownership transfer.",
    rank: 1000,
    isSystem: true,
    isOwner: true,
    isDefault: false,
    permissions: "all",
  },
  {
    slug: "admin",
    name: "Admin",
    description:
      "Manages members, roles, invitations and all workspace content.",
    rank: 900,
    isSystem: false,
    isOwner: false,
    isDefault: false,
    permissions: adminPermissions,
  },
  {
    slug: "manager",
    name: "Manager",
    description:
      "Manages people and content, but cannot edit the role catalog.",
    rank: 700,
    isSystem: false,
    isOwner: false,
    isDefault: false,
    permissions: managerPermissions,
  },
  {
    slug: "developer",
    name: "Developer",
    description:
      "Creates and edits projects, channels, boards and issues.",
    rank: 500,
    isSystem: false,
    isOwner: false,
    isDefault: false,
    permissions: developerPermissions,
  },
  {
    slug: "member",
    name: "Member",
    description: "Reads workspace content and can create issues and files.",
    rank: 300,
    isSystem: false,
    isOwner: false,
    isDefault: true,
    permissions: [
      "org.view",
      "member.view",
      "role.view",
      "project.view",
      "channel.view",
      "board.view",
      "issue.view",
      "issue.create",
      "file.upload",
    ],
  },
  {
    slug: "guest",
    name: "Guest",
    description: "Read-only access to workspace content.",
    rank: 100,
    isSystem: false,
    isOwner: false,
    isDefault: false,
    permissions: ["org.view", "project.view", "channel.view", "board.view", "issue.view"],
  },
] as const satisfies readonly RoleTemplate[];

export type SystemRoleSlug = (typeof SYSTEM_ROLE_TEMPLATES)[number]["slug"];

export const DEFAULT_ROLE_SLUG: SystemRoleSlug = "member";
export const OWNER_ROLE_SLUG: SystemRoleSlug = "owner";

/** Every permission a template should be materialised with in the database. */
export const permissionKeysForTemplate = (
  template: RoleTemplate,
): readonly PermissionKey[] =>
  template.permissions === "all" ? PERMISSION_KEYS : template.permissions;
