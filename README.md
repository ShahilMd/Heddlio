# Heddlio

Heddlio weaves conversations, boards, and work into one workspace.

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack.

## Features

- **TypeScript** - Type safety across every package and app
- **Turborepo** - Optimized monorepo builds and task orchestration
- **PostgreSQL + Drizzle ORM** - Typed schema and migrations in `packages/db`
- **NestJS API** - Production-ready backend in `apps/api`
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
- Run `docker compose down -v` only when you intentionally want to delete local database data.

## Project Structure

```
heddlio/
├── apps/
```

## Available Scripts

- `pnpm run dev`: Start all applications in development mode
- `pnpm run build`: Build all applications
- `pnpm run check-types`: Check TypeScript types across all apps
- `pnpm run backend`: Start the NestJS API
- `pnpm run web`: Start the web app
- `pnpm run admin`: Start the admin app
