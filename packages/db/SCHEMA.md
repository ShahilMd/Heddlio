# Database schema

Drizzle ORM + Postgres. Everything here lives in `packages/db` and is designed
for a Slack + Jira + Miro style product at production scale.

- **Source:** `src/schema/*.schema.ts` (matched by the drizzle-kit glob)
- **Relations:** `src/schema/relations.ts` (no DDL, registers the query graph)
- **Client:** `src/client.ts` → `createDb(pool)` → `db.query.*`
- **Migrations:** `drizzle/` — **generate and run these yourself**

```bash
pnpm --filter @heddlio/db typecheck     # tsc --noEmit
pnpm --filter @heddlio/db db:generate   # writes drizzle/0001_*.sql
pnpm --filter @heddlio/db db:migrate    # applies it
```

## Tables (24)

| Domain | Tables |
| --- | --- |
| Identity & tenancy | `users`, `organizations`, `organization_members`, `organization_invitations` |
| Messaging | `channels`, `channel_members`, `messages`, `message_reactions`, `message_mentions` |
| Work tracking | `projects`, `workflow_statuses`, `labels`, `issues`, `issue_comments`, `issue_labels`, `issue_links`, `issue_activity` |
| Whiteboard | `boards`, `board_members`, `board_objects` |
| Shared | `files`, `message_files`, `issue_files`, `notifications` |

## Design decisions

### 1. Every feature table carries `organization_id`

The workspace is the tenancy boundary. One extra column buys tenant isolation
in a single `WHERE`, cheap per-tenant partitioning later, and a workspace-wide
purge as one cascading delete. Do not add a table without it.

### 2. Two primary-key strategies, chosen by volume

| Strategy | Used by | Why |
| --- | --- | --- |
| `uuid` (`gen_random_uuid()`) | everything else | unguessable, globally unique, no coordination |
| `bigint GENERATED ALWAYS AS IDENTITY` | `messages`, `issue_activity` | these only ever grow. 8-byte keys halve every referencing index, and monotonic ids keep the PK B-tree **append-only** instead of scattering random uuids across pages |

`messages.id` doubles as the read cursor, an unread counter and a keyset
pagination token — one column doing four jobs.

### 3. Composite primary keys on join tables

`channel_members`, `message_reactions`, `message_mentions`, `issue_labels`,
`issue_links`, `board_members`, `message_files`, `issue_files`,
`organization_members` all use `(a, b)` keys. The pair *is* the identity, so
uniqueness is enforced by storage rather than by a second unique index, no
surrogate id ever needs referencing, and half the table is already an index.

### 4. Read state is an id, not a timestamp

`channel_members.last_read_message_id` → unread count is
`WHERE id > last_read` — one indexed comparison, no clock skew, correct across
edits and out-of-order delivery. It deliberately has **no** foreign key: an FK
would force the database to locate and lock this row on every message
hard-delete, which is write amplification on the busiest path for no benefit.

### 5. Denormalise only where it replaces an N+1

| Column | Replaces |
| --- | --- |
| `channels.last_message_at` / `last_message_preview` | one query per channel when rendering the sidebar |
| `messages.reply_count` / `last_reply_at` | a `COUNT(*)` per thread root |
| `message_mentions.channel_id` | a join onto `messages` for the unread-mentions badge |

Each is a single extra row update per write. Nothing else is denormalised —
if it does not remove a query, it does not get a copy.

### 6. Soft delete where history matters, `restrict` where data matters

- `messages.deleted_at`, `issues.deleted_at`, `issue_comments.deleted_at`,
  `board_objects.deleted_at` — moderation, undo, compliance.
- `issues.status_id` → `ON DELETE RESTRICT`: deleting a workflow column must
  move its issues first, never orphan them.
- `issues.reporter_id`, `issue_comments.user_id` → `RESTRICT`.
- Everything scoped to a workspace → `CASCADE`.
- Optional references (assignee, actor, uploader, board project) → `SET NULL`.

### 7. Enums for closed vocabularies, `varchar` for open ones

15 `pgEnum` types in `enums.schema.ts`. The exception is
`issue_activity.action` (`varchar(50)`): audit vocabulary grows with the
product and adding an enum value requires a migration, which audit code should
never be blocked on.

### 8. Indexes are written for the query, not for the column

Every index below is paired with a real query. **Postgres does not index
foreign keys** — each FK column here was indexed only if a query actually
filters on it, because every index is a tax on the insert path.

| Query | Index |
| --- | --- |
| Channel history / unread (`id > cursor`) | `messages (channel_id, id)` |
| Thread replies | `messages (thread_root_id, id) WHERE thread_root_id IS NOT NULL` |
| Retention / "since date" scans | `messages (created_at)` **BRIN** — kilobytes, not gigabytes |
| Workspace sidebar | `channels (organization_id, last_message_at)` |
| Unread mentions badge | `message_mentions (channel_id, user_id, message_id)` |
| Board render | `board_objects (board_id, z_index) WHERE deleted_at IS NULL` |
| Board column / backlog | `issues (project_id, status_id, rank)` |
| "My issues" | `issues (assignee_id, status_id) WHERE deleted_at IS NULL` |
| "Due this week" | `issues (due_date) WHERE deleted_at IS NULL AND due_date IS NOT NULL` |
| Issue search | `issues_search_gin` on the generated `search_vector` |
| Unread notification badge | `notifications (user_id) WHERE read_at IS NULL` |
| One live invite per address | `organization_invitations (organization_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL` |

Partial indexes (`WHERE ...`) are used aggressively: they index only the rows
the query cares about, which keeps them small, dense and cache-resident.

**Deliberately not indexed:** `notifications.channel_id / message_id /
issue_id / board_id` — touched only by rare cascade cleanups. Add them the day
a query filters on them.

### 9. Issue keys are derived, never stored

`ENG-142` = `<projects.key>-<projects.issue_sequence>`. The counter is bumped
with an atomic `UPDATE projects SET issue_sequence = issue_sequence + 1 ...
RETURNING` **inside the transaction that inserts the issue** — no
`SELECT MAX(sequence)` race, no separate counter table, no gaps.

### 10. Search is a generated column, not a second system

`issues.search_vector` is `GENERATED ALWAYS AS (...) STORED`, so it can never
drift from `title`/`description` and needs no trigger. Message search should
move to Meilisearch/Elasticsearch once history outgrows a single node — at
that point this column is the backfill source.

## What is intentionally NOT in the database

| Concern | Where it belongs | Why |
| --- | --- | --- |
| Presence, typing indicators, live cursors | **Redis** | ephemeral, sub-second churn, must not touch disk |
| Realtime message delivery | **WebSocket fan-out** (Redis pub/sub) | the DB is the source of truth, not the transport |
| Whiteboard undo/redo, CRDT state | **Redis / CRDT store**, snapshotted to `board_objects` | per-keystroke writes would destroy the write path |
| Refresh tokens / sessions | **Redis with TTL** | expiry is the feature; a table of dead rows is not |
| Rate-limit counters | **Redis** | hot counters, no durability needed |

## Post-deployment SQL (run by hand, not part of drizzle)

### `updated_at` trigger

Drizzle's `$onUpdate` only covers `db.update()` calls — it does **not** cover
raw SQL, migrations or other tools. This trigger makes the guarantee
unconditional:

```sql
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','organizations','projects','workflow_statuses','boards',
    'channels','issues','issue_comments','board_objects'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
  END LOOP;
END $$;
```

### Row-level security (add when you have more than one tenant in prod)

```sql
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON messages
  USING (organization_id = current_setting('app.org_id')::uuid);
```

`messages` would need `organization_id` denormalised first (a one-line column
plus a backfill) — do it before enabling RLS, not after.

## Scaling roadmap

Ordered by the point at which each one becomes necessary:

1. **Read replicas** — analytics, exports and `issue_activity` reads go to a
   replica; writes stay on the primary. No schema change.
2. **`messages` range partitioning** — when one channel's history makes index
   maintenance hurt. Partition by `created_at` monthly:

   ```sql
   -- NOTE: drizzle 0.45 cannot express partitioning, so this is a manual step,
   -- and it requires changing the PK to (id, created_at) first:
   ALTER TABLE messages ADD CONSTRAINT messages_pk PRIMARY KEY (id, created_at);
   CREATE TABLE messages_y2027m01 PARTITION OF messages
     FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
   ```

   The PK must include the partition key, which is why this is a roadmap item
   and not the starting design — doing it on day one taxes every insert for a
   problem you do not have yet.
3. **Per-tenant sharding** — `organization_id` is on every table precisely so
   this is a routing decision and not a rewrite.
4. **`board_objects` tiling** — if a single board ever exceeds ~50k objects,
   shard the canvas into tiles (`tile_x`, `tile_y`) so a viewport fetch reads
   a handful of tiles instead of the whole board.
5. **Search offload** — Meilisearch/Elasticsearch fed from
   `issues.search_vector` and the message stream.
