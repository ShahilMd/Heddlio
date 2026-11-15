import { SetMetadata } from "@nestjs/common";

import type { PermissionKey } from "@heddlio/auth";

export const REQUIRED_PERMISSIONS_KEY = "heddlio:requiredPermissions";

/**
 * Declares the permissions a route needs. `OrganizationAccessGuard` resolves
 * the caller's effective permission set and rejects the request if any key is
 * missing; the handler never has to re-check permissions itself.
 *
 * Multiple keys mean all-of. A future `@RequireAnyPermission` can be added
 * without changing the storage format by storing `{ mode, keys }`.
 */
export const RequirePermission = (
  ...permissions: PermissionKey[]
): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);
