import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { asc, inArray, sql } from "drizzle-orm";
import { ConfigService } from "@nestjs/config";

import {
  PERMISSIONS,
  type PermissionDefinition,
  type PermissionKey,
} from "@heddlio/auth";
import { permissions } from "@heddlio/db";

import { badRequest } from "../common/api-exception.js";
import { DatabaseService } from "../database/database.service.js";

/**
 * Projects the code-defined permission catalog into Postgres.
 *
 * The catalog is authoritative in code; the table exists for FK integrity,
 * joins and admin rendering. Sync is an upsert-only operation: permissions are
 * never deleted automatically, because a permission might still be referenced
 * by a role grant or a historical audit row. Removing one is a conscious
 * migration, not a side effect of a deploy.
 *
 * `SYNC_PERMISSION_CATALOG=false` exists for deployments where a migration job
 * owns schema writes and the API user should not have DML rights on this table.
 */
@Injectable()
export class PermissionsService implements OnModuleInit {
  private readonly logger = new Logger(PermissionsService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const enabled =
      this.config.get<string>("SYNC_PERMISSION_CATALOG")?.toLowerCase() !==
      "false";
    if (!enabled) return;

    await this.syncCatalog();
  }

  async syncCatalog(): Promise<void> {
    await this.database.db
      .insert(permissions)
      .values(
        PERMISSIONS.map((permission) => ({
          key: permission.key,
          resource: permission.resource,
          action: permission.action,
          description: permission.description,
          isAssignable: permission.assignable,
        })),
      )
      .onConflictDoUpdate({
        target: permissions.key,
        set: {
          resource: sql`excluded.resource`,
          action: sql`excluded.action`,
          description: sql`excluded.description`,
          isAssignable: sql`excluded.is_assignable`,
          updatedAt: new Date(),
        },
      });

    this.logger.log(`Permission catalog synced (${PERMISSIONS.length} keys).`);
  }

  async listCatalog(): Promise<PermissionDefinition[]> {
    const rows = await this.database.db
      .select({
        key: permissions.key,
        resource: permissions.resource,
        action: permissions.action,
        description: permissions.description,
        isAssignable: permissions.isAssignable,
      })
      .from(permissions)
      .orderBy(asc(permissions.resource), asc(permissions.action));

    return rows.map((row) => ({
      key: row.key,
      resource: row.resource,
      action: row.action,
      description: row.description,
      assignable: row.isAssignable,
    }));
  }

  /** Rejects unknown keys before they reach an FK and produce a 500. */
  async assertKnownPermissionKeys(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;

    const rows = await this.database.db
      .select({ key: permissions.key })
      .from(permissions)
      .where(inArray(permissions.key, [...new Set(keys)]));

    const known = new Set(rows.map((row) => row.key));
    const unknown = [...new Set(keys)].filter((key) => !known.has(key));
    if (unknown.length > 0) {
      throw badRequest(
        "UNKNOWN_PERMISSION",
        `Unknown permission key(s): ${unknown.join(", ")}.`,
        { unknownPermissions: unknown },
      );
    }
  }

  /** Only keys that are allowed on custom roles and overrides. */
  async assertAssignablePermissionKeys(keys: readonly string[]): Promise<void> {
    await this.assertKnownPermissionKeys(keys);

    if (keys.length === 0) return;
    const rows = await this.database.db
      .select({ key: permissions.key, isAssignable: permissions.isAssignable })
      .from(permissions)
      .where(inArray(permissions.key, [...new Set(keys)]));

    const notAssignable = rows
      .filter((row) => !row.isAssignable)
      .map((row) => row.key);
    if (notAssignable.length > 0) {
      throw badRequest(
        "PERMISSION_NOT_ASSIGNABLE",
        `Permission(s) reserved for the owner role: ${notAssignable.join(", ")}.`,
        { notAssignablePermissions: notAssignable },
      );
    }
  }
}

export const isPermissionKeyValue = (
  value: string,
): value is PermissionKey => PERMISSIONS.some((p) => p.key === value);
