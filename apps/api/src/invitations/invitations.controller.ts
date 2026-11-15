import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import { CurrentOrg } from "../common/decorators/current-org.decorator.js";
import { RequirePermission } from "../common/decorators/require-permission.decorator.js";
import { OrganizationAccessGuard } from "../authorization/organization-access.guard.js";
import type { OrganizationContext } from "../authorization/authorization.types.js";
import type { CursorPage } from "../common/cursor.js";
import {
  createInvitationSchema,
  invitationIdSchema,
  invitationListQuerySchema,
  type CreateInvitationInput,
  type InvitationListQueryInput,
} from "./invitations.dto.js";
import {
  InvitationsService,
  type InvitationView,
  type IssuedInvitation,
} from "./invitations.service.js";

@Controller("organizations/:organizationId/invitations")
@UseGuards(OrganizationAccessGuard)
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get()
  @RequirePermission("invite.view")
  async list(
    @CurrentOrg() context: OrganizationContext,
    @Query({ schema: invitationListQuerySchema })
    query: InvitationListQueryInput,
  ): Promise<CursorPage<InvitationView>> {
    return this.invitations.list(context.organizationId, query);
  }

  @Post()
  @RequirePermission("member.invite")
  async create(
    @CurrentOrg() context: OrganizationContext,
    @Body({ schema: createInvitationSchema }) body: CreateInvitationInput,
  ): Promise<IssuedInvitation> {
    return this.invitations.create(context, body);
  }

  @Post(":invitationId/resend")
  @RequirePermission("invite.resend")
  async resend(
    @CurrentOrg() context: OrganizationContext,
    @Param("invitationId", { schema: invitationIdSchema }) invitationId: string,
  ): Promise<IssuedInvitation> {
    return this.invitations.resend(context, invitationId);
  }

  @Delete(":invitationId")
  @HttpCode(204)
  @RequirePermission("invite.revoke")
  async revoke(
    @CurrentOrg() context: OrganizationContext,
    @Param("invitationId", { schema: invitationIdSchema }) invitationId: string,
  ): Promise<void> {
    await this.invitations.revoke(context, invitationId);
  }
}
