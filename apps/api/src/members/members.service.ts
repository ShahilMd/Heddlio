import { Injectable } from "@nestjs/common";
import { and, asc, eq, sql } from "drizzle-orm";

import type { PermissionKey } from "@heddlio/auth";
import {
  organizationMemberPermissionOverrides,
  organizationMembers,
  organizationRoles,
  users,
} from "@heddlio/db";

import {
  badRequest,
  conflict,
  forbidden,
  notFound,
} from "../common/api-exception.js";
import {
  decodeCursor,
  encodeCursor,
  readStringCursorField,
  type CursorPage,
} from "../common/cursor.js";
import { AuditService } from "../authorization/audit.service.js";
import {
  AuthorizationService,
  type MemberAccess,
} from "../authorization/authorization.service.js";
import type { OrganizationContext } from "../authorization/authorization.types.js";
import { DatabaseService } from "../database/database.service.js";
import type {
  MemberListQueryInput,
  ReplaceMemberOverridesInput,
  UpdateMemberRoleInput,
} from "./members.dto.js";

export interface MemberView {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  status: "invited" | "active" | "suspended" | "removed";
  joinedAt: Date;
  role: {
    id: string;
    name: string;
    slug: string;
    rank: number;
    isOwner: boolean;
    isDefault: boolean;
  };
}

export interface MemberPermissionsView {
  userId: string;
  role: MemberAccess["role"];
  permissions: PermissionKey[];
  overrides: {
    permissionKey: string;
    effect: "allow" | "deny";
    expiresAt: Date | null;
    reason: string | null;
    grantedBy: string | null;
  }[];
}

@Injectable()
export class MembersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  async list(
    organizationId: string,
    query: MemberListQueryInput,
  ): Promise<CursorPage<MemberView>> {
    const cursor = decodeCursor(query.cursor);
    const cursorJoinedAt = readStringCursorField(cursor, "joinedAt");
    const cursorUserId = readStringCursorField(cursor, "userId");

    let cursorCondition;
    if (cursorJoinedAt && cursorUserId) {
      const cursorDate = new Date(cursorJoinedAt);
      if (Number.isNaN(cursorDate.getTime())) {
        throw badRequest("INVALID_CURSOR", "The pagination cursor is invalid.");
      }
      // Compare at millisecond precision because a JSON cursor cannot carry
      // Postgres' microseconds; user_id is the deterministic tie-breaker inside
      // one millisecond, so the page boundary is stable and duplicate-free.
      cursorCondition = sql`(date_trunc('milliseconds', ${organizationMembers.joinedAt}), ${organizationMembers.userId}) > (${cursorDate}, ${cursorUserId}::uuid)`;
    }

    const rows = await this.database.db
      .select({
        userId: organizationMembers.userId,
        status: organizationMembers.status,
        joinedAt: organizationMembers.joinedAt,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
        roleId: organizationRoles.id,
        roleName: organizationRoles.name,
        roleSlug: organizationRoles.slug,
        roleRank: organizationRoles.rank,
        roleIsOwner: organizationRoles.isOwner,
        roleIsDefault: organizationRoles.isDefault,
      })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
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
          query.status ? eq(organizationMembers.status, query.status) : undefined,
          cursorCondition,
        ),
      )
      .orderBy(
        asc(sql`date_trunc('milliseconds', ${organizationMembers.joinedAt})`),
        asc(organizationMembers.userId),
      )
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const last = items.at(-1);

    return {
      items: items.map((row) => this.toMemberView(row)),
      nextCursor:
        hasMore && last
          ? encodeCursor({
              joinedAt: last.joinedAt.toISOString(),
              userId: last.userId,
            })
          : null,
    };
  }

  async getMember(
    organizationId: string,
    userId: string,
  ): Promise<MemberView> {
    const [row] = await this.database.db
      .select({
        userId: organizationMembers.userId,
        status: organizationMembers.status,
        joinedAt: organizationMembers.joinedAt,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
        roleId: organizationRoles.id,
        roleName: organizationRoles.name,
        roleSlug: organizationRoles.slug,
        roleRank: organizationRoles.rank,
        roleIsOwner: organizationRoles.isOwner,
        roleIsDefault: organizationRoles.isDefault,
      })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
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
          eq(organizationMembers.userId, userId),
        ),
      )
      .limit(1);

    if (!row) {
      throw notFound("MEMBER_NOT_FOUND", "Member not found in this organization.");
    }
    return this.toMemberView(row);
  }

  async updateRole(
    context: OrganizationContext,
    targetUserId: string,
    input: UpdateMemberRoleInput,
  ): Promise<MemberView> {
    const target = await this.requireMemberAccess(context.organizationId, targetUserId);
    await this.authorization.assertCanManageMember(context, {
      userId: targetUserId,
      role: target.role,
    });
    await this.authorization.assertNotLastOwner(
      context.organizationId,
      targetUserId,
    );

    const nextRole = await this.authorization.getRoleWithPermissions(
      context.organizationId,
      input.roleId,
    );
    await this.authorization.assertCanAssignRole(context, nextRole);

    if (target.role.id === nextRole.id) {
      return this.getMember(context.organizationId, targetUserId);
    }

    await this.database.db.transaction(async (tx) => {
      await tx
        .update(organizationMembers)
        .set({ roleId: nextRole.id })
        .where(
          and(
            eq(organizationMembers.organizationId, context.organizationId),
            eq(organizationMembers.userId, targetUserId),
          ),
        );

      await this.audit.record(tx, {
        organizationId: context.organizationId,
        actorId: context.principal.userId,
        action: "member.role.updated",
        targetType: "member",
        targetId: targetUserId,
        changes: {
          fromRoleId: target.role.id,
          fromRoleSlug: target.role.slug,
          toRoleId: nextRole.id,
          toRoleSlug: nextRole.slug,
        },
      });
    });

    return this.getMember(context.organizationId, targetUserId);
  }

  async remove(
    context: OrganizationContext,
    targetUserId: string,
  ): Promise<void> {
    if (targetUserId === context.principal.userId) {
      throw conflict(
        "SELF_REMOVAL_NOT_ALLOWED",
        "You cannot remove yourself. Another administrator must do it.",
      );
    }

    const target = await this.requireMemberAccess(context.organizationId, targetUserId);
    await this.authorization.assertCanManageMember(context, {
      userId: targetUserId,
      role: target.role,
    });
    await this.authorization.assertNotLastOwner(
      context.organizationId,
      targetUserId,
    );

    if (target.member.status === "removed") {
      throw conflict("MEMBER_ALREADY_REMOVED", "This member is already removed.");
    }

    await this.database.db.transaction(async (tx) => {
      await tx
        .update(organizationMembers)
        .set({ status: "removed" })
        .where(
          and(
            eq(organizationMembers.organizationId, context.organizationId),
            eq(organizationMembers.userId, targetUserId),
          ),
        );

      // Overrides are personal grants. Keeping them on a removed membership
      // would silently reactivate them if the person is invited back.
      await tx
        .delete(organizationMemberPermissionOverrides)
        .where(
          and(
            eq(
              organizationMemberPermissionOverrides.organizationId,
              context.organizationId,
            ),
            eq(organizationMemberPermissionOverrides.userId, targetUserId),
          ),
        );

      await this.audit.record(tx, {
        organizationId: context.organizationId,
        actorId: context.principal.userId,
        action: "member.removed",
        targetType: "member",
        targetId: targetUserId,
        changes: {
          roleId: target.role.id,
          roleSlug: target.role.slug,
          previousStatus: target.member.status,
        },
      });
    });
  }

  async getPermissions(
    context: OrganizationContext,
    targetUserId: string,
  ): Promise<MemberPermissionsView> {
    if (
      targetUserId !== context.principal.userId &&
      !context.permissions.has("member.view")
    ) {
      throw forbidden(
        "MISSING_PERMISSION",
        "You need member.view to inspect another member's permissions.",
      );
    }

    const access = await this.requireMemberAccess(
      context.organizationId,
      targetUserId,
    );
    return this.toPermissionsView(access);
  }

  async replaceOverrides(
    context: OrganizationContext,
    targetUserId: string,
    input: ReplaceMemberOverridesInput,
  ): Promise<MemberPermissionsView> {
    if (targetUserId === context.principal.userId) {
      throw forbidden(
        "SELF_MODIFICATION_NOT_ALLOWED",
        "You cannot grant yourself permission overrides.",
      );
    }

    const target = await this.requireMemberAccess(context.organizationId, targetUserId);
    await this.authorization.assertCanManageMember(context, {
      userId: targetUserId,
      role: target.role,
    });

    if (target.role.isOwner) {
      throw forbidden(
        "MEMBER_IMMUTABLE",
        "The owner already holds every permission; overrides do not apply.",
      );
    }

    const permissionKeys = input.overrides.map((override) => override.permissionKey);
    await this.authorization.assertCanGrantPermissions(context, permissionKeys);

    const now = Date.now();
    const rows = input.overrides.map((override) => {
      const expiresAt = override.expiresAt ? new Date(override.expiresAt) : null;
      if (expiresAt && expiresAt.getTime() <= now) {
        throw badRequest(
          "INVALID_OVERRIDE_EXPIRY",
          `Override for ${override.permissionKey} expires in the past.`,
        );
      }
      return {
        organizationId: context.organizationId,
        userId: targetUserId,
        permissionKey: override.permissionKey,
        effect: override.effect,
        reason: override.reason ?? null,
        expiresAt,
        grantedBy: context.principal.userId,
      };
    });

    await this.database.db.transaction(async (tx) => {
      await tx
        .delete(organizationMemberPermissionOverrides)
        .where(
          and(
            eq(
              organizationMemberPermissionOverrides.organizationId,
              context.organizationId,
            ),
            eq(organizationMemberPermissionOverrides.userId, targetUserId),
          ),
        );

      if (rows.length > 0) {
        await tx.insert(organizationMemberPermissionOverrides).values(rows);
      }

      await this.audit.record(tx, {
        organizationId: context.organizationId,
        actorId: context.principal.userId,
        action: "member.overrides.replaced",
        targetType: "member",
        targetId: targetUserId,
        changes: {
          previous: target.overrides.map((override) => ({
            permissionKey: override.permissionKey,
            effect: override.effect,
            expiresAt: override.expiresAt?.toISOString() ?? null,
          })),
          next: input.overrides,
        },
      });
    });

    return this.getPermissions(context, targetUserId);
  }

  private async requireMemberAccess(
    organizationId: string,
    userId: string,
  ): Promise<MemberAccess> {
    const access = await this.authorization.getMemberAccess(organizationId, userId);
    if (!access) {
      throw notFound("MEMBER_NOT_FOUND", "Member not found in this organization.");
    }
    return access;
  }

  private toPermissionsView(access: MemberAccess): MemberPermissionsView {
    return {
      userId: access.member.userId,
      role: access.role,
      permissions: [...access.permissions].sort() as PermissionKey[],
      overrides: access.overrides.map((override) => ({
        permissionKey: override.permissionKey,
        effect: override.effect,
        expiresAt: override.expiresAt,
        reason: override.reason,
        grantedBy: override.grantedBy,
      })),
    };
  }

  private toMemberView(row: {
    userId: string;
    status: "invited" | "active" | "suspended" | "removed";
    joinedAt: Date;
    name: string;
    email: string;
    avatarUrl: string | null;
    roleId: string;
    roleName: string;
    roleSlug: string;
    roleRank: number;
    roleIsOwner: boolean;
    roleIsDefault: boolean;
  }): MemberView {
    return {
      userId: row.userId,
      name: row.name,
      email: row.email,
      avatarUrl: row.avatarUrl,
      status: row.status,
      joinedAt: row.joinedAt,
      role: {
        id: row.roleId,
        name: row.roleName,
        slug: row.roleSlug,
        rank: row.roleRank,
        isOwner: row.roleIsOwner,
        isDefault: row.roleIsDefault,
      },
    };
  }
}
