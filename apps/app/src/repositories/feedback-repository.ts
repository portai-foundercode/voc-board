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

export function createFeedbackRepository(_db: Kysely<Database>): FeedbackRepository {
  throw new Error("Lesson 3 implementation is incomplete");
}
