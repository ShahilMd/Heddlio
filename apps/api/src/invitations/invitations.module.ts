import { Module } from "@nestjs/common";

import { AuthorizationModule } from "../authorization/authorization.module.js";
import { MailModule } from "../mail/mail.module.js";
import { InvitationsController } from "./invitations.controller.js";
import { InvitationsService } from "./invitations.service.js";
import { PublicInvitationsController } from "./public-invitations.controller.js";

@Module({
  imports: [AuthorizationModule, MailModule],
  controllers: [InvitationsController, PublicInvitationsController],
  providers: [InvitationsService],
})
export class InvitationsModule {}
