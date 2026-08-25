import type { Kysely } from "kysely";

type MigrationDatabase = {
  workspaces: { id: string; name: string; created_at: string };
  projects: { id: string; workspace_id: string; slug: string; name: string; created_at: string };
  feedback: {
    id: string;
    project_id: string;
    title: string;
    customer_name: string;
    customer_email: string;
    body: string;
    status: "new" | "reviewing" | "planned";
    created_at: string;
    updated_at: string;
  };
};

export async function up(_db: Kysely<MigrationDatabase>): Promise<void> {
  throw new Error("Lesson 3 implementation is incomplete");
}

export async function down(_db: Kysely<MigrationDatabase>): Promise<void> {
  throw new Error("Lesson 3 implementation is incomplete");
}
