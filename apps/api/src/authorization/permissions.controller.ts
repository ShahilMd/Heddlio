import { Controller, Get } from "@nestjs/common";

import type { PermissionDefinition } from "@heddlio/auth";

import { PermissionsService } from "./permissions.service.js";

/**
 * Read-only catalog for role/override editors.
 *
 * Authentication is required (global IdentityGuard), but no organization
 * permission: the catalog is the same public vocabulary for every tenant, and
 * clients need it to render a role editor before they touch any role.
 */
@Controller("permissions")
export class PermissionsController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  async list(): Promise<{ items: PermissionDefinition[] }> {
    return { items: await this.permissions.listCatalog() };
  }
}
