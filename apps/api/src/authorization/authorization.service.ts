import { Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";

import {
  checkCanAssignRole,
  checkCanCreateRole,
  checkCanGrantPermissions,
  checkCanManageMember,
  checkCanManageRole,
  isPermissionKey,
  resolveEffectivePermissions,
  type ActorPolicyContext,
  type PermissionKey,
  type PolicyResult,
  type RolePolicyTarget,
} from "@heddlio/auth";
import {
  organizationMemberPermissionOverrides,
  organizationMembers,
  organizationRolePermissions,
  organizationRoles,
} from "@heddlio/db";

import type { Principal } from "../auth/auth.types.js";
import {
  conflict,
  forbidden,
  notFound,
} from "../common/api-exception.js";
import { DatabaseService } from "../database/database.service.js";
import type {
  MemberStatus,
  OrganizationContext,
  RoleSummary,
} from "./authorization.types.js";
import { PermissionsService } from "./permissions.service.js";

export interface MemberAccess {
  organizationId: string;
  member: {
    userId: string;
    roleId: string;
    status: MemberStatus;
    joinedAt: Date;
  };
  role: RoleSummary;
  permissions: Set<PermissionKey>;
  overrides: {
    permissionKey: string;
    effect: "allow" | "deny";
    expiresAt: Date | null;
    reason: string | null;
    grantedBy: string | null;
  }[];
}

/**
 * The single place where "can this person do this here?" is answered.
 *
 * It combines three sources - membership, role grants, per-member overrides -
 * and turns the pure policy predicates from `@heddlio/auth` into HTTP errors.
 * Keeping it in one service means the guard, member endpoints and invitation
 * endpoints cannot drift into subtly different rules.
 */
@Injectable()
export class AuthorizationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly permissionsService: PermissionsService,
  ) {}

  async getOrganizationContext(
    organizationId: string,
    principal: Principal,
  ): Promise<OrganizationContext> {
    const access = await this.getMemberAccess(organizationId, principal.userId);
    if (!access) {
      throw forbidden(
        "NOT_A_MEMBER",
        "You are not a member of this organization.",
      );
    }
    if (access.member.status !== "active") {
      throw forbidden(
        "MEMBERSHIP_INACTIVE",
        `Your membership is ${access.member.status}; an active membership is required.`,
      );
    }

    return {
      organizationId,
      principal,
      member: access.member,
      role: access.role,
      permissions: access.permissions,
    };
  }

  /**
   * Resolves membership + role + effective permissions in three indexed reads.
   * Non-members and inactive memberships both return `null`; the caller chooses
   * whether that is a 403 (tenant probing) or a 404 (admin looking up a user).
   */
  async getMemberAccess(
    organizationId: string,
    userId: string,
  ): Promise<MemberAccess | null> {
    const [row] = await this.database.db
      .select({
        userId: organizationMembers.userId,
        roleId: organizationMembers.roleId,
        status: organizationMembers.status,
        joinedAt: organizationMembers.joinedAt,
        roleName: organizationRoles.name,
        roleSlug: organizationRoles.slug,
        roleDescription: organizationRoles.description,
        roleRank: organizationRoles.rank,
        roleIsSystem: organizationRoles.isSystem,
        roleIsOwner: organizationRoles.isOwner,
        roleIsDefault: organizationRoles.isDefault,
      })
      .from(organizationMembers)
      .innerJoin(
        organizationRoles,
        and(
          eq(organizationRoles.id, organizationMembers.roleId),
          // Defence in depth: the composite FK already guarantees this, but the
          // join repeats it so a future schema change cannot silently leak a
          // role from another tenant.
          eq(organizationRoles.organizationId, organizationMembers.organizationId),
          isNull(organizationRoles.deletedAt),
        ),
      )
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.userId, userId),
        ),
      )
      .limit(1);

    if (!row) return null;

    const [rolePermissionRows, overrideRows] = await Promise.all([
      this.database.db
        .select({ key: organizationRolePermissions.permissionKey })
        .from(organizationRolePermissions)
        .where(eq(organizationRolePermissions.roleId, row.roleId)),
      this.database.db
        .select({
          permissionKey: organizationMemberPermissionOverrides.permissionKey,
          effect: organizationMemberPermissionOverrides.effect,
          expiresAt: organizationMemberPermissionOverrides.expiresAt,
          reason: organizationMemberPermissionOverrides.reason,
          grantedBy: organizationMemberPermissionOverrides.grantedBy,
        })
        .from(organizationMemberPermissionOverrides)
        .where(
          and(
            eq(
              organizationMemberPermissionOverrides.organizationId,
              organizationId,
            ),
            eq(organizationMemberPermissionOverrides.userId, userId),
          ),
        ),
    ]);

    const role: RoleSummary = {
      id: row.roleId,
      organizationId,
      name: row.roleName,
      slug: row.roleSlug,
      description: row.roleDescription,
      rank: row.roleRank,
      isSystem: row.roleIsSystem,
      isOwner: row.roleIsOwner,
      isDefault: row.roleIsDefault,
      permissionKeys: rolePermissionRows
        .map((permission) => permission.key)
        .filter(isPermissionKey),
    };

    const permissions = resolveEffectivePermissions({
      role: {
        id: role.id,
        rank: role.rank,
        isOwner: role.isOwner,
        permissionKeys: role.permissionKeys,
      },
      overrides: overrideRows,
    });

    return {
      organizationId,
      member: {
        userId: row.userId,
        roleId: row.roleId,
        status: row.status,
        joinedAt: row.joinedAt,
      },
      role,
      permissions,
      overrides: overrideRows,
    };
  }

  async getRoleWithPermissions(
    organizationId: string,
    roleId: string,
  ): Promise<RoleSummary> {
    const [role] = await this.database.db
      .select({
        id: organizationRoles.id,
        organizationId: organizationRoles.organizationId,
        name: organizationRoles.name,
        slug: organizationRoles.slug,
        description: organizationRoles.description,
        rank: organizationRoles.rank,
        isSystem: organizationRoles.isSystem,
        isOwner: organizationRoles.isOwner,
        isDefault: organizationRoles.isDefault,
      })
      .from(organizationRoles)
      .where(
        and(
          eq(organizationRoles.organizationId, organizationId),
          eq(organizationRoles.id, roleId),
          isNull(organizationRoles.deletedAt),
        ),
      )
      .limit(1);

    if (!role) {
      throw notFound("ROLE_NOT_FOUND", "Role not found in this organization.");
    }

    const permissionRows = await this.database.db
      .select({ key: organizationRolePermissions.permissionKey })
      .from(organizationRolePermissions)
      .where(eq(organizationRolePermissions.roleId, roleId));

    return {
      ...role,
      permissionKeys: permissionRows
        .map((permission) => permission.key)
        .filter(isPermissionKey),
    };
  }

  actorFromContext(context: OrganizationContext): ActorPolicyContext {
    return {
      userId: context.principal.userId,
      rank: context.role.rank,
      isOwner: context.role.isOwner,
      permissions: context.permissions,
    };
  }

  rolePolicyTarget(role: RoleSummary): RolePolicyTarget {
    return {
      id: role.id,
      rank: role.rank,
      isOwner: role.isOwner,
      permissionKeys: role.permissionKeys,
    };
  }

  async assertCanCreateRole(
    context: OrganizationContext,
    input: { rank: number; permissionKeys: readonly string[] },
  ): Promise<void> {
    await this.permissionsService.assertAssignablePermissionKeys(
      input.permissionKeys,
    );
    this.assertPolicy(
      checkCanCreateRole(this.actorFromContext(context), input),
    );
  }

  async assertCanManageRole(
    context: OrganizationContext,
    role: RoleSummary,
  ): Promise<void> {
    this.assertPolicy(
      checkCanManageRole(
        this.actorFromContext(context),
        this.rolePolicyTarget(role),
      ),
    );
  }

  async assertCanAssignRole(
    context: OrganizationContext,
    role: RoleSummary,
  ): Promise<void> {
    this.assertPolicy(
      checkCanAssignRole(
        this.actorFromContext(context),
        this.rolePolicyTarget(role),
      ),
    );
  }

  async assertCanGrantPermissions(
    context: OrganizationContext,
    permissionKeys: readonly string[],
  ): Promise<void> {
    await this.permissionsService.assertAssignablePermissionKeys(permissionKeys);
    this.assertPolicy(
      checkCanGrantPermissions(this.actorFromContext(context), permissionKeys),
    );
  }

  async assertCanManageMember(
    context: OrganizationContext,
    target: { userId: string; role: RoleSummary },
  ): Promise<void> {
    this.assertPolicy(
      checkCanManageMember(this.actorFromContext(context), {
        userId: target.userId,
        role: { rank: target.role.rank, isOwner: target.role.isOwner },
      }),
    );
  }

  assertPolicy(result: PolicyResult): void {
    if (!result.ok) {
      throw forbidden(result.code, result.message);
    }
  }

  /**
   * Owner is the only role with `org.transfer_ownership`, so this check is
   * intentionally stricter than a permission lookup: it protects the root of
   * the hierarchy even if the permission catalog is misconfigured.
   */
  assertOwner(context: OrganizationContext): void {
    if (!context.role.isOwner) {
      throw forbidden(
        "OWNER_ONLY",
        "This operation is reserved for the organization owner.",
      );
    }
  }

  /**
   * Called before demoting or removing a member. If the target is the last
   * active owner, the organization would be left with nobody able to transfer
   * ownership or manage protected settings - a permanent lockout.
   */
  async assertNotLastOwner(
    organizationId: string,
    targetUserId: string,
  ): Promise<void> {
    const [target] = await this.database.db
      .select({ isOwner: organizationRoles.isOwner })
      .from(organizationMembers)
      .innerJoin(
        organizationRoles,
        and(
          eq(organizationRoles.id, organizationMembers.roleId),
          eq(organizationRoles.organizationId, organizationMembers.organizationId),
        ),
      )
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.userId, targetUserId),
        ),
      )
      .limit(1);

    if (!target?.isOwner) return;

    const [ownerCount] = await this.database.db
      .select({ count: sql<number>`count(*)::int` })
      .from(organizationMembers)
      .innerJoin(
        organizationRoles,
        and(
          eq(organizationRoles.id, organizationMembers.roleId),
          eq(organizationRoles.organizationId, organizationMembers.organizationId),
        ),
      )
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationRoles.isOwner, true),
          eq(organizationMembers.status, "active"),
        ),
      );

    if ((ownerCount?.count ?? 0) <= 1) {
      throw conflict(
        "LAST_OWNER_PROTECTED",
        "The last owner cannot be demoted or removed. Transfer ownership first.",
      );
    }
  }
}
