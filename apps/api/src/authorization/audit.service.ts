import { Injectable } from "@nestjs/common";
import { and, desc, eq, lt } from "drizzle-orm";

import { type Database, organizationAuditEvents } from "@heddlio/db";

import {
  encodeCursor,
  readNumberCursorField,
  decodeCursor,
  type CursorPage,
} from "../common/cursor.js";
import { DatabaseService } from "../database/database.service.js";

/**
 * Drizzle transaction objects expose the same builders as the root client, but
 * not the `transaction` method itself. Services accept either so an audit row
 * can join the same transaction as the mutation it describes.
 */
export type DbExecutor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface AuditEventInput {
  organizationId: string;
  actorId: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  changes?: Record<string, unknown>;
}

export interface AuditEventView {
  id: number;
  action: string;
  actorId: string | null;
  targetType: string | null;
  targetId: string | null;
  changes: Record<string, unknown>;
  createdAt: Date;
}

@Injectable()
export class AuditService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Best-effort by design: the caller passes its transaction so the audit row
   * commits atomically with the change. Never fire-and-forget this - an audit
   * trail with holes is indistinguishable from no audit trail during an
   * incident.
   */
  async record(executor: DbExecutor, event: AuditEventInput): Promise<void> {
    await executor.insert(organizationAuditEvents).values({
      organizationId: event.organizationId,
      actorId: event.actorId,
      action: event.action,
      targetType: event.targetType ?? null,
      targetId: event.targetId ?? null,
      changes: event.changes ?? {},
    });
  }

  async list(
    organizationId: string,
    options: { limit: number; cursor?: string },
  ): Promise<CursorPage<AuditEventView>> {
    const cursor = decodeCursor(options.cursor);
    const beforeId = readNumberCursorField(cursor, "id");

    const rows = await this.database.db
      .select({
        id: organizationAuditEvents.id,
        action: organizationAuditEvents.action,
        actorId: organizationAuditEvents.actorId,
        targetType: organizationAuditEvents.targetType,
        targetId: organizationAuditEvents.targetId,
        changes: organizationAuditEvents.changes,
        createdAt: organizationAuditEvents.createdAt,
      })
      .from(organizationAuditEvents)
      .where(
        and(
          eq(organizationAuditEvents.organizationId, organizationId),
          beforeId === null ? undefined : lt(organizationAuditEvents.id, beforeId),
        ),
      )
      .orderBy(desc(organizationAuditEvents.id))
      .limit(options.limit + 1);

    const hasMore = rows.length > options.limit;
    const items = hasMore ? rows.slice(0, options.limit) : rows;
    const last = items.at(-1);

    return {
      items: items.map((row) => ({
        ...row,
        changes: (row.changes ?? {}) as Record<string, unknown>,
      })),
      nextCursor:
        hasMore && last ? encodeCursor({ id: last.id }) : null,
    };
  }
}
