import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  generateInviteToken,
  hashInviteToken,
  normalizeEmail,
  type PermissionKey,
} from "@heddlio/auth";
import {
  organizationInvitations,
  organizationMemberPermissionOverrides,
  organizationMembers,
  organizationRoles,
  organizations,
  permissions,
  users,
  type InvitationPermissionOverride,
} from "@heddlio/db";

import type { Principal } from "../auth/auth.types.js";
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
import { isPgUniqueViolation } from "../common/pg-error.js";
import { AuditService, type DbExecutor } from "../authorization/audit.service.js";
import { AuthorizationService } from "../authorization/authorization.service.js";
import type {
  OrganizationContext,
  RoleSummary,
} from "../authorization/authorization.types.js";
import { DatabaseService } from "../database/database.service.js";
import { MailService } from "../mail/mail.service.js";
import type {
  CreateInvitationInput,
  InvitationListQueryInput,
} from "./invitations.dto.js";

const inviterUser = alias(users, "invitation_inviter");

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export interface InvitationView {
  id: string;
  email: string;
  role: { id: string; name: string; slug: string };
  permissionOverrides: InvitationPermissionOverride[];
  message: string | null;
  invitedBy: { id: string; name: string } | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedBy: string | null;
  revokedAt: Date | null;
  revokedBy: string | null;
  sendCount: number;
  lastSentAt: Date;
  createdAt: Date;
  status: InvitationStatus;
}

export interface IssuedInvitation {
  invitation: InvitationView;
  /** Returned exactly once; only the SHA-256 digest is stored. */
  token: string;
  acceptUrl: string;
  emailDelivered: boolean;
}

export interface AcceptedInvitation {
  organization: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
  };
  role: RoleSummary;
  permissions: PermissionKey[];
  overrides: {
    permissionKey: string;
    effect: "allow" | "deny";
    expiresAt: Date | null;
  }[];
  joinedAt: Date;
}

@Injectable()
export class InvitationsService {
  private readonly invitationTtlDays: number;
  private readonly webAppUrl: string;

  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    config: ConfigService,
  ) {
    const ttl = Number(config.get<string>("INVITATION_TTL_DAYS") ?? "7");
    this.invitationTtlDays =
      Number.isFinite(ttl) && ttl >= 1 && ttl <= 30 ? Math.floor(ttl) : 7;
    this.webAppUrl = (
      config.get<string>("WEB_APP_URL") ?? "http://localhost:3000"
    ).replace(/\/+$/, "");
  }

  async create(
    context: OrganizationContext,
    input: CreateInvitationInput,
  ): Promise<IssuedInvitation> {
    const email = normalizeEmail(input.email);

    if (email === normalizeEmail(context.principal.email)) {
      throw conflict(
        "CANNOT_INVITE_SELF",
        "You are already a member of this organization.",
      );
    }

    const role = await this.authorization.getRoleWithPermissions(
      context.organizationId,
      input.roleId,
    );
    await this.authorization.assertCanAssignRole(context, role);

    const requestedOverrides = input.permissionOverrides ?? [];
    await this.authorization.assertCanGrantPermissions(
      context,
      requestedOverrides.map((override) => override.permissionKey),
    );

    const now = new Date();
    const permissionOverrides = this.normalizeOverrides(
      requestedOverrides,
      now,
    );

    const [existingMember] = await this.database.db
      .select({ status: organizationMembers.status })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(
        and(
          eq(organizationMembers.organizationId, context.organizationId),
          sql`lower(${users.email}) = ${email}`,
        ),
      )
      .limit(1);

    if (existingMember?.status === "active") {
      throw conflict(
        "ALREADY_MEMBER",
        "That email already belongs to an active member of this organization.",
      );
    }

    const [pending] = await this.database.db
      .select({
        id: organizationInvitations.id,
        expiresAt: organizationInvitations.expiresAt,
      })
      .from(organizationInvitations)
      .where(
        and(
          eq(organizationInvitations.organizationId, context.organizationId),
          sql`lower(${organizationInvitations.email}) = ${email}`,
          isNull(organizationInvitations.acceptedAt),
          isNull(organizationInvitations.revokedAt),
        ),
      )
      .limit(1);

    if (pending && pending.expiresAt.getTime() > now.getTime()) {
      throw conflict(
        "INVITE_ALREADY_PENDING",
        "A pending invitation already exists for this email. Resend or revoke it instead.",
        { invitationId: pending.id },
      );
    }

    const token = generateInviteToken();
    const tokenHash = hashInviteToken(token);
    const days = input.expiresInDays ?? this.invitationTtlDays;
    const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    try {
      await this.database.db.transaction(async (tx) => {
        // A partial index cannot test `expires_at > now()` (not immutable), so
        // an expired-but-not-revoked row still occupies the one-live-invite
        // slot. Retire it here; the unique index then remains the final guard
        // against concurrent creates.
        await tx
          .update(organizationInvitations)
          .set({
            revokedAt: now,
            revokedBy: context.principal.userId,
          })
          .where(
            and(
              eq(organizationInvitations.organizationId, context.organizationId),
              sql`lower(${organizationInvitations.email}) = ${email}`,
              isNull(organizationInvitations.acceptedAt),
              isNull(organizationInvitations.revokedAt),
            ),
          );

        const [invitation] = await tx
          .insert(organizationInvitations)
          .values({
            organizationId: context.organizationId,
            email,
            roleId: role.id,
            tokenHash,
            invitedBy: context.principal.userId,
            permissionOverrides,
            message: input.message ?? null,
            expiresAt,
            sendCount: 1,
            lastSentAt: now,
          })
          .returning({ id: organizationInvitations.id });

        if (!invitation) {
          throw conflict(
            "INVITE_CREATE_FAILED",
            "The invitation could not be created.",
          );
        }

        await this.audit.record(tx, {
          organizationId: context.organizationId,
          actorId: context.principal.userId,
          action: "invitation.created",
          targetType: "invitation",
          targetId: invitation.id,
          changes: {
            email,
            roleId: role.id,
            roleSlug: role.slug,
            permissionOverrides,
            expiresAt: expiresAt.toISOString(),
          },
        });
      });
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        throw conflict(
          "INVITE_ALREADY_PENDING",
          "A pending invitation already exists for this email.",
        );
      }
      throw error;
    }

    const [invitation] = await this.database.db
      .select({ id: organizationInvitations.id })
      .from(organizationInvitations)
      .where(
        and(
          eq(organizationInvitations.organizationId, context.organizationId),
          eq(organizationInvitations.tokenHash, tokenHash),
        ),
      )
      .limit(1);

    if (!invitation) {
      throw new Error("Invitation disappeared immediately after creation.");
    }

    const view = await this.getInvitationView(
      context.organizationId,
      invitation.id,
    );
    const organization = await this.getOrganizationSummary(
      context.organizationId,
    );
    const acceptUrl = this.acceptUrl(token);

    const emailDelivered = await this.mail.sendInvitation({
      to: email,
      organizationName: organization.name,
      roleName: role.name,
      inviterName: context.principal.name,
      acceptUrl,
      expiresAt,
      message: input.message,
    });

    return { invitation: view, token, acceptUrl, emailDelivered };
  }

  async list(
    organizationId: string,
    query: InvitationListQueryInput,
  ): Promise<CursorPage<InvitationView>> {
    const now = new Date();
    const cursor = decodeCursor(query.cursor);
    const cursorCreatedAt = readStringCursorField(cursor, "createdAt");
    const cursorId = readStringCursorField(cursor, "id");

    let cursorCondition;
    if (cursorCreatedAt && cursorId) {
      const cursorDate = new Date(cursorCreatedAt);
      if (Number.isNaN(cursorDate.getTime())) {
        throw badRequest("INVALID_CURSOR", "The pagination cursor is invalid.");
      }
      cursorCondition = sql`(date_trunc('milliseconds', ${organizationInvitations.createdAt}), ${organizationInvitations.id}) < (${cursorDate}, ${cursorId}::uuid)`;
    }

    const statusCondition = (() => {
      switch (query.status) {
        case "accepted":
          return sql`${organizationInvitations.acceptedAt} is not null`;
        case "revoked":
          return sql`${organizationInvitations.revokedAt} is not null`;
        case "expired":
          return sql`${organizationInvitations.acceptedAt} is null and ${organizationInvitations.revokedAt} is null and ${organizationInvitations.expiresAt} <= ${now}`;
        case "pending":
          return sql`${organizationInvitations.acceptedAt} is null and ${organizationInvitations.revokedAt} is null and ${organizationInvitations.expiresAt} > ${now}`;
        case "all":
          return undefined;
      }
    })();

    const rows = await this.database.db
      .select({
        id: organizationInvitations.id,
        email: organizationInvitations.email,
        permissionOverrides: organizationInvitations.permissionOverrides,
        message: organizationInvitations.message,
        expiresAt: organizationInvitations.expiresAt,
        acceptedAt: organizationInvitations.acceptedAt,
        acceptedBy: organizationInvitations.acceptedBy,
        revokedAt: organizationInvitations.revokedAt,
        revokedBy: organizationInvitations.revokedBy,
        sendCount: organizationInvitations.sendCount,
        lastSentAt: organizationInvitations.lastSentAt,
        createdAt: organizationInvitations.createdAt,
        roleId: organizationRoles.id,
        roleName: organizationRoles.name,
        roleSlug: organizationRoles.slug,
        inviterId: inviterUser.id,
        inviterName: inviterUser.name,
      })
      .from(organizationInvitations)
      .innerJoin(
        organizationRoles,
        eq(organizationRoles.id, organizationInvitations.roleId),
      )
      .leftJoin(inviterUser, eq(inviterUser.id, organizationInvitations.invitedBy))
      .where(
        and(
          eq(organizationInvitations.organizationId, organizationId),
          statusCondition,
          cursorCondition,
        ),
      )
      .orderBy(
        desc(sql`date_trunc('milliseconds', ${organizationInvitations.createdAt})`),
        desc(organizationInvitations.id),
      )
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const last = items.at(-1);

    return {
      items: items.map((row) => this.toInvitationView(row, now)),
      nextCursor:
        hasMore && last
          ? encodeCursor({
              createdAt: last.createdAt.toISOString(),
              id: last.id,
            })
          : null,
    };
  }

  async resend(
    context: OrganizationContext,
    invitationId: string,
  ): Promise<IssuedInvitation> {
    const [invitation] = await this.database.db
      .select()
      .from(organizationInvitations)
      .where(
        and(
          eq(organizationInvitations.organizationId, context.organizationId),
          eq(organizationInvitations.id, invitationId),
        ),
      )
      .limit(1);

    if (!invitation) {
      throw notFound("INVITE_NOT_FOUND", "Invitation not found.");
    }
    if (invitation.acceptedAt) {
      throw conflict(
        "INVITE_ALREADY_ACCEPTED",
        "This invitation has already been accepted.",
      );
    }
    if (invitation.revokedAt) {
      throw conflict(
        "INVITE_REVOKED",
        "This invitation was revoked. Create a new invitation instead.",
      );
    }

    const token = generateInviteToken();
    const tokenHash = hashInviteToken(token);
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.invitationTtlDays * 24 * 60 * 60 * 1000,
    );

    await this.database.db.transaction(async (tx) => {
      await tx
        .update(organizationInvitations)
        .set({
          tokenHash,
          expiresAt,
          sendCount: sql`${organizationInvitations.sendCount} + 1`,
          lastSentAt: now,
        })
        .where(eq(organizationInvitations.id, invitationId));

      await this.audit.record(tx, {
        organizationId: context.organizationId,
        actorId: context.principal.userId,
        action: "invitation.resent",
        targetType: "invitation",
        targetId: invitationId,
        changes: { expiresAt: expiresAt.toISOString() },
      });
    });

    const view = await this.getInvitationView(
      context.organizationId,
      invitationId,
    );
    const organization = await this.getOrganizationSummary(
      context.organizationId,
    );
    const role = await this.authorization.getRoleWithPermissions(
      context.organizationId,
      invitation.roleId,
    );
    const acceptUrl = this.acceptUrl(token);

    const emailDelivered = await this.mail.sendInvitation({
      to: invitation.email,
      organizationName: organization.name,
      roleName: role.name,
      inviterName: context.principal.name,
      acceptUrl,
      expiresAt,
      message: invitation.message,
    });

    return { invitation: view, token, acceptUrl, emailDelivered };
  }

  async revoke(
    context: OrganizationContext,
    invitationId: string,
  ): Promise<void> {
    const [invitation] = await this.database.db
      .select({
        id: organizationInvitations.id,
        acceptedAt: organizationInvitations.acceptedAt,
        revokedAt: organizationInvitations.revokedAt,
      })
      .from(organizationInvitations)
      .where(
        and(
          eq(organizationInvitations.organizationId, context.organizationId),
          eq(organizationInvitations.id, invitationId),
        ),
      )
      .limit(1);

    if (!invitation) {
      throw notFound("INVITE_NOT_FOUND", "Invitation not found.");
    }
    if (invitation.acceptedAt) {
      throw conflict(
        "INVITE_ALREADY_ACCEPTED",
        "An accepted invitation cannot be revoked.",
      );
    }
    if (invitation.revokedAt) return;

    await this.database.db.transaction(async (tx) => {
      await tx
        .update(organizationInvitations)
        .set({
          revokedAt: new Date(),
          revokedBy: context.principal.userId,
        })
        .where(eq(organizationInvitations.id, invitationId));

      await this.audit.record(tx, {
        organizationId: context.organizationId,
        actorId: context.principal.userId,
        action: "invitation.revoked",
        targetType: "invitation",
        targetId: invitationId,
      });
    });
  }

  /**
   * Public preview. Returns only what the invitee needs to decide whether to
   * sign in, and uses one generic 404 for invalid, expired, revoked and
   * accepted tokens so the endpoint cannot be used to probe for live invites.
   */
  async preview(token: string): Promise<{
    organization: { name: string; slug: string; logoUrl: string | null };
    email: string;
    role: { name: string; slug: string };
    inviter: { name: string } | null;
    message: string | null;
    expiresAt: Date;
  }> {
    const tokenHash = hashInviteToken(token);
    const now = new Date();

    const [row] = await this.database.db
      .select({
        email: organizationInvitations.email,
        message: organizationInvitations.message,
        expiresAt: organizationInvitations.expiresAt,
        organizationName: organizations.name,
        organizationSlug: organizations.slug,
        organizationLogoUrl: organizations.logoUrl,
        roleName: organizationRoles.name,
        roleSlug: organizationRoles.slug,
        inviterName: inviterUser.name,
      })
      .from(organizationInvitations)
      .innerJoin(
        organizations,
        eq(organizations.id, organizationInvitations.organizationId),
      )
      .innerJoin(
        organizationRoles,
        eq(organizationRoles.id, organizationInvitations.roleId),
      )
      .leftJoin(inviterUser, eq(inviterUser.id, organizationInvitations.invitedBy))
      .where(
        and(
          eq(organizationInvitations.tokenHash, tokenHash),
          isNull(organizationInvitations.acceptedAt),
          isNull(organizationInvitations.revokedAt),
          gt(organizationInvitations.expiresAt, now),
        ),
      )
      .limit(1);

    if (!row) {
      throw notFound(
        "INVITE_NOT_FOUND",
        "This invitation is invalid, expired or already used.",
      );
    }

    return {
      organization: {
        name: row.organizationName,
        slug: row.organizationSlug,
        logoUrl: row.organizationLogoUrl,
      },
      email: row.email,
      role: { name: row.roleName, slug: row.roleSlug },
      inviter: row.inviterName ? { name: row.inviterName } : null,
      message: row.message,
      expiresAt: row.expiresAt,
    };
  }

  /**
   * Acceptance requires an authenticated principal whose email matches the
   * invitation. Creating the account is the authentication workstream's job;
   * this endpoint deliberately does not accept a password or mint a session.
   */
  async accept(
    principal: Principal,
    token: string,
  ): Promise<AcceptedInvitation> {
    const tokenHash = hashInviteToken(token);
    const now = new Date();

    const organizationId = await this.database.db.transaction(async (tx) => {
      const [invitation] = await tx
        .select()
        .from(organizationInvitations)
        .where(eq(organizationInvitations.tokenHash, tokenHash))
        .limit(1)
        .for("update");

      if (
        !invitation ||
        invitation.acceptedAt ||
        invitation.revokedAt ||
        invitation.expiresAt.getTime() <= now.getTime()
      ) {
        throw notFound(
          "INVITE_NOT_FOUND",
          "This invitation is invalid, expired or already used.",
        );
      }

      if (normalizeEmail(invitation.email) !== normalizeEmail(principal.email)) {
        throw forbidden(
          "INVITE_EMAIL_MISMATCH",
          "This invitation was issued to a different email address.",
        );
      }

      const [role] = await tx
        .select({ id: organizationRoles.id })
        .from(organizationRoles)
        .where(
          and(
            eq(organizationRoles.organizationId, invitation.organizationId),
            eq(organizationRoles.id, invitation.roleId),
            isNull(organizationRoles.deletedAt),
          ),
        )
        .limit(1);

      if (!role) {
        throw conflict(
          "INVITE_ROLE_UNAVAILABLE",
          "The role attached to this invitation is no longer available.",
        );
      }

      const [existingMember] = await tx
        .select({ status: organizationMembers.status })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, invitation.organizationId),
            eq(organizationMembers.userId, principal.userId),
          ),
        )
        .limit(1);

      if (existingMember?.status === "active") {
        throw conflict(
          "ALREADY_MEMBER",
          "You are already an active member of this organization.",
        );
      }

      if (existingMember) {
        await tx
          .update(organizationMembers)
          .set({
            roleId: invitation.roleId,
            status: "active",
            invitedBy: invitation.invitedBy,
            joinedAt: now,
          })
          .where(
            and(
              eq(organizationMembers.organizationId, invitation.organizationId),
              eq(organizationMembers.userId, principal.userId),
            ),
          );
      } else {
        await tx.insert(organizationMembers).values({
          organizationId: invitation.organizationId,
          userId: principal.userId,
          roleId: invitation.roleId,
          status: "active",
          invitedBy: invitation.invitedBy,
          joinedAt: now,
        });
      }

      // Copy the targeted grants, dropping anything that expired while the
      // invite sat in an inbox or that is no longer in the permission catalog.
      const invitationsOverrides = invitation.permissionOverrides ?? [];
      const validOverrideKeys = await this.existingPermissionKeys(
        tx,
        invitationsOverrides.map((override) => override.permissionKey),
      );
      const overrideRows = invitationsOverrides
        .filter(
          (override) =>
            validOverrideKeys.has(override.permissionKey) &&
            (!override.expiresAt ||
              new Date(override.expiresAt).getTime() > now.getTime()),
        )
        .map((override) => ({
          organizationId: invitation.organizationId,
          userId: principal.userId,
          permissionKey: override.permissionKey,
          effect: override.effect,
          reason: null,
          expiresAt: override.expiresAt ? new Date(override.expiresAt) : null,
          grantedBy: invitation.invitedBy,
        }));

      await tx
        .delete(organizationMemberPermissionOverrides)
        .where(
          and(
            eq(
              organizationMemberPermissionOverrides.organizationId,
              invitation.organizationId,
            ),
            eq(organizationMemberPermissionOverrides.userId, principal.userId),
          ),
        );
      if (overrideRows.length > 0) {
        await tx
          .insert(organizationMemberPermissionOverrides)
          .values(overrideRows);
      }

      await tx
        .update(organizationInvitations)
        .set({ acceptedAt: now, acceptedBy: principal.userId })
        .where(eq(organizationInvitations.id, invitation.id));

      await this.audit.record(tx, {
        organizationId: invitation.organizationId,
        actorId: principal.userId,
        action: "invitation.accepted",
        targetType: "invitation",
        targetId: invitation.id,
        changes: {
          roleId: invitation.roleId,
          email: invitation.email,
          permissionOverrides: invitation.permissionOverrides,
        },
      });

      return invitation.organizationId;
    });

    const [access, organization] = await Promise.all([
      this.authorization.getMemberAccess(organizationId, principal.userId),
      this.getOrganizationSummary(organizationId),
    ]);

    if (!access) {
      throw new Error(
        "Membership missing immediately after accepting an invitation.",
      );
    }

    return {
      organization,
      role: access.role,
      permissions: [...access.permissions].sort() as PermissionKey[],
      overrides: access.overrides.map((override) => ({
        permissionKey: override.permissionKey,
        effect: override.effect,
        expiresAt: override.expiresAt,
      })),
      joinedAt: access.member.joinedAt,
    };
  }

  private normalizeOverrides(
    overrides: readonly {
      permissionKey: string;
      effect: "allow" | "deny";
      expiresAt?: string | null;
    }[],
    now: Date,
  ): InvitationPermissionOverride[] {
    return overrides.map((override) => {
      const expiresAt = override.expiresAt ? new Date(override.expiresAt) : null;
      if (expiresAt && expiresAt.getTime() <= now.getTime()) {
        throw badRequest(
          "INVALID_OVERRIDE_EXPIRY",
          `Override for ${override.permissionKey} expires in the past.`,
        );
      }
      return {
        permissionKey: override.permissionKey,
        effect: override.effect,
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
      };
    });
  }

  private async existingPermissionKeys(
    tx: DbExecutor,
    keys: readonly string[],
  ): Promise<Set<string>> {
    if (keys.length === 0) return new Set();
    const rows = await tx
      .select({ key: permissions.key })
      .from(permissions)
      .where(inArray(permissions.key, [...new Set(keys)]));
    return new Set(rows.map((row) => row.key));
  }

  private statusOf(
    invitation: {
      acceptedAt: Date | null;
      revokedAt: Date | null;
      expiresAt: Date;
    },
    now: Date,
  ): InvitationStatus {
    if (invitation.acceptedAt) return "accepted";
    if (invitation.revokedAt) return "revoked";
    if (invitation.expiresAt.getTime() <= now.getTime()) return "expired";
    return "pending";
  }

  private toInvitationView(
    row: {
      id: string;
      email: string;
      permissionOverrides: InvitationPermissionOverride[];
      message: string | null;
      expiresAt: Date;
      acceptedAt: Date | null;
      acceptedBy: string | null;
      revokedAt: Date | null;
      revokedBy: string | null;
      sendCount: number;
      lastSentAt: Date;
      createdAt: Date;
      roleId: string;
      roleName: string;
      roleSlug: string;
      inviterId: string | null;
      inviterName: string | null;
    },
    now: Date,
  ): InvitationView {
    return {
      id: row.id,
      email: row.email,
      role: { id: row.roleId, name: row.roleName, slug: row.roleSlug },
      permissionOverrides: row.permissionOverrides ?? [],
      message: row.message,
      invitedBy:
        row.inviterId && row.inviterName
          ? { id: row.inviterId, name: row.inviterName }
          : null,
      expiresAt: row.expiresAt,
      acceptedAt: row.acceptedAt,
      acceptedBy: row.acceptedBy,
      revokedAt: row.revokedAt,
      revokedBy: row.revokedBy,
      sendCount: row.sendCount,
      lastSentAt: row.lastSentAt,
      createdAt: row.createdAt,
      status: this.statusOf(row, now),
    };
  }

  private async getInvitationView(
    organizationId: string,
    invitationId: string,
  ): Promise<InvitationView> {
    const now = new Date();
    const [row] = await this.database.db
      .select({
        id: organizationInvitations.id,
        email: organizationInvitations.email,
        permissionOverrides: organizationInvitations.permissionOverrides,
        message: organizationInvitations.message,
        expiresAt: organizationInvitations.expiresAt,
        acceptedAt: organizationInvitations.acceptedAt,
        acceptedBy: organizationInvitations.acceptedBy,
        revokedAt: organizationInvitations.revokedAt,
        revokedBy: organizationInvitations.revokedBy,
        sendCount: organizationInvitations.sendCount,
        lastSentAt: organizationInvitations.lastSentAt,
        createdAt: organizationInvitations.createdAt,
        roleId: organizationRoles.id,
        roleName: organizationRoles.name,
        roleSlug: organizationRoles.slug,
        inviterId: inviterUser.id,
        inviterName: inviterUser.name,
      })
      .from(organizationInvitations)
      .innerJoin(
        organizationRoles,
        eq(organizationRoles.id, organizationInvitations.roleId),
      )
      .leftJoin(inviterUser, eq(inviterUser.id, organizationInvitations.invitedBy))
      .where(
        and(
          eq(organizationInvitations.organizationId, organizationId),
          eq(organizationInvitations.id, invitationId),
        ),
      )
      .limit(1);

    if (!row) {
      throw notFound("INVITE_NOT_FOUND", "Invitation not found.");
    }
    return this.toInvitationView(row, now);
  }

  private async getOrganizationSummary(organizationId: string): Promise<{
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
  }> {
    const [organization] = await this.database.db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        logoUrl: organizations.logoUrl,
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    if (!organization) {
      throw notFound("ORGANIZATION_NOT_FOUND", "Organization not found.");
    }
    return organization;
  }

  private acceptUrl(token: string): string {
    return `${this.webAppUrl}/invitations/${encodeURIComponent(token)}`;
  }
}
