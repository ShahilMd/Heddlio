ALTER TABLE "organization_invitations" ALTER COLUMN "role_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_members" ALTER COLUMN "role_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_invitations" DROP COLUMN "role";--> statement-breakpoint
ALTER TABLE "organization_members" DROP COLUMN "role";--> statement-breakpoint
DROP TYPE "public"."organization_role";