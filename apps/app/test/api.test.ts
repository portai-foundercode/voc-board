import { afterEach, describe, expect, it, vi } from "vitest";

import { createApi } from "../src/api/app";
import type { FeedbackRepository } from "../src/repositories/feedback-repository";

const repository = (overrides: Partial<FeedbackRepository> = {}): FeedbackRepository => ({
  create: () => Promise.resolve(undefined),
  listByProjectSlug: () => Promise.resolve([]),
  findByProjectSlugAndId: () => Promise.resolve(undefined),
  updateStatusByProjectSlugAndId: () => Promise.resolve(undefined),
  ...overrides,
});

const createConfiguredApi = createApi as unknown as (dependencies: {
  repository: FeedbackRepository;
}) => ReturnType<typeof createApi>;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/health", () => {
  it("returns the local starter health response", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await createConfiguredApi({ repository: repository() }).request("/api/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });
});
