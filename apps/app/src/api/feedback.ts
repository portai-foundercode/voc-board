import { Hono } from "hono";

import { validateCreateFeedback, validateFeedbackStatus } from "../domain/feedback";
import type { FeedbackRepository } from "../repositories/feedback-repository";

const validationError = (fields: Record<string, string>) => ({
  error: {
    code: "validation_error",
    message: "Check the highlighted fields.",
    fields,
  },
});

export const notFoundError = {
  error: {
    code: "not_found",
    message: "The requested resource was not found.",
  },
};

export const internalError = {
  error: {
    code: "internal_error",
    message: "An unexpected error occurred.",
  },
};

export function createFeedbackApi(repository: FeedbackRepository): Hono {
  const api = new Hono();

  api.onError((_error, context) => context.json(internalError, 500));

  api.post("/api/projects/:slug/feedback", async (context) => {
    const input = await context.req.json().catch(() => undefined);
    const validation = validateCreateFeedback(input);
    if (!validation.ok) return context.json(validationError(validation.fields), 400);

    const feedback = await repository.create(context.req.param("slug"), validation.value);
    return feedback ? context.json({ feedback }, 201) : context.json(notFoundError, 404);
  });

  api.get("/api/projects/:slug/feedback", async (context) => {
    const feedback = await repository.listByProjectSlug(context.req.param("slug"));
    return feedback ? context.json({ feedback }) : context.json(notFoundError, 404);
  });

  api.get("/api/projects/:slug/feedback/:id", async (context) => {
    const feedback = await repository.findByProjectSlugAndId(
      context.req.param("slug"),
      context.req.param("id"),
    );
    return feedback ? context.json({ feedback }) : context.json(notFoundError, 404);
  });

  api.patch("/api/projects/:slug/feedback/:id/status", async (context) => {
    const input = await context.req.json().catch(() => undefined);
    const status =
      typeof input === "object" && input !== null && !Array.isArray(input)
        ? (input as Record<string, unknown>).status
        : undefined;
    const validation = validateFeedbackStatus(status);
    if (!validation.ok) return context.json(validationError(validation.fields), 400);

    const feedback = await repository.updateStatusByProjectSlugAndId(
      context.req.param("slug"),
      context.req.param("id"),
      validation.value,
    );
    return feedback ? context.json({ feedback }) : context.json(notFoundError, 404);
  });

  return api;
}
