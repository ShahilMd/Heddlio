import type { Request } from "express";

import type { Principal } from "./auth.types.js";

export const IDENTITY_PROVIDER = Symbol("HEDDLIO_IDENTITY_PROVIDER");

/**
 * Authentication port.
 *
 * The current implementation is a development header provider. A JWT/session
 * provider (Better Auth, OIDC, ...) implements this same interface and is
 * selected by `AUTH_DRIVER`; nothing else in the application needs to know
 * which one is active.
 *
 * Returning `null` means "no valid identity". Returning a principal means the
 * credential was verified. Implementations must never trust user-supplied
 * claims without verification.
 */
export interface IdentityProvider {
  resolve(request: Request): Promise<Principal | null>;
}
