import { Controller, Get, HttpCode, Param, Post } from "@nestjs/common";

import { CurrentPrincipal } from "../common/decorators/current-principal.decorator.js";
import { Public } from "../common/decorators/public.decorator.js";
import type { Principal } from "../auth/auth.types.js";
import {
  invitationTokenSchema,
} from "./invitations.dto.js";
import {
  InvitationsService,
  type AcceptedInvitation,
} from "./invitations.service.js";

/**
 * Public surface of the invite flow.
 *
 * Preview is `@Public()` so an invitee can see who invited them before signing
 * in. Accept is not public: the global IdentityGuard supplies a principal, and
 * the service requires its verified email to match the invitation.
 *
 * New-account creation is intentionally not here. When real authentication
 * lands, the invitee signs up through it and then calls accept with the
 * resulting session.
 */
@Controller("invitations")
export class PublicInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get(":token")
  @Public()
  async preview(
    @Param("token", { schema: invitationTokenSchema }) token: string,
  ) {
    return this.invitations.preview(token);
  }

  @Post(":token/accept")
  @HttpCode(200)
  async accept(
    @CurrentPrincipal() principal: Principal,
    @Param("token", { schema: invitationTokenSchema }) token: string,
  ): Promise<AcceptedInvitation> {
    return this.invitations.accept(principal, token);
  }
}
