import { Injectable } from "@nestjs/common";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  sql,
} from "drizzle-orm";

import {
  isPermissionKey,
  permissionKeysForTemplate,
  SYSTEM_ROLE_TEMPLATES,
  type PermissionKey,
} from "@heddlio/auth";
import {
  organizationInvitations,
  organizationMembers,
  organizationRolePermissions,
  organizationRoles,
} from "@heddlio/db";

import { conflict, forbidden } from "../common/api-exception.js";
import { isPgUniqueViolation } from "../common/pg-error.js";
import { slugify, withNumericSuffix } from "../common/slug.js";
import { AuditService, type DbExecutor } from "../authorization/audit.service.js";
import { AuthorizationService } from "../authorization/authorization.service.js";
import type { OrganizationContext, RoleSummary } from "../authorization/authorization.types.js";
import { DatabaseService } from "../database/database.service.js";
import type {
  CreateRoleInput,
  ReplaceRolePermissionsInput,
  UpdateRoleInput,
} from "./roles.dto.js";

export interface RoleView {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  rank: number;
  isSystem: boolean;
  isOwner: boolean;
  isDefault: boolean;
  permissionKeys: PermissionKey[];
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class RolesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string): Promise<RoleView[]> {
    const roles = await this.database.db
      .select()
      .from(organizationRoles)
      .where(
        and(
          eq(organizationRoles.organizationId, organizationId),
          isNull(organizationRoles.deletedAt),
        ),
      )
      .orderBy(desc(organizationRoles.rank), asc(organizationRoles.name));

    if (roles.length === 0) return [];

    const grants = await this.database.db
      .select({
        roleId: organizationRolePermissions.roleId,
        permissionKey: organizationRolePermissions.permissionKey,
      })
      .from(organizationRolePermissions)
      .where(
        inArray(
          organizationRolePermissions.roleId,
          roles.map((role) => role.id),
        ),
      );

    const byRole = new Map<string, PermissionKey[]>();
    for (const grant of grants) {
      if (!isPermissionKey(grant.permissionKey)) continue;
      const keys = byRole.get(grant.roleId) ?? [];
      keys.push(grant.permissionKey);
      byRole.set(grant.roleId, keys);
    }

    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      slug: role.slug,
      description: role.description,
      rank: role.rank,
      isSystem: role.isSystem,
      isOwner: role.isOwner,
      isDefault: role.isDefault,
      permissionKeys: (byRole.get(role.id) ?? []).sort(),
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    }));
  }

  async get(organizationId: string, roleId: string): Promise<RoleSummary> {
    return this.authorization.getRoleWithPermissions(organizationId, roleId);
  }

  async create(
    context: OrganizationContext,
    input: CreateRoleInput,
  ): Promise<RoleSummary> {
    await this.authorization.assertCanCreateRole(context, {
      rank: input.rank,
      permissionKeys: input.permissions,
    });

    const slug = await this.uniqueSlug(context.organizationId, input.name);

    try {
      const roleId = await this.database.db.transaction(async (tx) => {
        if (input.isDefault === true) {
          await tx
            .update(organizationRoles)
            .set({ isDefault: false })
            .where(
              and(
                eq(organizationRoles.organizationId, context.organizationId),
                eq(organizationRoles.isDefault, true),
                isNull(organizationRoles.deletedAt),
              ),
            );
        }

        const [role] = await tx
          .insert(organizationRoles)
          .values({
            organizationId: context.organizationId,
            name: input.name,
            slug,
            description: input.description ?? null,
            rank: input.rank,
            isSystem: false,
            isOwner: false,
            isDefault: input.isDefault ?? false,
          })
          .returning();

        if (!role) {
          throw conflict("ROLE_CREATE_FAILED", "Role could not be created.");
        }

        if (input.permissions.length > 0) {
          await tx.insert(organizationRolePermissions).values(
            input.permissions.map((permissionKey) => ({
              roleId: role.id,
              permissionKey,
              grantedBy: context.principal.userId,
            })),
          );
        }

        await this.audit.record(tx, {
          organizationId: context.organizationId,
          actorId: context.principal.userId,
          action: "role.created",
          targetType: "role",
          targetId: role.id,
          changes: {
            name: role.name,
            slug: role.slug,
            rank: role.rank,
            permissions: input.permissions,
            isDefault: role.isDefault,
          },
        });

        return role.id;
      });

      return this.authorization.getRoleWithPermissions(
        context.organizationId,
        roleId,
      );
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        throw conflict(
          "ROLE_ALREADY_EXISTS",
          "A role with this name or slug already exists.",
        );
      }
      throw error;
    }
  }

  async update(
    context: OrganizationContext,
    roleId: string,
    input: UpdateRoleInput,
  ): Promise<RoleSummary> {
    const role = await this.authorization.getRoleWithPermissions(
      context.organizationId,
      roleId,
    );
    await this.authorization.assertCanManageRole(context, role);

    if (role.isSystem) {
      throw forbidden(
        "SYSTEM_ROLE_IMMUTABLE",
        "System roles cannot be edited.",
      );
    }

    if (input.rank !== undefined && !context.role.isOwner) {
      if (input.rank >= context.role.rank) {
        throw forbidden(
          "ROLE_RANK_TOO_LOW",
          "A role must stay ranked strictly below your own role.",
        );
      }
    }

    if (input.permissions !== undefined) {
      await this.authorization.assertCanGrantPermissions(
        context,
        input.permissions,
      );
    }

    if (input.isDefault === false && role.isDefault) {
      throw conflict(
        "DEFAULT_ROLE_REQUIRED",
        "Choose another default role before removing the default flag from this one.",
      );
    }

    const nextName = input.name ?? role.name;
    const slug =
      nextName === role.name
        ? role.slug
        : await this.uniqueSlug(context.organizationId, nextName, role.id);

    try {
      await this.database.db.transaction(async (tx) => {
        if (input.isDefault === true) {
          await tx
            .update(organizationRoles)
            .set({ isDefault: false })
            .where(
              and(
                eq(organizationRoles.organizationId, context.organizationId),
                eq(organizationRoles.isDefault, true),
                isNull(organizationRoles.deletedAt),
              ),
            );
        }

        await tx
          .update(organizationRoles)
          .set({
            name: nextName,
            slug,
            ...(input.description !== undefined
              ? { description: input.description }
              : {}),
            ...(input.rank !== undefined ? { rank: input.rank } : {}),
            ...(input.isDefault !== undefined
              ? { isDefault: input.isDefault }
              : {}),
          })
          .where(eq(organizationRoles.id, roleId));

        if (input.permissions !== undefined) {
          await this.replacePermissionsInTransaction(
            tx,
            roleId,
            input.permissions,
            context.principal.userId,
          );
        }

        await this.audit.record(tx, {
          organizationId: context.organizationId,
          actorId: context.principal.userId,
          action: "role.updated",
          targetType: "role",
          targetId: roleId,
          changes: {
            ...input,
            previousName: role.name,
            previousRank: role.rank,
            previousPermissions: input.permissions ? role.permissionKeys : undefined,
          },
        });
      });
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        throw conflict(
          "ROLE_ALREADY_EXISTS",
          "A role with this name or slug already exists.",
        );
      }
      throw error;
    }

    return this.authorization.getRoleWithPermissions(
      context.organizationId,
      roleId,
    );
  }

  async replacePermissions(
    context: OrganizationContext,
    roleId: string,
    input: ReplaceRolePermissionsInput,
  ): Promise<RoleSummary> {
    const role = await this.authorization.getRoleWithPermissions(
      context.organizationId,
      roleId,
    );
    await this.authorization.assertCanManageRole(context, role);

    if (role.isSystem) {
      throw forbidden(
        "SYSTEM_ROLE_IMMUTABLE",
        "System roles cannot be edited.",
      );
    }

    await this.authorization.assertCanGrantPermissions(
      context,
      input.permissions,
    );

    const added = input.permissions.filter(
      (key) => !role.permissionKeys.includes(key as PermissionKey),
    );
    const removed = role.permissionKeys.filter(
      (key) => !input.permissions.includes(key),
    );

    await this.database.db.transaction(async (tx) => {
      await this.replacePermissionsInTransaction(
        tx,
        roleId,
        input.permissions,
        context.principal.userId,
      );

      await this.audit.record(tx, {
        organizationId: context.organizationId,
        actorId: context.principal.userId,
        action: "role.permissions.replaced",
        targetType: "role",
        targetId: roleId,
        changes: { added, removed },
      });
    });

    return this.authorization.getRoleWithPermissions(
      context.organizationId,
      roleId,
    );
  }

  async delete(context: OrganizationContext, roleId: string): Promise<void> {
    const role = await this.authorization.getRoleWithPermissions(
      context.organizationId,
      roleId,
    );
    await this.authorization.assertCanManageRole(context, role);

    if (role.isSystem) {
      throw forbidden(
        "SYSTEM_ROLE_IMMUTABLE",
        "System roles cannot be deleted.",
      );
    }

    if (role.isDefault) {
      throw conflict(
        "DEFAULT_ROLE_REQUIRED",
        "Choose another default role before deleting this one.",
      );
    }

    const [usage] = await this.database.db
      .select({ count: sql<number>`count(*)::int` })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, context.organizationId),
          eq(organizationMembers.roleId, roleId),
          // Removed members keep their historical role_id, but they are no
          // longer assigned to it for authorization purposes and must not block
          // cleanup forever.
          ne(organizationMembers.status, "removed"),
        ),
      );

    if ((usage?.count ?? 0) > 0) {
      throw conflict(
        "ROLE_IN_USE",
        "Reassign every member with this role before deleting it.",
        { memberCount: usage?.count ?? 0 },
      );
    }

    await this.database.db.transaction(async (tx) => {
      // A pending invite carrying a soon-to-be-deleted role would be
      // unaccepted-able, so revoke those invites as part of the same unit of
      // work. Historical (accepted/revoked) invites keep their role reference.
      await tx
        .update(organizationInvitations)
        .set({
          revokedAt: new Date(),
          revokedBy: context.principal.userId,
        })
        .where(
          and(
            eq(organizationInvitations.organizationId, context.organizationId),
            eq(organizationInvitations.roleId, roleId),
            isNull(organizationInvitations.acceptedAt),
            isNull(organizationInvitations.revokedAt),
          ),
        );

      await tx
        .update(organizationRoles)
        .set({ deletedAt: new Date(), isDefault: false })
        .where(eq(organizationRoles.id, roleId));

      await this.audit.record(tx, {
        organizationId: context.organizationId,
        actorId: context.principal.userId,
        action: "role.deleted",
        targetType: "role",
        targetId: roleId,
        changes: {
          name: role.name,
          slug: role.slug,
          permissions: role.permissionKeys,
        },
      });
    });
  }

  /**
   * Creates the six default roles for a new organization. Idempotent, so it is
   * also safe to call as a repair path: existing roles are reused, and missing
   * template grants are filled in.
   *
   * Called inside the organization-creation transaction, never over HTTP.
   */
  async seedDefaultRoles(
    tx: DbExecutor,
    organizationId: string,
  ): Promise<void> {
    for (const template of SYSTEM_ROLE_TEMPLATES) {
      const [inserted] = await tx
        .insert(organizationRoles)
        .values({
          organizationId,
          name: template.name,
          slug: template.slug,
          description: template.description,
          rank: template.rank,
          isSystem: template.isSystem,
          isOwner: template.isOwner,
          isDefault: template.isDefault,
        })
        .onConflictDoNothing()
        .returning({ id: organizationRoles.id });

      let roleId = inserted?.id;
      if (!roleId) {
        const [existing] = await tx
          .select({ id: organizationRoles.id })
          .from(organizationRoles)
          .where(
            and(
              eq(organizationRoles.organizationId, organizationId),
              eq(organizationRoles.slug, template.slug),
              isNull(organizationRoles.deletedAt),
            ),
          )
          .limit(1);
        roleId = existing?.id;
      }
      if (!roleId) {
        throw new Error(
          `Failed to seed role "${template.slug}" for organization ${organizationId}.`,
        );
      }

      const keys = permissionKeysForTemplate(template);
      if (keys.length > 0) {
        await tx
          .insert(organizationRolePermissions)
          .values(
            keys.map((permissionKey) => ({
              roleId,
              permissionKey,
              grantedBy: null,
            })),
          )
          .onConflictDoNothing();
      }
    }
  }

  private async replacePermissionsInTransaction(
    tx: DbExecutor,
    roleId: string,
    permissionKeys: readonly string[],
    grantedBy: string,
  ): Promise<void> {
    await tx
      .delete(organizationRolePermissions)
      .where(eq(organizationRolePermissions.roleId, roleId));

    if (permissionKeys.length > 0) {
      await tx.insert(organizationRolePermissions).values(
        permissionKeys.map((permissionKey) => ({
          roleId,
          permissionKey,
          grantedBy,
        })),
      );
    }
  }

  private async uniqueSlug(
    organizationId: string,
    name: string,
    excludeRoleId?: string,
  ): Promise<string> {
    const base = slugify(name, 64);
    const existing = await this.database.db
      .select({ slug: organizationRoles.slug })
      .from(organizationRoles)
      .where(
        and(
          eq(organizationRoles.organizationId, organizationId),
          isNull(organizationRoles.deletedAt),
          excludeRoleId
            ? ne(organizationRoles.id, excludeRoleId)
            : undefined,
        ),
      );

    const taken = new Set(existing.map((row) => row.slug));
    if (!taken.has(base)) return base;

    let suffix = 2;
    while (taken.has(withNumericSuffix(base, suffix))) suffix += 1;
    return withNumericSuffix(base, suffix);
  }
}
