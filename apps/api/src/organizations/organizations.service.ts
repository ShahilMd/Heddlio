import { Injectable } from "@nestjs/common";
import { and, asc, eq, isNull, like, ne } from "drizzle-orm";

import {
  organizationMembers,
  organizationRoles,
  organizations,
} from "@heddlio/db";

import type { Principal } from "../auth/auth.types.js";
import { conflict, notFound } from "../common/api-exception.js";
import { isPgUniqueViolation } from "../common/pg-error.js";
import { slugify, withNumericSuffix } from "../common/slug.js";
import {
  AuditService,
  type AuditEventView,
} from "../authorization/audit.service.js";
import { AuthorizationService } from "../authorization/authorization.service.js";
import type { OrganizationContext } from "../authorization/authorization.types.js";
import type { CursorPage } from "../common/cursor.js";
import { DatabaseService } from "../database/database.service.js";
import { RolesService } from "../roles/roles.service.js";
import type {
  AuditQueryInput,
  CreateOrganizationInput,
  UpdateOrganizationInput,
} from "./organizations.dto.js";

export interface OrganizationView {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  settings: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationMembershipView {
  organization: OrganizationView;
  role: {
    id: string;
    name: string;
    slug: string;
    rank: number;
    isOwner: boolean;
  };
  joinedAt: Date;
}

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly roles: RolesService,
    private readonly audit: AuditService,
  ) {}

  async create(
    principal: Principal,
    input: CreateOrganizationInput,
  ): Promise<OrganizationView> {
    const slug = await this.resolveSlug(input.name, input.slug);

    try {
      const organizationId = await this.database.db.transaction(async (tx) => {
        const [organization] = await tx
          .insert(organizations)
          .values({
            name: input.name,
            slug,
            settings: input.settings ?? {},
          })
          .returning();

        if (!organization) {
          throw conflict(
            "ORGANIZATION_CREATE_FAILED",
            "Organization could not be created.",
          );
        }

        // Every organization starts with the same role vocabulary. This runs in
        // the creation transaction so an organization can never exist without
        // an owner role to attach its founder to.
        await this.roles.seedDefaultRoles(tx, organization.id);

        const [ownerRole] = await tx
          .select({ id: organizationRoles.id })
          .from(organizationRoles)
          .where(
            and(
              eq(organizationRoles.organizationId, organization.id),
              eq(organizationRoles.slug, "owner"),
              isNull(organizationRoles.deletedAt),
            ),
          )
          .limit(1);

        if (!ownerRole) {
          throw new Error(
            `Owner role missing after seeding organization ${organization.id}.`,
          );
        }

        await tx.insert(organizationMembers).values({
          organizationId: organization.id,
          userId: principal.userId,
          roleId: ownerRole.id,
          status: "active",
          invitedBy: null,
        });

        await this.audit.record(tx, {
          organizationId: organization.id,
          actorId: principal.userId,
          action: "organization.created",
          targetType: "organization",
          targetId: organization.id,
          changes: { name: organization.name, slug: organization.slug },
        });

        return organization.id;
      });

      return this.get(organizationId);
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        throw conflict(
          "ORGANIZATION_SLUG_TAKEN",
          "That organization slug is already in use.",
        );
      }
      throw error;
    }
  }

  async listMine(principal: Principal): Promise<OrganizationMembershipView[]> {
    const rows = await this.database.db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        logoUrl: organizations.logoUrl,
        settings: organizations.settings,
        createdAt: organizations.createdAt,
        updatedAt: organizations.updatedAt,
        joinedAt: organizationMembers.joinedAt,
        roleId: organizationRoles.id,
        roleName: organizationRoles.name,
        roleSlug: organizationRoles.slug,
        roleRank: organizationRoles.rank,
        roleIsOwner: organizationRoles.isOwner,
      })
      .from(organizationMembers)
      .innerJoin(
        organizations,
        eq(organizations.id, organizationMembers.organizationId),
      )
      .innerJoin(
        organizationRoles,
        and(
          eq(organizationRoles.id, organizationMembers.roleId),
          eq(organizationRoles.organizationId, organizationMembers.organizationId),
          isNull(organizationRoles.deletedAt),
        ),
      )
      .where(
        and(
          eq(organizationMembers.userId, principal.userId),
          eq(organizationMembers.status, "active"),
        ),
      )
      .orderBy(asc(organizations.name));

    return rows.map((row) => ({
      organization: {
        id: row.id,
        name: row.name,
        slug: row.slug,
        logoUrl: row.logoUrl,
        settings: row.settings,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
      role: {
        id: row.roleId,
        name: row.roleName,
        slug: row.roleSlug,
        rank: row.roleRank,
        isOwner: row.roleIsOwner,
      },
      joinedAt: row.joinedAt,
    }));
  }

  async get(organizationId: string): Promise<OrganizationView> {
    const [organization] = await this.database.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    if (!organization) {
      throw notFound("ORGANIZATION_NOT_FOUND", "Organization not found.");
    }

    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      logoUrl: organization.logoUrl,
      settings: organization.settings,
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
    };
  }

  async update(
    context: OrganizationContext,
    input: UpdateOrganizationInput,
  ): Promise<OrganizationView> {
    if (input.slug !== undefined) {
      const [existing] = await this.database.db
        .select({ id: organizations.id })
        .from(organizations)
        .where(
          and(
            eq(organizations.slug, input.slug),
            ne(organizations.id, context.organizationId),
          ),
        )
        .limit(1);

      if (existing) {
        throw conflict(
          "ORGANIZATION_SLUG_TAKEN",
          "That organization slug is already in use.",
        );
      }
    }

    try {
      await this.database.db.transaction(async (tx) => {
        await tx
          .update(organizations)
          .set({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.slug !== undefined ? { slug: input.slug } : {}),
            ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
            ...(input.settings !== undefined
              ? { settings: input.settings }
              : {}),
          })
          .where(eq(organizations.id, context.organizationId));

        await this.audit.record(tx, {
          organizationId: context.organizationId,
          actorId: context.principal.userId,
          action: "organization.updated",
          targetType: "organization",
          targetId: context.organizationId,
          changes: input,
        });
      });
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        throw conflict(
          "ORGANIZATION_SLUG_TAKEN",
          "That organization slug is already in use.",
        );
      }
      throw error;
    }

    return this.get(context.organizationId);
  }

  /**
   * Owner hand-off. The outgoing owner inherits the target's previous role,
   * which keeps exactly one owner and leaves both users with a meaningful rank.
   */
  async transferOwnership(
    context: OrganizationContext,
    targetUserId: string,
  ): Promise<void> {
    this.authorization.assertOwner(context);

    if (targetUserId === context.principal.userId) {
      throw conflict(
        "ALREADY_OWNER",
        "You already own this organization.",
      );
    }

    const [target] = await this.database.db
      .select({
        userId: organizationMembers.userId,
        roleId: organizationMembers.roleId,
        status: organizationMembers.status,
        roleIsOwner: organizationRoles.isOwner,
      })
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
          eq(organizationMembers.organizationId, context.organizationId),
          eq(organizationMembers.userId, targetUserId),
        ),
      )
      .limit(1);

    if (!target || target.status !== "active") {
      throw notFound(
        "MEMBER_NOT_FOUND",
        "The target user is not an active member of this organization.",
      );
    }
    if (target.roleIsOwner) {
      throw conflict("ALREADY_OWNER", "The target user already owns this organization.");
    }

    const [ownerRole] = await this.database.db
      .select({ id: organizationRoles.id })
      .from(organizationRoles)
      .where(
        and(
          eq(organizationRoles.organizationId, context.organizationId),
          eq(organizationRoles.isOwner, true),
          isNull(organizationRoles.deletedAt),
        ),
      )
      .limit(1);

    if (!ownerRole) {
      throw new Error(
        `Owner role missing for organization ${context.organizationId}.`,
      );
    }

    await this.database.db.transaction(async (tx) => {
      await tx
        .update(organizationMembers)
        .set({ roleId: ownerRole.id })
        .where(
          and(
            eq(organizationMembers.organizationId, context.organizationId),
            eq(organizationMembers.userId, targetUserId),
          ),
        );

      await tx
        .update(organizationMembers)
        .set({ roleId: target.roleId })
        .where(
          and(
            eq(organizationMembers.organizationId, context.organizationId),
            eq(organizationMembers.userId, context.principal.userId),
          ),
        );

      await this.audit.record(tx, {
        organizationId: context.organizationId,
        actorId: context.principal.userId,
        action: "organization.ownership.transferred",
        targetType: "member",
        targetId: targetUserId,
        changes: {
          previousOwnerId: context.principal.userId,
          newOwnerId: targetUserId,
          previousOwnerRoleId: target.roleId,
        },
      });
    });
  }

  async listAudit(
    organizationId: string,
    query: AuditQueryInput,
  ): Promise<CursorPage<AuditEventView>> {
    return this.audit.list(organizationId, {
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  private async resolveSlug(
    name: string,
    requestedSlug?: string,
  ): Promise<string> {
    if (requestedSlug) return requestedSlug;

    const base = slugify(name, 110);
    const rows = await this.database.db
      .select({ slug: organizations.slug })
      .from(organizations)
      .where(like(organizations.slug, `${base}%`));

    const taken = new Set(rows.map((row) => row.slug));
    if (!taken.has(base)) return base;

    let suffix = 2;
    while (taken.has(withNumericSuffix(base, suffix, 110))) suffix += 1;
    return withNumericSuffix(base, suffix, 110);
  }
}
