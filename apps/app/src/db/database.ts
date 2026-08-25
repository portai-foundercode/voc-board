import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { LibsqlDialect } from "@libsql/kysely-libsql";
import type { Kysely } from "kysely";
import { Kysely as KyselyDatabase } from "kysely";

import type { FeedbackStatus } from "../domain/feedback";

export type WorkspaceTable = {
  id: string;
  name: string;
  created_at: string;
};

export type ProjectTable = {
  id: string;
  workspace_id: string;
  slug: string;
  name: string;
  created_at: string;
};

export type FeedbackTable = {
  id: string;
  project_id: string;
  title: string;
  customer_name: string;
  customer_email: string;
  body: string;
  status: FeedbackStatus;
  created_at: string;
  updated_at: string;
};

export type Database = {
  workspaces: WorkspaceTable;
  projects: ProjectTable;
  feedback: FeedbackTable;
};

export function createDatabase(url = "file:data/voc-board.db"): Kysely<Database> {
  if (url.startsWith("file:")) {
    const filePath = url.slice("file:".length).split(/[?#]/, 1)[0];
    if (filePath && filePath !== ":memory:") mkdirSync(dirname(filePath), { recursive: true });
  }

  return new KyselyDatabase<Database>({
    dialect: new LibsqlDialect({ url }),
  });
}
