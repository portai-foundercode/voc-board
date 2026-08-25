import { Hono } from "hono";

import { createDatabase } from "../db/database";
import { createFeedbackRepository } from "../repositories/feedback-repository";
import type { FeedbackRepository } from "../repositories/feedback-repository";
import { createFeedbackApi, internalError, notFoundError } from "./feedback";

type ApiDependencies = {
  repository: FeedbackRepository;
};

export function createDefaultDependencies(): ApiDependencies {
  const db = createDatabase();
  return { repository: createFeedbackRepository(db) };
}

export function createApi({ repository }: ApiDependencies = createDefaultDependencies()) {
  const api = new Hono();

  api.use("*", async (context, next) => {
    const startedAt = Date.now();
    await next();
    console.info(
      JSON.stringify({
        method: context.req.method,
        pathname: new URL(context.req.url).pathname,
        status: context.res.status,
        durationMs: Date.now() - startedAt,
      }),
    );
  });

  api.onError((_error, context) => context.json(internalError, 500));
  api.notFound((context) => context.json(notFoundError, 404));
  api.get("/api/health", (context) => context.json({ status: "ok" as const }));
  api.route("/", createFeedbackApi(repository));

  return api;
}
