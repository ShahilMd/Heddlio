import { Module } from "@nestjs/common";

import { AuthorizationModule } from "../authorization/authorization.module.js";
import { MembersController } from "./members.controller.js";
import { MembersService } from "./members.service.js";

@Module({
  imports: [AuthorizationModule],
  controllers: [MembersController],
  providers: [MembersService],
})
export class MembersModule {}
