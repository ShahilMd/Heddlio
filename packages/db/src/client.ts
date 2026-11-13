import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

import * as schema from "./schema/index.js";

export const createDb = (pool: Pool) => {
  return drizzle({
    client: pool,
    schema,
  });
};

export type Database = ReturnType<typeof createDb>;