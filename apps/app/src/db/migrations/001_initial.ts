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

export async function up(db: Kysely<MigrationDatabase>): Promise<void> {
  await db.schema
    .createTable("workspaces")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("name", "text", (column) => column.notNull())
    .addColumn("created_at", "text", (column) => column.notNull())
    .execute();

  await db.schema
    .createTable("projects")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("workspace_id", "text", (column) => column.notNull().references("workspaces.id"))
    .addColumn("slug", "text", (column) => column.notNull())
    .addColumn("name", "text", (column) => column.notNull())
    .addColumn("created_at", "text", (column) => column.notNull())
    .execute();

  await db.schema
    .createIndex("projects_workspace_id_slug_unique")
    .unique()
    .on("projects")
    .columns(["workspace_id", "slug"])
    .execute();

  await db.schema
    .createTable("feedback")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("project_id", "text", (column) => column.notNull().references("projects.id"))
    .addColumn("title", "text", (column) => column.notNull())
    .addColumn("customer_name", "text", (column) => column.notNull())
    .addColumn("customer_email", "text", (column) => column.notNull())
    .addColumn("body", "text", (column) => column.notNull())
    .addColumn("status", "text", (column) => column.notNull())
    .addColumn("created_at", "text", (column) => column.notNull())
    .addColumn("updated_at", "text", (column) => column.notNull())
    .execute();

  await db.schema
    .createIndex("feedback_project_id_index")
    .on("feedback")
    .column("project_id")
    .execute();
  await db.schema
    .createIndex("feedback_created_at_index")
    .on("feedback")
    .column("created_at")
    .execute();
}

export async function down(db: Kysely<MigrationDatabase>): Promise<void> {
  await db.schema.dropTable("feedback").execute();
  await db.schema.dropTable("projects").execute();
  await db.schema.dropTable("workspaces").execute();
}
