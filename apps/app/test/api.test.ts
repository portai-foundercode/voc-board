import { describe, expect, it } from "vitest";
import { createApi } from "../src/api/app";

describe("GET /api/health", () => {
  it("returns the local starter health response", async () => {
    const response = await createApi().request("/api/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });
});
