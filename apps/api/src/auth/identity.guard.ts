import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";

import { IS_PUBLIC_KEY } from "../common/decorators/public.decorator.js";
import { unauthorized } from "../common/api-exception.js";
import type { Principal } from "./auth.types.js";
import { IDENTITY_PROVIDER, type IdentityProvider } from "./identity-provider.js";

/**
 * Global first gate: resolve the principal exactly once per request and attach
 * it to the request. `@Public()` routes skip it.
 *
 * Organization membership is intentionally not checked here - one identity can
 * belong to many organizations, and the org is only known once the route params
 * are parsed.
 */
@Injectable()
export class IdentityGuard implements CanActivate {
  constructor(
    @Inject(IDENTITY_PROVIDER)
    private readonly identityProvider: IdentityProvider,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { principal?: Principal }>();

    const principal = await this.identityProvider.resolve(request);
    if (!principal) {
      throw unauthorized(
        "UNAUTHENTICATED",
        "A valid authenticated identity is required.",
      );
    }

    request.principal = principal;
    return true;
  }
}
