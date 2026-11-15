import { z } from "zod";

import { memberOverrideSchema } from "../members/members.dto.js";

export const createInvitationSchema = z
  .object({
    email: z.email().max(255),
    roleId: z.uuid(),
    /** A targeted grant/deny that follows this person into the membership. */
    permissionOverrides: z
      .array(memberOverrideSchema)
      .max(50, "An invitation cannot carry more than 50 permission overrides.")
      .superRefine((overrides, ctx) => {
        const seen = new Set<string>();
        for (const override of overrides) {
          if (seen.has(override.permissionKey)) {
            ctx.addIssue({
              code: "custom",
              message: `Duplicate override for ${override.permissionKey}.`,
              path: ["permissionOverrides"],
            });
          }
          seen.add(override.permissionKey);
        }
      })
      .optional(),
    expiresInDays: z.number().int().min(1).max(30).optional(),
    message: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export const invitationListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(500).optional(),
    status: z
      .enum(["pending", "accepted", "revoked", "expired", "all"])
      .default("pending"),
  })
  .strict();

export const invitationTokenSchema = z
  .string()
  .min(20, "Invitation token is too short.")
  .max(200, "Invitation token is too long.")
  .regex(/^[A-Za-z0-9_-]+$/, "Invitation token has an invalid format.");

export const invitationIdSchema = z.uuid();

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type InvitationListQueryInput = z.infer<typeof invitationListQuerySchema>;
