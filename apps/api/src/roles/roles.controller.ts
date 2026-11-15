import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { CurrentOrg } from "../common/decorators/current-org.decorator.js";
import { RequirePermission } from "../common/decorators/require-permission.decorator.js";
import { OrganizationAccessGuard } from "../authorization/organization-access.guard.js";
import type { OrganizationContext, RoleSummary } from "../authorization/authorization.types.js";
import {
  createRoleSchema,
  replaceRolePermissionsSchema,
  updateRoleSchema,
  type CreateRoleInput,
  type ReplaceRolePermissionsInput,
  type UpdateRoleInput,
} from "./roles.dto.js";
import { RolesService, type RoleView } from "./roles.service.js";

const roleIdSchema = z.uuid();

@Controller("organizations/:organizationId/roles")
@UseGuards(OrganizationAccessGuard)
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermission("role.view")
  async list(
    @CurrentOrg() context: OrganizationContext,
  ): Promise<{ items: RoleView[] }> {
    return { items: await this.roles.list(context.organizationId) };
  }

  @Post()
  @RequirePermission("role.manage")
  async create(
    @CurrentOrg() context: OrganizationContext,
    @Body({ schema: createRoleSchema }) body: CreateRoleInput,
  ): Promise<RoleSummary> {
    return this.roles.create(context, body);
  }

  @Get(":roleId")
  @RequirePermission("role.view")
  async get(
    @CurrentOrg() context: OrganizationContext,
    @Param("roleId", { schema: roleIdSchema }) roleId: string,
  ): Promise<RoleSummary> {
    return this.roles.get(context.organizationId, roleId);
  }

  @Patch(":roleId")
  @RequirePermission("role.manage")
  async update(
    @CurrentOrg() context: OrganizationContext,
    @Param("roleId", { schema: roleIdSchema }) roleId: string,
    @Body({ schema: updateRoleSchema }) body: UpdateRoleInput,
  ): Promise<RoleSummary> {
    return this.roles.update(context, roleId, body);
  }

  @Put(":roleId/permissions")
  @RequirePermission("role.manage")
  async replacePermissions(
    @CurrentOrg() context: OrganizationContext,
    @Param("roleId", { schema: roleIdSchema }) roleId: string,
    @Body({ schema: replaceRolePermissionsSchema })
    body: ReplaceRolePermissionsInput,
  ): Promise<RoleSummary> {
    return this.roles.replacePermissions(context, roleId, body);
  }

  @Delete(":roleId")
  @HttpCode(204)
  @RequirePermission("role.manage")
  async remove(
    @CurrentOrg() context: OrganizationContext,
    @Param("roleId", { schema: roleIdSchema }) roleId: string,
  ): Promise<void> {
    await this.roles.delete(context, roleId);
  }
}
