import { createParamDecorator, type ExecutionContext } from "@nestjs/common";

import type { OrganizationContext } from "../../authorization/authorization.types.js";

export const CurrentOrg = createParamDecorator(
  (_data: unknown, context: ExecutionContext): OrganizationContext => {
    const request = context
      .switchToHttp()
      .getRequest<{ orgContext?: OrganizationContext }>();

    if (!request.orgContext) {
      throw new Error(
        "CurrentOrg used on a route without OrganizationAccessGuard.",
      );
    }
    return request.orgContext;
  },
);
