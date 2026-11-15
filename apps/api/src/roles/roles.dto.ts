import { z } from "zod";

const roleName = z
  .string()
  .trim()
  .min(2, "Role name must be at least 2 characters.")
  .max(64, "Role name must be at most 64 characters.");

const roleDescription = z
  .string()
  .trim()
  .max(255, "Description must be at most 255 characters.");

const roleRank = z
  .number()
  .int()
  .min(0, "Rank cannot be negative.")
  .max(10_000, "Rank is too high.");

const permissionKeys = z
  .array(z.string().min(1).max(100))
  .max(100, "A role cannot hold more than 100 permissions.")
  .refine((keys) => new Set(keys).size === keys.length, {
    message: "Duplicate permission keys are not allowed.",
  });

export const createRoleSchema = z
  .object({
    name: roleName,
    description: roleDescription.optional(),
    /**
     * Rank only controls who may manage/assign the role. Authorization is the
     * permission set; defaulting to the lowest rank makes a new role safe by
     * default rather than accidentally powerful.
     */
    rank: roleRank.default(100),
    permissions: permissionKeys.default([]),
    isDefault: z.boolean().optional(),
  })
  .strict();

export const updateRoleSchema = z
  .object({
    name: roleName.optional(),
    description: roleDescription.nullable().optional(),
    rank: roleRank.optional(),
    permissions: permissionKeys.optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();

export const replaceRolePermissionsSchema = z
  .object({
    permissions: permissionKeys,
  })
  .strict();

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type ReplaceRolePermissionsInput = z.infer<
  typeof replaceRolePermissionsSchema
>;
