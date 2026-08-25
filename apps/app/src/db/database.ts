import type { Kysely } from "kysely";

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

export function createDatabase(_url: string): Kysely<Database> {
  throw new Error("Lesson 3 implementation is incomplete");
}
