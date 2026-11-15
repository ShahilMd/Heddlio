import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type { Request } from "express";
import { z } from "zod";

import { users } from "@heddlio/db";

import { DatabaseService } from "../database/database.service.js";
import type { Principal } from "./auth.types.js";
import type { IdentityProvider } from "./identity-provider.js";

const userHeaderSchema = z.uuid();

/**
 * DEVELOPMENT ONLY.
 *
 * Trusts a raw `X-User-Id` header and looks the user up. This exists so the
 * authorization and invitation flows are runnable before the authentication
 * workstream lands - it is not authentication and must never be enabled in
 * production (the module refuses to start if it is).
 */
@Injectable()
export class HeaderIdentityProvider implements IdentityProvider {
  constructor(private readonly database: DatabaseService) {}

  async resolve(request: Request): Promise<Principal | null> {
    const rawUserId = request.header("x-user-id");
    const parsed = userHeaderSchema.safeParse(rawUserId);
    if (!parsed.success) return null;

    const [user] = await this.database.db
      .select({
        userId: users.id,
        email: users.email,
        name: users.name,
      })
      .from(users)
      .where(and(eq(users.id, parsed.data), eq(users.status, "active")))
      .limit(1);

    return user ?? null;
  }
}
