import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "heddlio:isPublic";

/**
 * Opts a route out of the global identity guard. Use sparingly: the only
 * intended caller is the invitation preview, which must be readable before the
 * invitee has an account.
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
