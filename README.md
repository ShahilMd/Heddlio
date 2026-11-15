# Heddlio

Heddlio weaves conversations, boards, and work into one workspace.

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack.

## Features

- **TypeScript** - Type safety across every package and app
- **Turborepo** - Optimized monorepo builds and task orchestration
- **PostgreSQL + Drizzle ORM** - Typed schema and migrations in `packages/db`
- **NestJS API** - Production-ready backend in `apps/api`
- **Organization authorization** - Per-org roles, permission overrides, invitations and audit trail (see [`AUTHORIZATION.md`](./AUTHORIZATION.md))
- **Next.js** - Web and admin applications in `apps/web` and `apps/admin`

## Getting Started

Prerequisites: Node.js, pnpm, and Docker.

1. Install dependencies:

```bash
pnpm install
```

2. Create your local environment file and fill in the values:

```bash
cp .env.example .env
```

3. Start PostgreSQL:

```bash
docker compose up -d
```

4. Apply database migrations:

```bash
pnpm --filter @heddlio/db db:migrate
```

5. Start all applications:

```bash
pnpm run dev
```

## Environment Configuration

Configuration lives in a single root `.env` file. `.env` is gitignored; commit only `.env.example`.

- `POSTGRES_*` values configure the Docker database.
- `DATABASE_URL` is read by both the NestJS API and `drizzle-kit`, and must match the `POSTGRES_*` values and the published port.
- `AUTH_DRIVER` selects the identity provider. `dev-header` trusts an `x-user-id` header and is development-only; production must register a real provider.
- `WEB_APP_URL`, `INVITATION_TTL_DAYS`, `MAIL_TRANSPORT`, `MAIL_FROM` and `SYNC_PERMISSION_CATALOG` configure invitations and catalog sync.
- Run `docker compose down -v` only when you intentionally want to delete local database data.

## Documentation

- [`AUTHORIZATION_DIAGRAMS.md`](./AUTHORIZATION_DIAGRAMS.md) - visual guide: database ER diagram, request lifecycle, module map and use-case flows
- [`AUTHORIZATION.md`](./AUTHORIZATION.md) - roles, permissions, member overrides, invite lifecycle, auth boundary, endpoints and invariants
- [`packages/db/SCHEMA.md`](./packages/db/SCHEMA.md) - database schema, indexes and design decisions

## Project Structure

```
heddlio/
├── apps/
│   ├── api/          NestJS backend: auth boundary, organizations, roles, members, invites
│   ├── web/          Next.js web app
│   └── admin/        Next.js admin app
└── packages/
    ├── auth/         Permission catalog, role templates and policy predicates
    ├── db/           Drizzle schema, migrations and Postgres client
    ├── config/       Shared TypeScript config
    ├── types/        Shared types
    └── ui/           Shared UI components
```

## Available Scripts

- `pnpm run dev`: Start all applications in development mode
- `pnpm run build`: Build all applications
- `pnpm run check-types`: Check TypeScript types across all apps
- `pnpm run backend`: Start the NestJS API
- `pnpm run web`: Start the web app
- `pnpm run admin`: Start the admin app
