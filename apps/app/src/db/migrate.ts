import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Kysely } from "kysely";
import { FileMigrationProvider, Migrator } from "kysely/migration";

import type { Database } from "./database";
import { createDatabase } from "./database";

export async function runMigrations(db: Kysely<Database>): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations"),
    }),
  });
  const { error } = await migrator.migrateToLatest();

  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to run migrations: ${message}`, { cause: error });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = createDatabase();
  try {
    await runMigrations(db);
  } finally {
    await db.destroy();
  }
}
