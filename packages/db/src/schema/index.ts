/**
 * Single entry point for the whole schema.
 *
 * `client.ts` does `import * as schema from "./schema/index.js"` and hands the
 * result to `drizzle()`, so anything missing from this barrel is invisible to
 * the relational query API (`db.query.messages.findMany(...)`), even if the
 * table exists in the database.
 *
 * Every file here matches drizzle-kit's `*.schema.ts` glob except
 * `relations.ts`, which contributes no DDL and is only loaded for its side
 * effect of registering the relational graph.
 */

export * from "./enums.schema.js";
export * from "./users.schema.js";
export * from "./organization.schema.js";
export * from "./channel.schema.js";
export * from "./message.schema.js";
export * from "./project.schema.js";
export * from "./issue.schema.js";
export * from "./board.schema.js";
export * from "./file.schema.js";
export * from "./notification.schema.js";

export * from "./relations.js";
