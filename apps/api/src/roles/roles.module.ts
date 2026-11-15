import { Module } from "@nestjs/common";

import { AuthorizationModule } from "../authorization/authorization.module.js";
import { RolesController } from "./roles.controller.js";
import { RolesService } from "./roles.service.js";

@Module({
  imports: [AuthorizationModule],
  controllers: [RolesController],
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule {}
