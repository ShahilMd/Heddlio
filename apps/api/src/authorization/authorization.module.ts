import { Module } from "@nestjs/common";

import { AuditService } from "./audit.service.js";
import { AuthorizationService } from "./authorization.service.js";
import { OrganizationAccessGuard } from "./organization-access.guard.js";
import { PermissionsController } from "./permissions.controller.js";
import { PermissionsService } from "./permissions.service.js";

@Module({
  controllers: [PermissionsController],
  providers: [
    PermissionsService,
    AuthorizationService,
    AuditService,
    OrganizationAccessGuard,
  ],
  exports: [
    PermissionsService,
    AuthorizationService,
    AuditService,
    OrganizationAccessGuard,
  ],
})
export class AuthorizationModule {}
