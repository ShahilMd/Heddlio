import type { PermissionKey } from "@heddlio/auth";

import type { Principal } from "../auth/auth.types.js";

export type MemberStatus = "invited" | "active" | "suspended" | "removed";

export interface RoleSummary {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  rank: number;
  isSystem: boolean;
  isOwner: boolean;
  isDefault: boolean;
  permissionKeys: PermissionKey[];
}

/**
 * Request-scoped view of "who is calling, in which organization, with what
 * authority". Built once by `OrganizationAccessGuard`; handlers receive it via
 * `@CurrentOrg()` and never re-query the membership.
 */
export interface OrganizationContext {
  organizationId: string;
  principal: Principal;
  member: {
    userId: string;
    roleId: string;
    status: MemberStatus;
    joinedAt: Date;
  };
  role: RoleSummary;
  permissions: ReadonlySet<PermissionKey>;
}
