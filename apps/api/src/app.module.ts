import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DatabaseModule } from "./database/database.module.js"
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from "./auth/auth.module.js"
import { AuthorizationModule } from "./authorization/authorization.module.js"
import { InvitationsModule } from "./invitations/invitations.module.js"
import { MembersModule } from "./members/members.module.js"
import { OrganizationsModule } from "./organizations/organizations.module.js"
import { RolesModule } from "./roles/roles.module.js"

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: "../../.env",
    }),

    DatabaseModule,
    AuthModule,
    AuthorizationModule,
    OrganizationsModule,
    RolesModule,
    MembersModule,
    InvitationsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
