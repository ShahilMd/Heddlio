/**
 * The identity contract between the HTTP layer and authorization.
 *
 * A `Principal` answers one question: which durable user is making this
 * request? It deliberately contains no role or organisation data - those are
 * resolved per organization by `AuthorizationService`, because the same user
 * can be an Owner in one workspace and a Guest in another.
 *
 * When real authentication lands, only the `IdentityProvider` implementation
 * changes. Guards, controllers, permission checks and invite acceptance keep
 * consuming this shape.
 */
export interface Principal {
  userId: string;
  email: string;
  name: string;
}
