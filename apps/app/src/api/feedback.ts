import type { Hono } from "hono";

import type { FeedbackRepository } from "../repositories/feedback-repository";

export function createFeedbackApi(_repository: FeedbackRepository): Hono {
  throw new Error("Lesson 3 implementation is incomplete");
}
