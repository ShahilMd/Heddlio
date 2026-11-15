import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";

import { HeaderIdentityProvider } from "./header-identity.provider.js";
import { IDENTITY_PROVIDER, type IdentityProvider } from "./identity-provider.js";
import { IdentityGuard } from "./identity.guard.js";

/**
 * Authentication wiring.
 *
 * `AUTH_DRIVER` selects the identity provider. Only `dev-header` ships today.
 * Production refuses to start without a real driver, which is deliberate:
 * failing closed is safer than accidentally shipping a header trust bug.
 */
@Module({
  providers: [
    HeaderIdentityProvider,
    {
      provide: IDENTITY_PROVIDER,
      inject: [ConfigService, HeaderIdentityProvider],
      useFactory: (
        config: ConfigService,
        headerProvider: HeaderIdentityProvider,
      ): IdentityProvider => {
        const isProduction = config.get<string>("NODE_ENV") === "production";
        const driver =
          config.get<string>("AUTH_DRIVER") ?? (isProduction ? "" : "dev-header");

        if (driver === "dev-header") {
          if (isProduction) {
            throw new Error(
              "AUTH_DRIVER=dev-header is development-only. Configure a real authentication provider before starting in production.",
            );
          }
          return headerProvider;
        }

        throw new Error(
          `Unsupported AUTH_DRIVER "${driver}". Implement IdentityProvider and register it in AuthModule.`,
        );
      },
    },
    IdentityGuard,
    {
      provide: APP_GUARD,
      useClass: IdentityGuard,
    },
  ],
})
export class AuthModule {}
