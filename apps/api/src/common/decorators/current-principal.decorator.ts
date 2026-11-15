import { createParamDecorator, type ExecutionContext } from "@nestjs/common";

import type { Principal } from "../../auth/auth.types.js";

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const request = context
      .switchToHttp()
      .getRequest<{ principal?: Principal }>();

    if (!request.principal) {
      throw new Error(
        "CurrentPrincipal used on a route without IdentityGuard or @Public().",
      );
    }
    return request.principal;
  },
);
