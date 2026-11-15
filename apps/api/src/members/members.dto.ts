import { z } from "zod";

export const memberListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(500).optional(),
    status: z
      .enum(["invited", "active", "suspended", "removed"])
      .optional(),
  })
  .strict();

export const updateMemberRoleSchema = z
  .object({
    roleId: z.uuid(),
  })
  .strict();

export const memberOverrideSchema = z
  .object({
    permissionKey: z.string().min(1).max(100),
    effect: z.enum(["allow", "deny"]),
    /** ISO-8601. Omit or null for a permanent override. */
    expiresAt: z.iso.datetime().nullable().optional(),
    reason: z.string().trim().max(255).nullable().optional(),
  })
  .strict();

export const replaceMemberOverridesSchema = z
  .object({
    overrides: z
      .array(memberOverrideSchema)
      .max(50, "A member cannot hold more than 50 explicit overrides.")
      .superRefine((overrides, ctx) => {
        const seen = new Set<string>();
        for (const override of overrides) {
          if (seen.has(override.permissionKey)) {
            ctx.addIssue({
              code: "custom",
              message: `Duplicate override for ${override.permissionKey}.`,
              path: ["overrides"],
            });
          }
          seen.add(override.permissionKey);
        }
      }),
  })
  .strict();

export type MemberListQueryInput = z.infer<typeof memberListQuerySchema>;
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
export type ReplaceMemberOverridesInput = z.infer<
  typeof replaceMemberOverridesSchema
>;
export type MemberOverrideInput = z.infer<typeof memberOverrideSchema>;
