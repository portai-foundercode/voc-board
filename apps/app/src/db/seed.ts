import type { Kysely } from "kysely";

import type { Database } from "./database";

export async function seedDatabase(_db: Kysely<Database>): Promise<void> {
  throw new Error("Lesson 3 implementation is incomplete");
}
