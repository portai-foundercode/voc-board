import { Hono } from "hono";

export function createApi() {
  return new Hono().get("/api/health", (context) => context.json({ status: "ok" as const }));
}
