import type { Kysely } from "kysely";

import type { Database } from "../db/database";
import type { CreateFeedbackInput, Feedback, FeedbackStatus } from "../domain/feedback";

export type FeedbackRepository = {
  create(projectSlug: string, input: CreateFeedbackInput): Promise<Feedback | undefined>;
  listByProjectSlug(projectSlug: string): Promise<Feedback[] | undefined>;
  findByProjectSlugAndId(projectSlug: string, id: string): Promise<Feedback | undefined>;
  updateStatusByProjectSlugAndId(
    projectSlug: string,
    id: string,
    status: FeedbackStatus,
  ): Promise<Feedback | undefined>;
};

const feedbackSelection = [
  "id",
  "project_id as projectId",
  "title",
  "customer_name as name",
  "customer_email as email",
  "body",
  "status",
  "created_at as createdAt",
  "updated_at as updatedAt",
] as const;

export function createFeedbackRepository(db: Kysely<Database>): FeedbackRepository {
  async function findProjectId(projectSlug: string) {
    const project = await db
      .selectFrom("projects")
      .select("id")
      .where("workspace_id", "=", "ws-acme")
      .where("slug", "=", projectSlug)
      .executeTakeFirst();
    return project?.id;
  }

  return {
    async create(projectSlug, input) {
      const projectId = await findProjectId(projectSlug);
      if (!projectId) return undefined;

      const timestamp = new Date().toISOString();
      return await db
        .insertInto("feedback")
        .values({
          id: crypto.randomUUID(),
          project_id: projectId,
          title: input.title,
          customer_name: input.name,
          customer_email: input.email,
          body: input.body,
          status: "new",
          created_at: timestamp,
          updated_at: timestamp,
        })
        .returning(feedbackSelection)
        .executeTakeFirstOrThrow();
    },

    async listByProjectSlug(projectSlug) {
      const projectId = await findProjectId(projectSlug);
      if (!projectId) return undefined;

      return await db
        .selectFrom("feedback")
        .select(feedbackSelection)
        .where("project_id", "=", projectId)
        .orderBy("created_at", "desc")
        .execute();
    },

    async findByProjectSlugAndId(projectSlug, id) {
      const projectId = await findProjectId(projectSlug);
      if (!projectId) return undefined;

      return await db
        .selectFrom("feedback")
        .select(feedbackSelection)
        .where("project_id", "=", projectId)
        .where("id", "=", id)
        .executeTakeFirst();
    },

    async updateStatusByProjectSlugAndId(projectSlug, id, status) {
      const projectId = await findProjectId(projectSlug);
      if (!projectId) return undefined;

      return await db
        .updateTable("feedback")
        .set({ status, updated_at: new Date().toISOString() })
        .where("project_id", "=", projectId)
        .where("id", "=", id)
        .returning(feedbackSelection)
        .executeTakeFirst();
    },
  };
}
