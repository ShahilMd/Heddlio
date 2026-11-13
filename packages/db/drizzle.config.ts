import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";

// Load the monorepo root .env file
const currentDir = dirname(fileURLToPath(import.meta.url));

config({
  path: resolve(currentDir, "../../.env"),
});

export default defineConfig({
  dialect: "postgresql",

  schema: "./src/schema/**/*.schema.ts",

  out: "./drizzle",

  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },

  verbose: true,

  strict: true,
});