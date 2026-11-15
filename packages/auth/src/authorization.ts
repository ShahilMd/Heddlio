import {
  PERMISSION_BY_KEY,
  PERMISSION_KEYS,
  isPermissionKey,
  type PermissionKey,
} from "./permissions.js";

/**
 * Pure authorization policy.
 *
 * The API layer turns these predicates into HTTP errors; keeping the rules here
 * means they are unit-testable without Nest, Postgres or HTTP, and any future
 * transport (GraphQL, workers, CLI) enforces exactly the same invariants.
 */

export type PermissionEffect = "allow" | "deny";

export interface PermissionOverrideSnapshot {
  permissionKey: string;
  effect: PermissionEffect;
  /** `null`/`undefined` means the override never expires. */
  expiresAt?: Date | string | null;
}

export interface RoleAuthorizationSnapshot {
  id: string;
  rank: number;
  isOwner: boolean;
  permissionKeys: readonly string[];
}

/** The actor as resolved from the database for one request. */
export interface ActorPolicyContext {
  userId: string;
  rank: number;
  isOwner: boolean;
  permissions: ReadonlySet<string>;
}

export interface RolePolicyTarget {
  id: string;
  rank: number;
  isOwner: boolean;
  permissionKeys: readonly string[];
}

export type PolicyErrorCode =
  | "OWNER_ROLE_IMMUTABLE"
  | "OWNER_ROLE_NOT_ASSIGNABLE"
  | "ROLE_RANK_TOO_LOW"
  | "PERMISSION_ESCALATION"
  | "PERMISSION_NOT_ASSIGNABLE"
  | "UNKNOWN_PERMISSION"
  | "SELF_MODIFICATION_NOT_ALLOWED"
  | "MEMBER_IMMUTABLE";

export type PolicyResult =
  | { ok: true }
  | { ok: false; code: PolicyErrorCode; message: string };

export const policyOk: PolicyResult = { ok: true };

const deny = (code: PolicyErrorCode, message: string): PolicyResult => ({
  ok: false,
  code,
  message,
});

/**
 * Effective permission set for a member.
 *
 *   owner role                -> every key, always
 *   role permissions          -> base set
 *   member allow overrides    -> add
 *   member deny overrides     -> remove
 *
 * Deny wins by construction: an allow and a deny for the same key cannot
 * coexist (the override table's primary key is the pair), but applying denies
 * after allows makes the precedence explicit and order-independent.
 * Expired overrides are ignored rather than deleted, so the audit trail and a
 * future "why did this expire?" UI keep their data.
 */
export const resolveEffectivePermissions = (input: {
  role: RoleAuthorizationSnapshot;
  overrides?: readonly PermissionOverrideSnapshot[];
  now?: Date;
}): Set<PermissionKey> => {
  if (input.role.isOwner) {
    return new Set(PERMISSION_KEYS);
  }

  const permissions = new Set<PermissionKey>();
  for (const key of input.role.permissionKeys) {
    if (isPermissionKey(key)) {
      permissions.add(key);
    }
  }

  const now = input.now ?? new Date();
  const active = (input.overrides ?? []).filter((override) => {
    if (!override.expiresAt) return true;
    const expiresAt =
      override.expiresAt instanceof Date
        ? override.expiresAt
        : new Date(override.expiresAt);
    return Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() > now.getTime();
  });

  for (const override of active) {
    if (!isPermissionKey(override.permissionKey)) continue;
    if (override.effect === "allow") {
      permissions.add(override.permissionKey);
    }
  }
  for (const override of active) {
    if (!isPermissionKey(override.permissionKey)) continue;
    if (override.effect === "deny") {
      permissions.delete(override.permissionKey);
    }
  }

  return permissions;
};

/** The owner role is immutable; nobody edits the root of the hierarchy. */
export const checkCanManageRole = (
  actor: ActorPolicyContext,
  target: RolePolicyTarget,
): PolicyResult => {
  if (target.isOwner) {
    return deny(
      "OWNER_ROLE_IMMUTABLE",
      "The owner role is managed through ownership transfer, not role editing.",
    );
  }
  if (actor.isOwner) {
    return policyOk;
  }
  if (actor.rank <= target.rank) {
    return deny(
      "ROLE_RANK_TOO_LOW",
      "You can only manage roles ranked below your own role.",
    );
  }
  return policyOk;
};

/**
 * Creating a role is the same authority check as editing one, but the target
 * has no id yet. The new rank must stay strictly below the actor's so an
 * admin cannot mint a peer or a superior.
 */
export const checkCanCreateRole = (
  actor: ActorPolicyContext,
  target: Pick<RolePolicyTarget, "rank" | "permissionKeys">,
): PolicyResult => {
  if (!actor.isOwner && actor.rank <= target.rank) {
    return deny(
      "ROLE_RANK_TOO_LOW",
      "A new role must be ranked strictly below your own role.",
    );
  }
  return checkCanGrantPermissions(actor, target.permissionKeys);
};

/**
 * Granting a permission requires already holding it (unless owner).
 *
 * This is the anti-escalation rule: without it, anyone with `role.manage` could
 * add `org.transfer_ownership` to a role, assign themselves that role, and take
 * over the workspace. `assignable: false` keys are never grantable at all.
 */
export const checkCanGrantPermissions = (
  actor: ActorPolicyContext,
  permissionKeys: readonly string[],
): PolicyResult => {
  for (const key of permissionKeys) {
    const definition = isPermissionKey(key)
      ? PERMISSION_BY_KEY.get(key)
      : undefined;
    if (!definition) {
      return deny("UNKNOWN_PERMISSION", `Unknown permission: ${key}.`);
    }
    if (!definition.assignable) {
      return deny(
        "PERMISSION_NOT_ASSIGNABLE",
        `Permission ${key} is reserved for the owner role.`,
      );
    }
    if (!actor.isOwner && !actor.permissions.has(key)) {
      return deny(
        "PERMISSION_ESCALATION",
        `You cannot grant ${key} because you do not hold it yourself.`,
      );
    }
  }
  return policyOk;
};

/**
 * Assigning a role to somebody else (member update or invitation).
 *
 * Both conditions matter:
 *   - rank: you cannot hand out a role at or above your own;
 *   - subset: you cannot hand out capabilities you do not have, even if the
 *     role is ranked below you. Otherwise a Manager could assign a low-ranked
 *     "Auditor" role that secretly carries org.delete.
 */
export const checkCanAssignRole = (
  actor: ActorPolicyContext,
  target: RolePolicyTarget,
): PolicyResult => {
  if (target.isOwner) {
    return deny(
      "OWNER_ROLE_NOT_ASSIGNABLE",
      "Ownership is transferred explicitly; the owner role cannot be assigned.",
    );
  }
  if (actor.isOwner) {
    return policyOk;
  }
  if (actor.rank <= target.rank) {
    return deny(
      "ROLE_RANK_TOO_LOW",
      "You can only assign roles ranked below your own role.",
    );
  }
  for (const key of target.permissionKeys) {
    if (!actor.permissions.has(key)) {
      return deny(
        "PERMISSION_ESCALATION",
        `You cannot assign a role containing ${key} because you do not hold it.`,
      );
    }
  }
  return policyOk;
};

/**
 * Managing a member (role change, override change, removal) follows the same
 * rank rule as roles. The owner member cannot be managed by anyone; ownership
 * transfer is its own endpoint.
 */
export const checkCanManageMember = (
  actor: ActorPolicyContext,
  target: { userId: string; role: Pick<RolePolicyTarget, "rank" | "isOwner"> },
): PolicyResult => {
  if (target.userId === actor.userId) {
    return deny(
      "SELF_MODIFICATION_NOT_ALLOWED",
      "You cannot change your own role or permission overrides.",
    );
  }
  if (target.role.isOwner) {
    return deny(
      "MEMBER_IMMUTABLE",
      "The organization owner can only be changed through ownership transfer.",
    );
  }
  if (actor.isOwner) {
    return policyOk;
  }
  if (actor.rank <= target.role.rank) {
    return deny(
      "ROLE_RANK_TOO_LOW",
      "You can only manage members whose role is ranked below your own.",
    );
  }
  return policyOk;
};
