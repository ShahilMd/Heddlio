import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { z } from "zod";

import type { PermissionKey } from "@heddlio/auth";

import type { Principal } from "../auth/auth.types.js";
import { badRequest, forbidden, unauthorized } from "../common/api-exception.js";
import { REQUIRED_PERMISSIONS_KEY } from "../common/decorators/require-permission.decorator.js";
import { AuthorizationService } from "./authorization.service.js";
import type { OrganizationContext } from "./authorization.types.js";

const organizationIdSchema = z.uuid();

/**
 * Second gate, applied to org-scoped controllers after the global
 * `IdentityGuard`:
 *
 *   1. resolve membership + role + effective permissions once,
 *   2. attach the result to the request,
 *   3. enforce the `@RequirePermission(...)` metadata.
 *
 * All three happen here so a handler can never observe a partially resolved
 * context. A non-member gets 403 rather than 404: whether an organization id
 * exists is itself information.
 */
@Injectable()
export class OrganizationAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<
      Request & {
        principal?: Principal;
        orgContext?: OrganizationContext;
      }
    >();

    if (!request.principal) {
      throw unauthorized(
        "UNAUTHENTICATED",
        "A valid authenticated identity is required.",
      );
    }

    const parsedOrganizationId = organizationIdSchema.safeParse(
      request.params.organizationId,
    );
    if (!parsedOrganizationId.success) {
      throw badRequest(
        "INVALID_ORGANIZATION_ID",
        "organizationId must be a UUID.",
      );
    }

    const orgContext = await this.authorization.getOrganizationContext(
      parsedOrganizationId.data,
      request.principal,
    );
    request.orgContext = orgContext;

    const required =
      this.reflector.getAllAndOverride<PermissionKey[]>(
        REQUIRED_PERMISSIONS_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? [];

    const missing = required.filter(
      (permission) => !orgContext.permissions.has(permission),
    );
    if (missing.length > 0) {
      throw forbidden(
        "MISSING_PERMISSION",
        "You do not have the permission required for this action.",
        { missingPermissions: missing },
      );
    }

    return true;
  }
}
