import { z } from "zod";

const organizationName = z
  .string()
  .trim()
  .min(2, "Organization name must be at least 2 characters.")
  .max(255, "Organization name must be at most 255 characters.");

const organizationSlug = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "Slug must be at least 2 characters.")
  .max(110, "Slug must be at most 110 characters.")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug may only contain lowercase letters, numbers and single hyphens.",
  );

const organizationSettings = z.record(z.string(), z.unknown());

export const createOrganizationSchema = z
  .object({
    name: organizationName,
    slug: organizationSlug.optional(),
    settings: organizationSettings.optional(),
  })
  .strict();

export const updateOrganizationSchema = z
  .object({
    name: organizationName.optional(),
    slug: organizationSlug.optional(),
    logoUrl: z.url().max(1024).nullable().optional(),
    settings: organizationSettings.optional(),
  })
  .strict();

export const transferOwnershipSchema = z
  .object({
    userId: z.uuid(),
  })
  .strict();

export const auditQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(500).optional(),
  })
  .strict();

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type TransferOwnershipInput = z.infer<typeof transferOwnershipSchema>;
export type AuditQueryInput = z.infer<typeof auditQuerySchema>;
