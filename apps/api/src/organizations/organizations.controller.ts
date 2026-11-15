import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { CurrentOrg } from "../common/decorators/current-org.decorator.js";
import { CurrentPrincipal } from "../common/decorators/current-principal.decorator.js";
import { RequirePermission } from "../common/decorators/require-permission.decorator.js";
import type { Principal } from "../auth/auth.types.js";
import { OrganizationAccessGuard } from "../authorization/organization-access.guard.js";
import type { OrganizationContext } from "../authorization/authorization.types.js";
import type { AuditEventView } from "../authorization/audit.service.js";
import type { CursorPage } from "../common/cursor.js";
import {
  auditQuerySchema,
  createOrganizationSchema,
  transferOwnershipSchema,
  updateOrganizationSchema,
  type AuditQueryInput,
  type CreateOrganizationInput,
  type TransferOwnershipInput,
  type UpdateOrganizationInput,
} from "./organizations.dto.js";
import {
  OrganizationsService,
  type OrganizationMembershipView,
  type OrganizationView,
} from "./organizations.service.js";

const organizationIdSchema = z.uuid();

@Controller("organizations")
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Post()
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body({ schema: createOrganizationSchema }) body: CreateOrganizationInput,
  ): Promise<OrganizationView> {
    return this.organizations.create(principal, body);
  }

  @Get()
  async listMine(
    @CurrentPrincipal() principal: Principal,
  ): Promise<{ items: OrganizationMembershipView[] }> {
    return { items: await this.organizations.listMine(principal) };
  }

  @Get(":organizationId")
  @UseGuards(OrganizationAccessGuard)
  @RequirePermission("org.view")
  async get(
    @Param("organizationId", { schema: organizationIdSchema })
    organizationId: string,
  ): Promise<OrganizationView> {
    return this.organizations.get(organizationId);
  }

  @Patch(":organizationId")
  @UseGuards(OrganizationAccessGuard)
  @RequirePermission("org.update")
  async update(
    @CurrentOrg() context: OrganizationContext,
    @Body({ schema: updateOrganizationSchema }) body: UpdateOrganizationInput,
  ): Promise<OrganizationView> {
    return this.organizations.update(context, body);
  }

  @Post(":organizationId/transfer-ownership")
  @UseGuards(OrganizationAccessGuard)
  @RequirePermission("org.transfer_ownership")
  @HttpCode(204)
  async transferOwnership(
    @CurrentOrg() context: OrganizationContext,
    @Body({ schema: transferOwnershipSchema }) body: TransferOwnershipInput,
  ): Promise<void> {
    await this.organizations.transferOwnership(context, body.userId);
  }

  @Get(":organizationId/audit")
  @UseGuards(OrganizationAccessGuard)
  @RequirePermission("audit.view")
  async audit(
    @CurrentOrg() context: OrganizationContext,
    @Query({ schema: auditQuerySchema }) query: AuditQueryInput,
  ): Promise<CursorPage<AuditEventView>> {
    return this.organizations.listAudit(context.organizationId, query);
  }
}
