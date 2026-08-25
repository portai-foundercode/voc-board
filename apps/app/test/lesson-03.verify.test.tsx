import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { sql } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApi } from "../src/api/app";
import { createFeedbackApi } from "../src/api/feedback";
import {
  createFeedback,
  getFeedback,
  listFeedback,
  updateFeedbackStatus,
} from "../src/data/feedback-api";
import { createDatabase } from "../src/db/database";
import { runMigrations } from "../src/db/migrate";
import { down } from "../src/db/migrations/001_initial";
import { seedDatabase } from "../src/db/seed";
import {
  validateCreateFeedback,
  validateFeedbackStatus,
  type CreateFeedbackInput,
  type Feedback,
} from "../src/domain/feedback";
import {
  createFeedbackRepository,
  type FeedbackRepository,
} from "../src/repositories/feedback-repository";
import { routeTree } from "../src/routeTree.gen";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const validInput: CreateFeedbackInput = {
  title: "CSV export",
  name: "Taro Yamada",
  email: "taro@example.com",
  body: "Please add CSV export.",
};

const repositoryStub = (overrides: Partial<FeedbackRepository> = {}): FeedbackRepository => ({
  create: () => Promise.resolve(undefined),
  listByProjectSlug: () => Promise.resolve([]),
  findByProjectSlugAndId: () => Promise.resolve(undefined),
  updateStatusByProjectSlugAndId: () => Promise.resolve(undefined),
  ...overrides,
});

const createConfiguredApi = createApi as unknown as (dependencies: {
  repository: FeedbackRepository;
}) => ReturnType<typeof createApi>;

const createDefaultDatabase = createDatabase as unknown as () => ReturnType<typeof createDatabase>;

async function withDatabase<T>(run: (db: ReturnType<typeof createDatabase>) => Promise<T>) {
  const directory = mkdtempSync(join(tmpdir(), "voc-board-lesson-03-"));
  let db: ReturnType<typeof createDatabase> | undefined;
  try {
    db = createDatabase(`file:${join(directory, "test.db")}`);
    await runMigrations(db);
    return await run(db);
  } finally {
    await db?.destroy();
    rmSync(directory, { force: true, recursive: true });
  }
}

async function renderPath(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(router.state.status).toBe("idle"));
  return router;
}

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const feedbackFixture: Feedback = {
  id: "fb-test",
  projectId: "project-acme",
  title: "CSV export",
  name: "Taro Yamada",
  email: "taro@example.com",
  body: "Please add CSV export.",
  status: "new",
  createdAt: "2026-08-25T00:00:00.000Z",
  updatedAt: "2026-08-25T00:00:00.000Z",
};

function fillPublicForm(input: CreateFeedbackInput = validInput) {
  fireEvent.change(screen.getByLabelText("タイトル"), { target: { value: input.title } });
  fireEvent.change(screen.getByLabelText("名前"), { target: { value: input.name } });
  fireEvent.change(screen.getByLabelText("メール"), { target: { value: input.email } });
  fireEvent.change(screen.getByLabelText("フィードバック"), {
    target: { value: input.body },
  });
}

describe("Lesson 03 migration and seed", () => {
  it("applies the migration and keeps the seed idempotent", async () => {
    await withDatabase(async (db) => {
      await seedDatabase(db);
      await seedDatabase(db);

      const [workspaces, projects, feedback] = await Promise.all([
        db
          .selectFrom("workspaces")
          .select(({ fn }) => fn.countAll<number>().as("count"))
          .executeTakeFirstOrThrow(),
        db
          .selectFrom("projects")
          .select(({ fn }) => fn.countAll<number>().as("count"))
          .executeTakeFirstOrThrow(),
        db
          .selectFrom("feedback")
          .select(({ fn }) => fn.countAll<number>().as("count"))
          .executeTakeFirstOrThrow(),
      ]);

      expect([Number(workspaces.count), Number(projects.count), Number(feedback.count)]).toEqual([
        1, 1, 3,
      ]);
    });
  });

  it("creates the parent directory when the default local database is migrated", async () => {
    const directory = mkdtempSync(join(tmpdir(), "voc-board-default-database-"));
    const previousDirectory = process.cwd();
    let db: ReturnType<typeof createDatabase> | undefined;

    try {
      process.chdir(directory);
      db = createDefaultDatabase();
      await runMigrations(db);

      expect(existsSync(join(directory, "data", "voc-board.db"))).toBe(true);
    } finally {
      await db?.destroy();
      process.chdir(previousDirectory);
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("keeps in-memory database URLs usable", async () => {
    const db = createDatabase("file::memory:");

    try {
      await runMigrations(db);
      const tables = await db.introspection.getTables();
      expect(tables.map((table) => table.name)).toContain("feedback");
    } finally {
      await db.destroy();
    }
  });

  it("creates the required foreign keys, unique project slug, and feedback indexes", async () => {
    await withDatabase(async (db) => {
      const projectForeignKeys = await sql<{ from: string; table: string; to: string }>`
        PRAGMA foreign_key_list(projects)
      `.execute(db);
      const feedbackForeignKeys = await sql<{ from: string; table: string; to: string }>`
        PRAGMA foreign_key_list(feedback)
      `.execute(db);
      expect(projectForeignKeys.rows).toContainEqual(
        expect.objectContaining({ from: "workspace_id", table: "workspaces", to: "id" }),
      );
      expect(feedbackForeignKeys.rows).toContainEqual(
        expect.objectContaining({ from: "project_id", table: "projects", to: "id" }),
      );

      await db
        .insertInto("workspaces")
        .values({ id: "ws-test", name: "Test", created_at: "2026-08-25T00:00:00.000Z" })
        .execute();
      await db
        .insertInto("projects")
        .values({
          id: "project-test",
          workspace_id: "ws-test",
          slug: "same-slug",
          name: "Test",
          created_at: "2026-08-25T00:00:00.000Z",
        })
        .execute();
      await expect(
        db
          .insertInto("projects")
          .values({
            id: "project-duplicate",
            workspace_id: "ws-test",
            slug: "same-slug",
            name: "Duplicate",
            created_at: "2026-08-25T00:00:00.000Z",
          })
          .execute(),
      ).rejects.toThrow();

      const feedbackIndexes = await sql<{ name: string }>`PRAGMA index_list(feedback)`.execute(db);
      expect(feedbackIndexes.rows.map(({ name }) => name)).toEqual(
        expect.arrayContaining(["feedback_project_id_index", "feedback_created_at_index"]),
      );
      const projectIndex = await sql<{ name: string }>`
        PRAGMA index_info('projects_workspace_id_slug_unique')
      `.execute(db);
      expect(projectIndex.rows.map(({ name }) => name)).toEqual(["workspace_id", "slug"]);
    });
  });

  it("drops the application tables in the down migration", async () => {
    await withDatabase(async (db) => {
      await down(db);
      const tableNames = (await db.introspection.getTables()).map(({ name }) => name);
      expect(tableNames).not.toEqual(
        expect.arrayContaining(["workspaces", "projects", "feedback"]),
      );
    });
  });
});

describe("Lesson 03 validation", () => {
  it("trims valid feedback and accepts exact maximum lengths", () => {
    expect(
      validateCreateFeedback({
        title: ` ${"t".repeat(100)} `,
        name: ` ${"n".repeat(80)} `,
        email: " learner@example.com ",
        body: ` ${"b".repeat(2_000)} `,
      }),
    ).toEqual({
      ok: true,
      value: {
        title: "t".repeat(100),
        name: "n".repeat(80),
        email: "learner@example.com",
        body: "b".repeat(2_000),
      },
    });
  });

  it.each([
    {
      name: "title over 100 characters",
      input: { ...validInput, title: "t".repeat(101) },
      field: "title",
    },
    {
      name: "name over 80 characters",
      input: { ...validInput, name: "n".repeat(81) },
      field: "name",
    },
    { name: "malformed email", input: { ...validInput, email: "invalid" }, field: "email" },
    {
      name: "email over 254 characters",
      input: { ...validInput, email: `${"a".repeat(243)}@example.com` },
      field: "email",
    },
    {
      name: "body over 2,000 characters",
      input: { ...validInput, body: "b".repeat(2_001) },
      field: "body",
    },
  ])("rejects $name", ({ input, field }) => {
    const result = validateCreateFeedback(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fields).toHaveProperty(field);
  });

  it.each(
    (["title", "name", "email", "body"] as const).flatMap((field) => [
      { field, label: `${field} empty`, value: "" },
      { field, label: `${field} whitespace`, value: " \t " },
      { field, label: `${field} non-string`, value: 42 },
    ]),
  )("rejects $label", ({ field, value }) => {
    const result = validateCreateFeedback({ ...validInput, [field]: value });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fields).toHaveProperty(field);
  });

  it("accepts only the three feedback statuses", () => {
    for (const status of ["new", "reviewing", "planned"]) {
      expect(validateFeedbackStatus(status)).toEqual({ ok: true, value: status });
    }
    expect(validateFeedbackStatus("closed")).toEqual({
      ok: false,
      fields: { status: expect.any(String) },
    });
  });
});

describe("Lesson 03 repository project scope", () => {
  it("does not create, list, find, or update feedback through another project", async () => {
    await withDatabase(async (db) => {
      await seedDatabase(db);
      await db
        .insertInto("projects")
        .values({
          id: "project-other",
          workspace_id: "ws-acme",
          slug: "other",
          name: "Other",
          created_at: "2026-08-25T00:00:00.000Z",
        })
        .execute();
      const repository = createFeedbackRepository(db);
      expect(await repository.create("missing", validInput)).toBeUndefined();

      const created = await repository.create("acme", validInput);
      const otherInput = { ...validInput, title: "Other project feedback" };
      const createdForOther = await repository.create("other", otherInput);

      expect(created).toMatchObject({ projectId: "project-acme", ...validInput, status: "new" });
      expect(createdForOther).toMatchObject({
        projectId: "project-other",
        ...otherInput,
        status: "new",
      });
      expect(await repository.listByProjectSlug("acme")).not.toContainEqual(
        expect.objectContaining({ id: createdForOther!.id }),
      );
      expect(await repository.findByProjectSlugAndId("other", created!.id)).toBeUndefined();
      expect(
        await repository.updateStatusByProjectSlugAndId("other", created!.id, "planned"),
      ).toBeUndefined();
      const otherFeedback = await repository.listByProjectSlug("other");
      expect(otherFeedback).toEqual([
        expect.objectContaining({ id: createdForOther!.id, projectId: "project-other" }),
      ]);
      expect(otherFeedback).not.toContainEqual(expect.objectContaining({ id: created!.id }));
      expect(await repository.findByProjectSlugAndId("acme", created!.id)).toMatchObject({
        id: created!.id,
        status: "new",
      });
    });
  });

  it("uses only the Acme workspace when another workspace has the same project slug", async () => {
    await withDatabase(async (db) => {
      await db
        .insertInto("workspaces")
        .values({
          id: "ws-other",
          name: "Other Workspace",
          created_at: "2026-08-25T00:00:00.000Z",
        })
        .execute();
      await db
        .insertInto("projects")
        .values({
          id: "project-other-acme",
          workspace_id: "ws-other",
          slug: "acme",
          name: "Other Acme",
          created_at: "2026-08-25T00:00:00.000Z",
        })
        .execute();
      await seedDatabase(db);
      await db
        .insertInto("feedback")
        .values({
          id: "feedback-other-acme",
          project_id: "project-other-acme",
          title: "Other workspace feedback",
          customer_name: "Other Customer",
          customer_email: "other@example.com",
          body: "This feedback belongs to another workspace.",
          status: "new",
          created_at: "2026-08-26T00:00:00.000Z",
          updated_at: "2026-08-26T00:00:00.000Z",
        })
        .execute();

      const repository = createFeedbackRepository(db);
      const created = await repository.create("acme", validInput);

      expect(created).toMatchObject({ projectId: "project-acme" });
      expect(await repository.listByProjectSlug("acme")).not.toContainEqual(
        expect.objectContaining({ id: "feedback-other-acme" }),
      );
      expect(
        await repository.findByProjectSlugAndId("acme", "feedback-other-acme"),
      ).toBeUndefined();
      expect(
        await repository.updateStatusByProjectSlugAndId("acme", "feedback-other-acme", "planned"),
      ).toBeUndefined();
      expect(
        await db
          .selectFrom("feedback")
          .select("status")
          .where("id", "=", "feedback-other-acme")
          .executeTakeFirstOrThrow(),
      ).toEqual({ status: "new" });
    });
  });

  it("lists feedback from newest to oldest", async () => {
    await withDatabase(async (db) => {
      await seedDatabase(db);
      const feedback = await createFeedbackRepository(db).listByProjectSlug("acme");
      expect(feedback?.map(({ id }) => id)).toEqual([
        "feedback-001",
        "feedback-002",
        "feedback-003",
      ]);
    });
  });

  it("persists created and updated feedback after reopening the database file", async () => {
    const directory = mkdtempSync(join(tmpdir(), "voc-board-persistence-"));
    const url = `file:${join(directory, "test.db")}`;
    let db = createDatabase(url);

    try {
      await runMigrations(db);
      await seedDatabase(db);
      const repository = createFeedbackRepository(db);
      const created = await repository.create("acme", validInput);
      expect(created).toBeDefined();
      await repository.updateStatusByProjectSlugAndId("acme", created!.id, "planned");
      await db.destroy();

      db = createDatabase(url);
      const reopened = await createFeedbackRepository(db).findByProjectSlugAndId(
        "acme",
        created!.id,
      );
      expect(reopened).toMatchObject({ ...validInput, id: created!.id, status: "planned" });
    } finally {
      await db.destroy();
      rmSync(directory, { force: true, recursive: true });
    }
  });
});

describe("Lesson 03 API", () => {
  it("serves create, list, detail, and status update responses", async () => {
    await withDatabase(async (db) => {
      await seedDatabase(db);
      const api = createFeedbackApi(createFeedbackRepository(db));

      const createdResponse = await api.request("/api/projects/acme/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validInput),
      });
      expect(createdResponse.status).toBe(201);
      const created = (await createdResponse.json()) as { feedback: Feedback };
      expect(created.feedback).toMatchObject({ ...validInput, status: "new" });

      const listResponse = await api.request("/api/projects/acme/feedback");
      expect(listResponse.status).toBe(200);
      expect(((await listResponse.json()) as { feedback: Feedback[] }).feedback).toContainEqual(
        expect.objectContaining({ id: created.feedback.id }),
      );

      const detailResponse = await api.request(
        `/api/projects/acme/feedback/${created.feedback.id}`,
      );
      expect(detailResponse.status).toBe(200);

      const updateResponse = await api.request(
        `/api/projects/acme/feedback/${created.feedback.id}/status`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "planned" }),
        },
      );
      expect(updateResponse.status).toBe(200);
      expect(((await updateResponse.json()) as { feedback: Feedback }).feedback.status).toBe(
        "planned",
      );
    });
  });

  it("returns structured 400 and 404 errors", async () => {
    await withDatabase(async (db) => {
      await seedDatabase(db);
      await db
        .insertInto("projects")
        .values({
          id: "project-other",
          workspace_id: "ws-acme",
          slug: "other",
          name: "Other",
          created_at: "2026-08-25T00:00:00.000Z",
        })
        .execute();
      const repository = createFeedbackRepository(db);
      const created = await repository.create("acme", validInput);
      const api = createFeedbackApi(repository);

      const invalid = await api.request("/api/projects/acme/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...validInput, email: "invalid" }),
      });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({
        error: {
          code: expect.any(String),
          message: expect.any(String),
          fields: { email: expect.any(String) },
        },
      });

      const invalidStatus = await api.request(`/api/projects/acme/feedback/${created!.id}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "closed" }),
      });
      expect(invalidStatus.status).toBe(400);
      expect(await invalidStatus.json()).toMatchObject({
        error: {
          code: expect.any(String),
          message: expect.any(String),
          fields: { status: expect.any(String) },
        },
      });

      const missingCreate = await api.request("/api/projects/missing/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validInput),
      });
      expect(missingCreate.status).toBe(404);

      for (const path of [
        "/api/projects/missing/feedback",
        "/api/projects/acme/feedback/missing",
      ]) {
        const missing = await api.request(path);
        expect(missing.status).toBe(404);
        expect(await missing.json()).toMatchObject({
          error: { code: expect.any(String), message: expect.any(String) },
        });
      }

      for (const path of [
        `/api/projects/missing/feedback/${created!.id}/status`,
        `/api/projects/other/feedback/${created!.id}/status`,
      ]) {
        const missing = await api.request(path, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "planned" }),
        });
        expect(missing.status).toBe(404);
        expect(await missing.json()).toMatchObject({
          error: { code: expect.any(String), message: expect.any(String) },
        });
      }
    });
  });

  it.each([
    { path: "/api/does-not-exist", method: "GET" },
    { path: "/api/projects/acme/feedback", method: "DELETE" },
  ])("returns the JSON error envelope for $method $path", async ({ path, method }) => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await createConfiguredApi({ repository: repositoryStub() }).request(path, {
      method,
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "not_found", message: expect.any(String) },
    });
  });

  it("hides repository exception details from 500 responses", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const api = createConfiguredApi({
      repository: repositoryStub({
        listByProjectSlug: () => Promise.reject(new Error("secret database path")),
      }),
    });

    const response = await api.request("/api/projects/acme/feedback");
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(body)).toMatchObject({
      error: { code: "internal_error", message: expect.any(String) },
    });
    expect(body).not.toContain("secret database path");
  });

  it("logs only request metadata without personal information", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const api = createConfiguredApi({ repository: repositoryStub() });

    await api.request("/api/projects/acme/feedback?email=query@example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Private request",
        name: "Private Name",
        email: "private@example.com",
        body: "Private body",
      }),
    });

    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toEqual({
      method: "POST",
      pathname: "/api/projects/acme/feedback",
      status: 404,
      durationMs: expect.any(Number),
    });
    expect(line).not.toContain("Private Name");
    expect(line).not.toContain("private@example.com");
    expect(line).not.toContain("Private body");
    expect(line).not.toContain("query@example.com");
  });
});

describe("Lesson 03 feedback client", () => {
  it("preserves status and body for a malformed non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(response({}, 503))),
    );

    const failure = await listFeedback("acme").catch((error: unknown) => error);

    expect(failure).toMatchObject({ name: "ApiError", status: 503, body: {} });
  });

  it("rejects invalid JSON from a successful response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response("{", { status: 200, headers: { "content-type": "application/json" } }),
        ),
      ),
    );

    await expect(listFeedback("acme")).rejects.toThrow("Invalid API response");
  });

  it.each([
    {
      label: "create",
      body: { feedback: null },
      request: () => createFeedback("acme", validInput),
    },
    {
      label: "list",
      body: { feedback: feedbackFixture },
      request: () => listFeedback("acme"),
    },
    {
      label: "detail",
      body: { feedback: { ...feedbackFixture, email: 42 } },
      request: () => getFeedback("acme", "fb-test"),
    },
    {
      label: "status update",
      body: {},
      request: () => updateFeedbackStatus("acme", "fb-test", "planned"),
    },
  ])("rejects a malformed successful $label envelope", async ({ body, request }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(response(body))),
    );
    await expect(request()).rejects.toThrow("Invalid API response");
  });
});

describe("Lesson 03 screens", () => {
  it("shows the list loading state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    await renderPath("/app/feedback");
    expect(screen.getByText("読み込み中")).toBeInTheDocument();
  });

  it("retries the list request and replaces the error with feedback", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ error: { code: "internal_error", message: "Error" } }, 500))
      .mockResolvedValueOnce(response({ feedback: [feedbackFixture] }));
    vi.stubGlobal("fetch", fetchMock);
    await renderPath("/app/feedback");
    expect(await screen.findByText("読み込みに失敗しました")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "再試行" }));

    expect(await screen.findByRole("link", { name: "CSV export" })).toBeInTheDocument();
    expect(screen.queryByText("読み込みに失敗しました")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows the list error state while waiting for retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(response({ error: { code: "internal_error", message: "Error" } }, 500)),
    );
    await renderPath("/app/feedback");
    expect(await screen.findByText("読み込みに失敗しました")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
  });

  it.each([
    { label: "empty body", body: {} },
    { label: "missing error message", body: { error: { code: "internal_error" } } },
  ])("shows a general screen error for a malformed $label", async ({ body }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(response(body, 500))),
    );

    await renderPath("/app/feedback");
    expect(await screen.findByText("読み込みに失敗しました")).toBeInTheDocument();
  });

  it("shows feedback returned by the list API", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ feedback: [feedbackFixture] })));
    await renderPath("/app/feedback");
    expect(await screen.findByRole("link", { name: "CSV export" })).toBeInTheDocument();
    expect(screen.getAllByTestId("feedback-row")).toHaveLength(1);
  });

  it("shows the detail loading state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    await renderPath("/app/feedback/fb-test");
    expect(screen.getByText("読み込み中")).toBeInTheDocument();
  });

  it("shows the detail not-found state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(response({ error: { code: "not_found", message: "Not found" } }, 404)),
      ),
    );
    await renderPath("/app/feedback/missing");
    expect(await screen.findByText("フィードバックが見つかりません")).toBeInTheDocument();
  });

  it("retries a general detail error", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ error: { code: "internal_error", message: "Error" } }, 500))
      .mockResolvedValueOnce(response({ feedback: feedbackFixture }));
    vi.stubGlobal("fetch", fetchMock);
    await renderPath("/app/feedback/fb-test");
    expect(await screen.findByText("読み込みに失敗しました")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "再試行" }));

    expect(await screen.findByRole("heading", { name: "CSV export" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("submits the public feedback form", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ feedback: feedbackFixture }, 201));
    vi.stubGlobal("fetch", fetchMock);
    await renderPath("/p/acme");
    fillPublicForm();
    fireEvent.click(screen.getByRole("button", { name: "送信する" }));
    expect(await screen.findByText("フィードバックを受け付けました")).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/projects/acme/feedback");
    expect(init).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(init?.body))).toEqual(validInput);
  });

  it("disables the public submit button while the request is pending", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    await renderPath("/p/acme");
    fillPublicForm();

    const button = screen.getByRole("button", { name: "送信する" });
    fireEvent.click(button);

    expect(button).toBeDisabled();
    expect(screen.queryByText("フィードバックを受け付けました")).not.toBeInTheDocument();
  });

  it("shows field errors from a 400 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          response(
            {
              error: {
                code: "invalid_input",
                message: "Invalid input",
                fields: { title: "Title is required." },
              },
            },
            400,
          ),
        ),
      ),
    );
    await renderPath("/p/acme");
    fillPublicForm();
    fireEvent.click(screen.getByRole("button", { name: "送信する" }));

    expect(await screen.findByText("Title is required.")).toBeInTheDocument();
    expect(screen.getByLabelText("名前")).toHaveValue(validInput.name);
    expect(screen.queryByText("フィードバックを受け付けました")).not.toBeInTheDocument();
  });

  it("shows a general public form error for a 500 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(response({ error: { code: "internal_error", message: "Error" } }, 500)),
      ),
    );
    await renderPath("/p/acme");
    fillPublicForm();
    fireEvent.click(screen.getByRole("button", { name: "送信する" }));

    expect(await screen.findByText("送信に失敗しました")).toBeInTheDocument();
    expect(screen.queryByText("フィードバックを受け付けました")).not.toBeInTheDocument();
  });

  it("resets public form values when the project slug changes", async () => {
    const router = await renderPath("/p/acme");
    fillPublicForm();

    await act(() => router.navigate({ to: "/p/$projectSlug", params: { projectSlug: "other" } }));

    await waitFor(() => expect(screen.getByText(/other チーム/)).toBeInTheDocument());
    expect(screen.getByLabelText("タイトル")).toHaveValue("");
    expect(screen.getByLabelText("名前")).toHaveValue("");
    expect(screen.getByLabelText("メール")).toHaveValue("");
    expect(screen.getByLabelText("フィードバック")).toHaveValue("");
  });

  it("does not show old customer data while a new detail route is loading", async () => {
    const nextResponse = deferred<Response>();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ feedback: feedbackFixture }))
      .mockImplementationOnce(() => nextResponse.promise);
    vi.stubGlobal("fetch", fetchMock);
    const router = await renderPath("/app/feedback/fb-test");
    expect(await screen.findByText(/Taro Yamada/)).toBeInTheDocument();

    await act(() =>
      router.navigate({ to: "/app/feedback/$feedbackId", params: { feedbackId: "fb-next" } }),
    );

    expect(screen.getByText("読み込み中")).toBeInTheDocument();
    expect(screen.queryByText(/Taro Yamada/)).not.toBeInTheDocument();
    expect(screen.queryByText(/taro@example.com/)).not.toBeInTheDocument();
    expect(screen.queryByText(validInput.body)).not.toBeInTheDocument();
  });

  it("ignores a stale detail response after the route changes", async () => {
    const oldResponse = deferred<Response>();
    const newResponse = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockImplementationOnce(() => oldResponse.promise)
        .mockImplementationOnce(() => newResponse.promise),
    );
    const router = await renderPath("/app/feedback/fb-old");

    await act(() =>
      router.navigate({ to: "/app/feedback/$feedbackId", params: { feedbackId: "fb-new" } }),
    );
    await act(() => oldResponse.resolve(response({ feedback: feedbackFixture })));
    expect(screen.queryByText(/Taro Yamada/)).not.toBeInTheDocument();

    const newFeedback = {
      ...feedbackFixture,
      id: "fb-new",
      title: "New route feedback",
      name: "New Customer",
      email: "new@example.com",
      body: "New private body",
    };
    await act(() => newResponse.resolve(response({ feedback: newFeedback })));
    expect(await screen.findByRole("heading", { name: "New route feedback" })).toBeInTheDocument();
    expect(screen.queryByText(/Taro Yamada/)).not.toBeInTheDocument();
  });

  it("updates status and shows the refreshed detail", async () => {
    const planned = { ...feedbackFixture, status: "planned" as const };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ feedback: feedbackFixture }))
      .mockResolvedValueOnce(response({ feedback: planned }))
      .mockResolvedValueOnce(response({ feedback: planned }));
    vi.stubGlobal("fetch", fetchMock);
    await renderPath("/app/feedback/fb-test");
    expect(await screen.findByRole("heading", { name: "CSV export" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("ステータス"), { target: { value: "planned" } });
    fireEvent.click(screen.getByRole("button", { name: "ステータスを更新" }));
    expect(await screen.findByText("計画済み")).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe("/api/projects/acme/feedback/fb-test/status");
    expect(init).toMatchObject({ method: "PATCH" });
    expect(JSON.parse(String(init?.body))).toEqual({ status: "planned" });
  });

  it("distinguishes a failed refresh after a successful status update", async () => {
    const planned = { ...feedbackFixture, status: "planned" as const };
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(response({ feedback: feedbackFixture }))
        .mockResolvedValueOnce(response({ feedback: planned }))
        .mockResolvedValueOnce(
          response({ error: { code: "internal_error", message: "Error" } }, 500),
        ),
    );

    await renderPath("/app/feedback/fb-test");
    expect(await screen.findByRole("heading", { name: "CSV export" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("ステータス"), { target: { value: "planned" } });
    fireEvent.click(screen.getByRole("button", { name: "ステータスを更新" }));

    expect(await screen.findByText("更新後の再取得に失敗しました")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "CSV export" })).toBeInTheDocument();
  });

  it("keeps the current detail visible when the status update fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(response({ feedback: feedbackFixture }))
        .mockResolvedValueOnce(
          response({ error: { code: "internal_error", message: "Error" } }, 500),
        ),
    );

    await renderPath("/app/feedback/fb-test");
    expect(await screen.findByRole("heading", { name: "CSV export" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("ステータス"), { target: { value: "planned" } });
    fireEvent.click(screen.getByRole("button", { name: "ステータスを更新" }));

    expect(await screen.findByText("ステータスの更新に失敗しました")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "CSV export" })).toBeInTheDocument();
    expect(screen.getByText(validInput.body)).toBeInTheDocument();
    expect(screen.getByText(/Taro Yamada/)).toBeInTheDocument();
  });
});
