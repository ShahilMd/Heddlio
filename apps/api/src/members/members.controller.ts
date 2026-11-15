import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { CurrentOrg } from "../common/decorators/current-org.decorator.js";
import { RequirePermission } from "../common/decorators/require-permission.decorator.js";
import { OrganizationAccessGuard } from "../authorization/organization-access.guard.js";
import type { OrganizationContext } from "../authorization/authorization.types.js";
import type { CursorPage } from "../common/cursor.js";
import {
  memberListQuerySchema,
  replaceMemberOverridesSchema,
  updateMemberRoleSchema,
  type MemberListQueryInput,
  type ReplaceMemberOverridesInput,
  type UpdateMemberRoleInput,
} from "./members.dto.js";
import {
  MembersService,
  type MemberPermissionsView,
  type MemberView,
} from "./members.service.js";

const userIdSchema = z.uuid();

@Controller("organizations/:organizationId/members")
@UseGuards(OrganizationAccessGuard)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequirePermission("member.view")
  async list(
    @CurrentOrg() context: OrganizationContext,
    @Query({ schema: memberListQuerySchema }) query: MemberListQueryInput,
  ): Promise<CursorPage<MemberView>> {
    return this.members.list(context.organizationId, query);
  }

  @Get(":userId")
  @RequirePermission("member.view")
  async get(
    @CurrentOrg() context: OrganizationContext,
    @Param("userId", { schema: userIdSchema }) userId: string,
  ): Promise<MemberView> {
    return this.members.getMember(context.organizationId, userId);
  }

  @Patch(":userId/role")
  @RequirePermission("member.role.assign")
  async updateRole(
    @CurrentOrg() context: OrganizationContext,
    @Param("userId", { schema: userIdSchema }) userId: string,
    @Body({ schema: updateMemberRoleSchema }) body: UpdateMemberRoleInput,
  ): Promise<MemberView> {
    return this.members.updateRole(context, userId, body);
  }

  @Delete(":userId")
  @HttpCode(204)
  @RequirePermission("member.remove")
  async remove(
    @CurrentOrg() context: OrganizationContext,
    @Param("userId", { schema: userIdSchema }) userId: string,
  ): Promise<void> {
    await this.members.remove(context, userId);
  }

  /**
   * Deliberately not permission-gated: every member may see their own effective
   * permissions. Viewing somebody else's requires `member.view`, which the
   * service checks because it has the target id.
   */
  @Get(":userId/permissions")
  async permissions(
    @CurrentOrg() context: OrganizationContext,
    @Param("userId", { schema: userIdSchema }) userId: string,
  ): Promise<MemberPermissionsView> {
    return this.members.getPermissions(context, userId);
  }

  @Put(":userId/permissions")
  @RequirePermission("member.permission.manage")
  async replacePermissions(
    @CurrentOrg() context: OrganizationContext,
    @Param("userId", { schema: userIdSchema }) userId: string,
    @Body({ schema: replaceMemberOverridesSchema })
    body: ReplaceMemberOverridesInput,
  ): Promise<MemberPermissionsView> {
    return this.members.replaceOverrides(context, userId, body);
  }
}
