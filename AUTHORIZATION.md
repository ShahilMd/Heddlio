# Organization authorization

This document is the entry point for anyone changing permissions, roles,
membership or invitations in Heddlio. It describes the model, the invariants the
API enforces, and where the auth workstream plugs in.

> Prefer diagrams? Start with
> [`AUTHORIZATION_DIAGRAMS.md`](./AUTHORIZATION_DIAGRAMS.md): database ER diagram,
> NestJS request lifecycle, module map and use-case flows.

The system is **org-scoped**: a user's authority is resolved separately for every
organization. There is no global admin flag and no cross-tenant role. Finer
scopes (project/channel/board) are intentionally not modelled yet.

- Permission vocabulary and role templates: `packages/auth/src/permissions.ts`
- Pure policy predicates: `packages/auth/src/authorization.ts`
- Invite token helpers: `packages/auth/src/invite-token.ts`
- Database tables: `packages/db/src/schema/organization.schema.ts`
- Enforcement and policy wiring: `apps/api/src/authorization/`
- No UI ships with this work; `apps/web` and `apps/admin` are untouched.

## Mental model

| Concept | Meaning |
| --- | --- |
| **Principal** | The authenticated user making the request (`userId`, `email`, `name`). Contains no role or tenant data. |
| **Membership** | A row in `organization_members`: this user belongs to this organization with one `role_id`. |
| **Role** | An org-owned row in `organization_roles` with a `rank` and a set of permission grants. |
| **Permission** | A stable `<resource>.<action>` key from the code catalog, e.g. `member.invite`. |
| **Override** | A per-member `allow`/`deny` row that layers on top of the role for one permission, optionally expiring. |
| **Owner** | The single member holding the `is_owner` role. Implicitly holds every permission. |

A user can be an Owner in one workspace and a Guest in another; nothing about
authority is global.

## Data model

```
permissions (key PK, resource, action, description, is_assignable)
        ▲                         ▲
        │ permission_key          │ permission_key
organization_role_permissions   organization_member_permission_overrides
        │ role_id                 │ (organization_id, user_id, permission_key) PK
        ▼                         ▼
organization_roles ◄──── organization_members ────► users
  (organization_id, id) unique    (organization_id, user_id) PK
        ▲
        │ (organization_id, role_id)
organization_invitations
  (organization_id, email) unique while pending
```

Design choices that matter:

- **Roles are rows, not an enum.** An organization can create Contractor,
  On-call or Auditor without a migration. `organization_members.role` was
  replaced by `role_id` in migration `0003`.
- **One role per member.** Per-person differences are expressed as overrides,
  not as extra roles. The override table is keyed by
  `(organization_id, user_id, permission_key)`, so allow and deny for the same
  key cannot coexist.
- **Composite tenant FKs.** `organization_members` and
  `organization_invitations` reference
  `organization_roles(organization_id, id)`, not just `id`. A role from another
  tenant is impossible to assign even if application code regresses.
- **Soft-deleted roles.** `organization_roles.deleted_at` keeps historical
  grants and audit references readable. Unique indexes for name/slug/default are
  partial on `deleted_at IS NULL`.
- **Audit trail.** `organization_audit_events` is append-only in application
  code and is written inside the same transaction as the mutation it records.

## Permission catalog

The catalog is **code-defined** in `packages/auth`. `PermissionsService`
upserts it into the `permissions` table at boot so FK integrity and admin
rendering work. The table is a projection; never add a permission directly in
SQL.

There are 32 keys across nine resources:

| Resource | Keys |
| --- | --- |
| `org` | `org.view`, `org.update`, `org.delete`*, `org.transfer_ownership`* |
| `audit` | `audit.view` |
| `member` | `member.view`, `member.invite`, `member.remove`, `member.role.assign`, `member.permission.manage` |
| `role` | `role.view`, `role.manage` |
| `invite` | `invite.view`, `invite.resend`, `invite.revoke` |
| `project` | `project.view`, `project.create`, `project.update`, `project.delete` |
| `channel` | `channel.view`, `channel.create`, `channel.update`, `channel.delete` |
| `board` | `board.view`, `board.create`, `board.update`, `board.delete` |
| `issue` | `issue.view`, `issue.create`, `issue.update`, `issue.delete` |
| `file` | `file.upload` |

`*` = `assignable: false`. These two are reserved for the implicit owner role and
can never be attached to a custom role or an override, even by the owner.

Adding a permission is a three-step change: add it to `PERMISSIONS`, use
`@RequirePermission("...")` in a controller, and decide which templates receive
it. No migration is needed for the catalog row itself.

## Default roles

Every organization is seeded with six templates when it is created, inside the
same transaction (`RolesService.seedDefaultRoles`). Existing organizations were
backfilled by migration `0002`.

| Slug | Rank | Default | Owner | Materialized grants | Notes |
| --- | ---: | :---: | :---: | ---: | --- |
| `owner` | 1000 | no | yes | 32 | System row, immutable, implicitly all permissions |
| `admin` | 900 | no | no | 30 | Everything except the two ownership operations |
| `manager` | 700 | no | no | 28 | People + content; cannot edit the role catalog |
| `developer` | 500 | no | no | 17 | Creates/edits content |
| `member` | 300 | yes | no | 9 | Default for invites and new members |
| `guest` | 100 | no | no | 5 | Read-only |

Only `owner` is protected. The other five are ordinary rows: an organization may
rename them, change their rank, re-scope their permissions or delete them, as
long as the invariants below hold. `member` is the default role and cannot be
deleted or un-flagged until another role becomes the default.

`rank` is an authority score, not a display order: an actor must have a
**strictly higher** rank than a role/member they manage or assign. The owner
bypasses rank comparisons but not the immutable/owner-target rules.

## Effective permissions

Resolution is pure and lives in `resolveEffectivePermissions`:

```
owner role                          -> all permission keys (short-circuit)
role grants                         -> base set
allow overrides (non-expired)       -> add
deny overrides (non-expired)        -> remove
```

- Deny is applied after allow, so precedence is explicit and order-independent.
- Expired overrides are ignored at read time but not deleted, preserving history.
- Unknown catalog keys are ignored defensively rather than trusted.
- The API resolves this in three indexed reads per request: membership + role,
  role grants, and member overrides. No cache yet; see future work.

`GET /organizations/:organizationId/members/:userId/permissions` returns the
resolved set plus the role and raw overrides.

## Security invariants

These are enforced by `@heddlio/auth` predicates and translated to HTTP errors
by `AuthorizationService`. Every new endpoint must go through the same checks;
do not reimplement a `rank >` comparison in a controller.

1. **Owner role is immutable.** It cannot be edited, re-permissioned or deleted.
   Ownership moves only through the transfer endpoint.
2. **Owner role is not assignable.** Invites and member updates cannot select it.
3. **Strict rank.** A non-owner can only manage/assign roles and members ranked
   strictly below their own. A new role must be ranked below its creator.
4. **No self-escalation.** Non-owners can only grant permissions they already
   hold, and cannot assign a role containing permissions they lack. Otherwise
   `role.manage` would be a path to `org.transfer_ownership`.
5. **Ownership operations are never grantable.** `org.delete` and
   `org.transfer_ownership` are `assignable: false`; only the implicit owner
   role has them.
6. **No self-modification.** A member cannot change their own role or their own
   overrides, and cannot remove themselves.
7. **Owner member is protected.** Nobody can change or remove the owner member;
   use ownership transfer.
8. **Last owner is protected.** Demoting or removing the last active owner is
   rejected so an organization cannot lock itself out.
9. **Tenant-safe role references.** Composite FKs prevent assigning a role from
   another organization.
10. **Role deletion is safe.** A role still assigned to any non-removed member
    cannot be deleted. Pending invites carrying a deleted role are revoked
    atomically.
11. **Overrides are personal.** Removing a member deletes their overrides so a
    later re-invite does not silently restore old grants.

Errors use a stable machine-readable `code`; clients should switch on it, not on
the message. Relevant codes include `NOT_A_MEMBER`, `MEMBERSHIP_INACTIVE`,
`MISSING_PERMISSION`, `OWNER_ONLY`, `ROLE_RANK_TOO_LOW`,
`PERMISSION_ESCALATION`, `PERMISSION_NOT_ASSIGNABLE`, `SYSTEM_ROLE_IMMUTABLE`,
`OWNER_ROLE_IMMUTABLE`, `OWNER_ROLE_NOT_ASSIGNABLE`,
`SELF_MODIFICATION_NOT_ALLOWED`, `MEMBER_IMMUTABLE`, `LAST_OWNER_PROTECTED`,
`DEFAULT_ROLE_REQUIRED`, `ROLE_IN_USE`, and `INVITE_NOT_FOUND`.

## HTTP API

All routes are unprefixed and served on port `8080` by default. Every route
requires an authenticated principal except the public invite preview.
Organization routes resolve membership and permissions in
`OrganizationAccessGuard` before the handler runs.

| Method & path | Permission |
| --- | --- |
| `GET /permissions` | authenticated only |
| `POST /organizations` | authenticated only; caller becomes owner |
| `GET /organizations` | authenticated only; caller's active memberships |
| `GET /organizations/:organizationId` | `org.view` |
| `PATCH /organizations/:organizationId` | `org.update` |
| `POST /organizations/:organizationId/transfer-ownership` | `org.transfer_ownership` + owner |
| `GET /organizations/:organizationId/audit` | `audit.view` |
| `GET /organizations/:organizationId/roles` | `role.view` |
| `POST /organizations/:organizationId/roles` | `role.manage` |
| `GET /organizations/:organizationId/roles/:roleId` | `role.view` |
| `PATCH /organizations/:organizationId/roles/:roleId` | `role.manage` |
| `PUT /organizations/:organizationId/roles/:roleId/permissions` | `role.manage` |
| `DELETE /organizations/:organizationId/roles/:roleId` | `role.manage` |
| `GET /organizations/:organizationId/members` | `member.view` |
| `GET /organizations/:organizationId/members/:userId` | `member.view` |
| `PATCH /organizations/:organizationId/members/:userId/role` | `member.role.assign` |
| `DELETE /organizations/:organizationId/members/:userId` | `member.remove` |
| `GET /organizations/:organizationId/members/:userId/permissions` | self, or `member.view` |
| `PUT /organizations/:organizationId/members/:userId/permissions` | `member.permission.manage` |
| `GET /organizations/:organizationId/invitations` | `invite.view` |
| `POST /organizations/:organizationId/invitations` | `member.invite` |
| `POST /organizations/:organizationId/invitations/:invitationId/resend` | `invite.resend` |
| `DELETE /organizations/:organizationId/invitations/:invitationId` | `invite.revoke` |
| `GET /invitations/:token` | public preview |
| `POST /invitations/:token/accept` | authenticated, email must match |

Pagination is keyset-based and capped at 100 items:

- members: `limit`, `cursor`, optional `status`
- invitations: `limit`, `cursor`, `status` (`pending` default, plus
  `accepted`/`revoked`/`expired`/`all`)
- audit: `limit`, `cursor`

Role updates accept `name`, `description`, `rank`, `permissions`, `isDefault`.
Member overrides are **replaced wholesale** with `PUT`:

```json
{
  "overrides": [
    { "permissionKey": "issue.delete", "effect": "allow", "expiresAt": null },
    { "permissionKey": "member.remove", "effect": "deny", "reason": "contractor" }
  ]
}
```

Overrides are validated against the catalog and the anti-escalation rules, and
an `expiresAt` in the past is rejected rather than silently ignored.

## Authentication boundary

Authentication is deliberately deferred. Everything downstream consumes a
`Principal` and does not care how it was established.

```ts
// apps/api/src/auth/identity-provider.ts
export interface IdentityProvider {
  resolve(request: Request): Promise<Principal | null>;
}
```

- `AUTH_DRIVER=dev-header` (the default outside production) trusts
  `x-user-id: <uuid>` and looks up an **active** `users` row. It is development
  tooling, not authentication.
- In production, `AUTH_DRIVER` must name a real provider. The module throws at
  boot otherwise, and `dev-header` is rejected in production specifically.
- To integrate Better Auth / OIDC / a session cookie, implement
  `IdentityProvider.resolve`, register it in `AuthModule`, and set
  `AUTH_DRIVER`. Guards, controllers, policy checks and invite acceptance need
  no changes.
- `IdentityGuard` is a global `APP_GUARD`; `@Public()` opts a route out (only the
  invite preview uses it).
- `OrganizationAccessGuard` is the second gate. It attaches the resolved
  `OrganizationContext` to the request and enforces `@RequirePermission(...)`.
  Non-members get `403`, not `404`, because organization existence is itself
  information.

Invite acceptance requires an already-authenticated principal whose email
matches the invitation. **Creating the account remains the auth workstream's
job**; the endpoint does not accept a password or mint a session.

## Invitation lifecycle

```
created ──► pending ──► accepted        (membership created/activated)
              │  │
              │  └──► revoked          (explicit revoke, or role deleted)
              └─────► expired          (expires_at passes; no sweep needed)
```

Guarantees:

- The raw token is returned exactly once. Only its SHA-256 digest is stored
  (`token_hash`), so a database dump cannot be replayed.
- Tokens are 256 bits of `randomBytes`, base64url-encoded, and compared by
  indexed digest equality.
- A partial unique index allows at most one live invite per
  `(organization_id, email)`. Expired-but-unrevoked invites are revoked before a
  replacement is inserted, because a partial index cannot reference `now()`.
- Resend rotates the token and extends expiry; it never resurrects a
  revoked/accepted invite.
- Preview, accept and validation use one generic `INVITE_NOT_FOUND` for
  invalid, expired, revoked and accepted tokens, preventing probing.
- Accept is transactional and row-locks the invitation. It validates the role is
  still live, creates or reactivates the membership, copies non-expired targeted
  overrides, and marks the invite accepted.
- Overrides carried by an invite are filtered at acceptance: catalog keys only,
  and anything that expired while the invite sat in an inbox is dropped.
- Emails are normalized (trim + lowercase) for both storage and comparison.
- Accepted/revoked invites are retained for history; `send_count` and
  `last_sent_at` track delivery attempts.

Mail goes through `MailService` with a console transport today
(`MAIL_TRANSPORT=console`). The transport is a DI boundary; adding SMTP/Resend
does not touch the invitation service.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `AUTH_DRIVER` | `dev-header` outside prod | Selects the `IdentityProvider`; production fails closed |
| `WEB_APP_URL` | `http://localhost:3000` | Base URL for invite links, trimmed of trailing slashes |
| `INVITATION_TTL_DAYS` | `7` | Default and resend TTL, clamped to 1–30 |
| `MAIL_TRANSPORT` | `console` | Mail transport selection |
| `MAIL_FROM` | `Heddlio <no-reply@heddlio.local>` | Sender address |
| `SYNC_PERMISSION_CATALOG` | `true` | Set `false` when a migration job owns catalog writes |

## Migrations and deployment

The feature was shipped with expand/contract migrations, so it is safe to apply
against a live database:

| Migration | Purpose |
| --- | --- |
| `0002_first_stark_industries.sql` | Permission catalog, six roles per existing org, template grants, `role_id` backfill with a guarded `DO $$` block, invites/overrides/audit tables |
| `0003_married_frank_castle.sql` | `role_id` → `NOT NULL`, drop the legacy `organization_role` enum columns |
| `0004_misty_wilson_fisk.sql` | Replace simple role FKs with composite `(organization_id, role_id)` tenant-safe FKs |
| `0005_early_sentry.sql` | Member-list index `(organization_id, joined_at, user_id)` |

Order matters in `0004`: the `(organization_id, id)` unique index is created
before the composite FKs, because Postgres requires a matching unique target.

At boot the API syncs the catalog (upsert-only). Permission rows are never
deleted automatically — a key may still be referenced by a grant or audit row.
Removing one is a deliberate migration.

For production, run migrations as a separate job rather than from every API
instance, and set `SYNC_PERMISSION_CATALOG=false` if the API role should not
write to the catalog table.

## Tests

`apps/api/src/authorization/policy.spec.ts` covers the security invariants
without Nest or Postgres:

```bash
pnpm --filter api test
pnpm --filter api check-types
pnpm --filter api lint
pnpm --filter @heddlio/auth check-types
pnpm --filter @heddlio/db typecheck
```

The suite asserts catalog well-formedness, template ordering/subset properties,
owner short-circuiting, override precedence and expiry, and every escalation
predicate (manage/create/grant/assign/manage-member), plus token hashing and
email normalization.

## Known limitations and future work

- **No permission cache.** Every org-scoped request does three reads. Add a
  short-TTL Redis cache keyed by `(organizationId, userId)` and invalidate on
  member/role/override changes when traffic justifies it.
- **Audit writes are in-transaction but not immutable at the DB level.** Add a
  revoke/permission rule if operators should not be able to edit the table.
- **Invite email is not transactional.** The invitation row commits first, then
  mail is sent; a crash in between leaves a valid invite the recipient never
  received (resend fixes it). A transactional outbox is the durable fix.
- **No rate limiting** on the public preview/accept endpoints.
- **No expired-invite sweeper.** Expiry is evaluated at read time, so correctness
  does not depend on a job; a periodic cleanup would only reclaim rows.
- **No project/channel/board scoping.** All permissions are organization-wide.
- **No account creation in the invite flow.** Acceptance assumes the auth
  workstream has already signed the user up.
- **No UI.** Role editors and member permission screens can be built entirely
  from `GET /permissions` plus the endpoints above.

## File map

```
packages/auth/src/permissions.ts          catalog + six role templates
packages/auth/src/authorization.ts        pure resolver + policy predicates
packages/auth/src/invite-token.ts         token generation, hashing, email normalization
packages/db/src/schema/permission.schema.ts
packages/db/src/schema/organization.schema.ts
apps/api/src/auth/                        Principal, IdentityProvider, global guard
apps/api/src/authorization/               context resolution, guards, audit, catalog sync
apps/api/src/organizations/               org CRUD, ownership transfer, audit feed
apps/api/src/roles/                       role CRUD + permission replacement + seeding
apps/api/src/members/                     member list/get/role/remove/overrides
apps/api/src/invitations/                 invite lifecycle + public preview/accept
apps/api/src/mail/                        MailService + console transport
apps/api/src/common/                      ApiException/filter, cursors, decorators, slug
```

`@heddlio/auth` and `@heddlio/db` are compiled packages (`dist/`), not source
exports. Run `pnpm run dev` from the root, or
`pnpm --filter api build:deps` before starting the API directly, so their
`dist/` output is current.
