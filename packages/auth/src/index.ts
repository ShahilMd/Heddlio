/**
 * Shared authorization vocabulary and policy for Heddlio.
 *
 * This package is intentionally free of Nest, Drizzle and database imports so
 * the same rules can run in the API, a background worker, a CLI or tests. The
 * only Node-specific module is `node:crypto` in `invite-token.ts`; do not
 * import that file from browser code.
 */

export * from "./permissions.js";
export * from "./authorization.js";
export * from "./invite-token.js";
