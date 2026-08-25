import { fileURLToPath } from "node:url";

import type { Kysely } from "kysely";

import type { Database } from "./database";
import { createDatabase } from "./database";

const createdAt = "2026-08-25T00:00:00.000Z";

export async function seedDatabase(db: Kysely<Database>): Promise<void> {
  await db.transaction().execute(async (transaction) => {
    await transaction
      .insertInto("workspaces")
      .values({ id: "ws-acme", name: "Acme", created_at: createdAt })
      .onConflict((conflict) => conflict.doNothing())
      .execute();

    await transaction
      .insertInto("projects")
      .values({
        id: "project-acme",
        workspace_id: "ws-acme",
        slug: "acme",
        name: "Acme Feedback",
        created_at: createdAt,
      })
      .onConflict((conflict) => conflict.doNothing())
      .execute();

    await transaction
      .insertInto("feedback")
      .values([
        {
          id: "feedback-001",
          project_id: "project-acme",
          title: "CSV export",
          customer_name: "Taro Yamada",
          customer_email: "taro@example.com",
          body: "Please add CSV export.",
          status: "new",
          created_at: "2026-08-25T00:00:00.000Z",
          updated_at: "2026-08-25T00:00:00.000Z",
        },
        {
          id: "feedback-002",
          project_id: "project-acme",
          title: "Saved searches",
          customer_name: "Hanako Sato",
          customer_email: "hanako@example.com",
          body: "Please let me save search filters.",
          status: "reviewing",
          created_at: "2026-08-24T00:00:00.000Z",
          updated_at: "2026-08-24T00:00:00.000Z",
        },
        {
          id: "feedback-003",
          project_id: "project-acme",
          title: "Weekly reports",
          customer_name: "Akira Suzuki",
          customer_email: "akira@example.com",
          body: "Please add shareable weekly reports.",
          status: "planned",
          created_at: "2026-08-23T00:00:00.000Z",
          updated_at: "2026-08-23T00:00:00.000Z",
        },
      ])
      .onConflict((conflict) => conflict.doNothing())
      .execute();
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = createDatabase();
  try {
    await seedDatabase(db);
  } finally {
    await db.destroy();
  }
}
