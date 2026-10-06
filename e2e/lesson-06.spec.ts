import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type PlaywrightWorkerArgs,
} from "@playwright/test";
import { readDevVars } from "../scripts/lib/dev-vars";

// Basic 認証の資格情報は apps/app/.dev.vars から読む（第4回の入口は第6回でも全ページに掛かったまま）
const vars = readDevVars();
const credentials = {
  username: vars.BASIC_AUTH_USERNAME ?? "",
  password: vars.BASIC_AUTH_PASSWORD ?? "",
};
const password = "password1234";
const acmeOwner = "owner@acme.test";
const acmeMember = "member@acme.test";
const globexOwner = "owner@globex.test";

test.use({ httpCredentials: credentials });

const csvPath = "/api/export/feedback.csv";
const forbiddenRoleMessage = "CSVを出力できるのはオーナーだけです。オーナーに依頼してください";
const planRequiredMessage = "CSV出力はProプランで使えます";

// hydration前に操作するとブラウザ標準の動作になってしまうため、通信が落ち着くまで待つ
async function gotoAndWaitForHydration(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

// 認証APIを直接叩いて、そのブラウザコンテキストをログイン済みにする（Origin は Better Auth の CSRF 対策で必要）
async function loginViaApi(page: Page, email: string) {
  const origin = test.info().project.use.baseURL ?? "";
  const response = await page.context().request.post("/api/auth/sign-in/email", {
    data: { email, password },
    headers: { origin },
  });
  expect(response.status()).toBe(200);
}

type Playwright = PlaywrightWorkerArgs["playwright"];

const apiContexts: APIRequestContext[] = [];
test.afterEach(async () => {
  await Promise.all(apiContexts.splice(0).map((context) => context.dispose()));
});

// email 省略は未ログイン（Basic 認証だけ）
async function apiAs(playwright: Playwright, baseURL: string | undefined, email?: string) {
  const origin = baseURL ?? "";
  const context = await playwright.request.newContext({
    baseURL: origin,
    httpCredentials: { ...credentials, send: "always" },
    extraHTTPHeaders: { origin },
  });
  apiContexts.push(context);
  if (email) {
    const response = await context.post("/api/auth/sign-in/email", { data: { email, password } });
    expect(response.status()).toBe(200);
  }
  return context;
}

type FeedbackItem = {
  id: string;
  title: string;
  status: string;
  category: string;
  priority: string;
};

async function postPublicFeedback(
  api: APIRequestContext,
  slug: string,
  input: { title: string; name?: string; body?: string },
) {
  const response = await api.post(`/api/projects/${slug}/feedback`, {
    data: {
      name: "山田 太郎",
      email: "taro@example.com",
      body: "E2Eから投稿しました",
      ...input,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { feedback: FeedbackItem }).feedback;
}

async function listFeedback(api: APIRequestContext, query = "") {
  const response = await api.get(`/api/feedback${query}`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { feedback: FeedbackItem[] }).feedback;
}

// RFC 4180 のCSVを行・セルに分ける（BOM は呼び出し側で外す）
function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\r" && text[index + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      index += 1;
    } else cell += char;
  }
  if (cell || row.length > 0) rows.push([...row, cell]);
  return rows;
}

async function fetchCsv(api: APIRequestContext, query = "") {
  const response = await api.get(`${csvPath}${query}`);
  expect(response.status()).toBe(200);
  const bytes = await response.body();
  const text = bytes.toString("utf8");
  const [header = [], ...rows] = parseCsv(text.replace(/^\uFEFF/, ""));
  return { response, bytes, text, header, rows };
}

const testId = (page: Page, id: string) => page.getByTestId(id);

async function readCounts(page: Page) {
  const read = async (id: string) => Number(await testId(page, id).innerText());
  return {
    unhandled: await read("unhandled-count"),
    byStatus: {
      new: await read("status-count-new"),
      reviewing: await read("status-count-reviewing"),
      planned: await read("status-count-planned"),
    },
    byCategory: {
      bug: await read("category-count-bug"),
      request: await read("category-count-request"),
      question: await read("category-count-question"),
    },
  };
}

const countBy = (items: FeedbackItem[], key: "status" | "category", value: string) =>
  items.filter((item) => item[key] === value).length;

test.describe("一覧の絞り込み", () => {
  test("第6回: ステータス・カテゴリ・優先度で絞り込め、条件はURLに残り再読込で保たれる", async ({
    page,
  }) => {
    await loginViaApi(page, acmeMember);
    await gotoAndWaitForHydration(page, "/app/feedback");
    const link = (name: string) => page.getByRole("link", { name, exact: true });
    await expect(link("CSV export")).toBeVisible();
    await expect(link("Login error on Safari")).toBeVisible();

    await page.getByLabel("ステータス").selectOption("new");
    await expect(page).toHaveURL(/[?&]status=new(&|$)/);
    await expect(link("Saved searches")).toHaveCount(0);
    await expect(link("Login error on Safari")).toBeVisible();
    await expect(link("CSV export")).toBeVisible();

    await page.getByLabel("カテゴリ").selectOption("bug");
    await expect(page).toHaveURL(/[?&]category=bug(&|$)/);
    await expect(link("CSV export")).toHaveCount(0);
    await expect(link("How to invite members")).toHaveCount(0);
    const row = page.getByTestId("feedback-row").filter({ hasText: "Login error on Safari" });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("不具合");
    await expect(row).toContainText("高");

    await page.getByLabel("優先度").selectOption("low");
    await expect(page).toHaveURL(/[?&]priority=low(&|$)/);
    await expect(page.getByText("条件に一致するフィードバックはありません")).toBeVisible();
    await page.getByLabel("優先度").selectOption("high");
    await expect(link("Login error on Safari")).toBeVisible();

    // 再読込しても条件・選択状態・結果が保たれる
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/status=new/);
    await expect(page).toHaveURL(/category=bug/);
    await expect(page).toHaveURL(/priority=high/);
    await expect(page.getByLabel("ステータス")).toHaveValue("new");
    await expect(page.getByLabel("カテゴリ")).toHaveValue("bug");
    await expect(page.getByLabel("優先度")).toHaveValue("high");
    await expect(link("Login error on Safari")).toBeVisible();
    await expect(link("Dashboard loads slowly")).toHaveCount(0);

    // 「すべて」に戻すとqueryから消える
    for (const label of ["ステータス", "カテゴリ", "優先度"]) {
      await page.getByLabel(label).selectOption("");
    }
    await expect(page).not.toHaveURL(/[?&](status|category|priority)=/);
    await expect(link("CSV export")).toBeVisible();
    await expect(link("Dashboard loads slowly")).toBeVisible();
  });

  test("第6回: URLのqueryで直接開いた条件が適用され、他workspaceの投稿は出ない", async ({
    page,
  }) => {
    await loginViaApi(page, acmeMember);
    await gotoAndWaitForHydration(page, "/app/feedback?category=question");
    await expect(page.getByLabel("カテゴリ")).toHaveValue("question");
    await expect(page.getByRole("link", { name: "How to invite members" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Login error on Safari" })).toHaveCount(0);
    await expect(page.getByText("Globex")).toHaveCount(0);
  });

  test("第6回: APIの絞り込みは条件をANDで適用し、不正な値は400", async ({
    playwright,
    baseURL,
  }) => {
    const api = await apiAs(playwright, baseURL, acmeMember);
    const titles = async (query: string) =>
      (await listFeedback(api, query)).map((item) => item.title);

    expect(await titles("?status=new&category=bug")).toContain("Login error on Safari");
    expect(await titles("?status=new&category=bug")).not.toContain("Dashboard loads slowly");
    expect(await titles("?category=bug&priority=high")).toEqual(
      expect.arrayContaining(["Login error on Safari", "Dashboard loads slowly"]),
    );
    expect(await titles("?status=planned")).toContain("Weekly reports");
    expect(await titles("?status=planned")).not.toContain("CSV export");
    // 空文字は「すべて」
    expect((await titles("?status=&category=")).length).toBeGreaterThanOrEqual(6);

    for (const query of ["?status=done", "?category=other", "?priority=urgent"]) {
      expect((await api.get(`/api/feedback${query}`)).status(), query).toBe(400);
    }
  });
});

test.describe("カテゴリと優先度の更新", () => {
  test("第6回: 詳細でカテゴリ・優先度を更新でき、再読込後も残り、一覧の絞り込みに反映される", async ({
    page,
    playwright,
    baseURL,
  }) => {
    const visitor = await apiAs(playwright, baseURL);
    const title = `分類確認 ${Date.now()}`;
    const created = await postPublicFeedback(visitor, "acme", { title });
    // 公開フォームの投稿は 質問 / 中 で始まる
    expect([created.category, created.priority]).toEqual(["question", "medium"]);

    await loginViaApi(page, acmeMember);
    await gotoAndWaitForHydration(page, `/app/feedback/${created.id}`);
    await expect(page.getByLabel("カテゴリ")).toHaveValue("question");
    await expect(page.getByLabel("優先度")).toHaveValue("medium");

    const update = async (label: "カテゴリ" | "優先度", value: string, field: string) => {
      await page.getByLabel(label).selectOption(value);
      const response = page.waitForResponse(
        (candidate) =>
          candidate.request().method() === "PATCH" && candidate.url().endsWith(`/${field}`),
      );
      await page.getByRole("button", { name: `${label}を更新` }).click();
      expect((await response).status()).toBe(200);
    };
    await update("カテゴリ", "bug", "category");
    await update("優先度", "high", "priority");

    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByLabel("カテゴリ")).toHaveValue("bug");
    await expect(page.getByLabel("優先度")).toHaveValue("high");

    await gotoAndWaitForHydration(page, "/app/feedback?category=bug&priority=high");
    await expect(page.getByRole("link", { name: title })).toBeVisible();

    // 優先度を下げると、高の絞り込みから外れる
    await gotoAndWaitForHydration(page, `/app/feedback/${created.id}`);
    await update("優先度", "low", "priority");
    await gotoAndWaitForHydration(page, "/app/feedback?category=bug&priority=high");
    await expect(page.getByRole("link", { name: "Login error on Safari" })).toBeVisible();
    await expect(page.getByRole("link", { name: title })).toHaveCount(0);
  });

  test("第6回: カテゴリ・優先度の更新APIは不正な値を400にし、他workspaceのIDは404", async ({
    playwright,
    baseURL,
  }) => {
    const api = await apiAs(playwright, baseURL, acmeMember);
    const visitor = await apiAs(playwright, baseURL);
    const created = await postPublicFeedback(visitor, "acme", { title: `分類API ${Date.now()}` });

    expect(
      (
        await api.patch(`/api/feedback/${created.id}/category`, { data: { category: "x" } })
      ).status(),
    ).toBe(400);
    expect((await api.patch(`/api/feedback/${created.id}/priority`, { data: {} })).status()).toBe(
      400,
    );
    for (const [field, value] of [
      ["category", "bug"],
      ["priority", "high"],
    ] as const) {
      const other = await api.patch(`/api/feedback/feedback-globex-001/${field}`, {
        data: { [field]: value },
      });
      expect(other.status(), field).toBe(404);
    }

    const globex = await apiAs(playwright, baseURL, globexOwner);
    const detail = await globex.get("/api/feedback/feedback-globex-001");
    const { feedback } = (await detail.json()) as { feedback: FeedbackItem };
    expect([feedback.category, feedback.priority]).toEqual(["request", "high"]);

    const unauthenticated = await apiAs(playwright, baseURL);
    expect(
      (
        await unauthenticated.patch(`/api/feedback/${created.id}/priority`, {
          data: { priority: "low" },
        })
      ).status(),
    ).toBe(401);
  });
});

test.describe("ダッシュボード", () => {
  test("第6回: 件数は同じworkspaceの一覧と一致する", async ({ page, playwright, baseURL }) => {
    const api = await apiAs(playwright, baseURL, acmeMember);
    await loginViaApi(page, acmeMember);
    await gotoAndWaitForHydration(page, "/app/dashboard");

    await expect(page.getByRole("heading", { level: 1, name: "ダッシュボード" })).toBeVisible();
    for (const name of ["未対応件数", "ステータス別件数", "カテゴリ別件数"]) {
      await expect(page.getByRole("heading", { name })).toBeVisible();
    }
    await expect(testId(page, "unhandled-count")).toBeVisible();

    // 未対応 = status が new。一覧を絞り込んだ件数と一致する
    const all = await listFeedback(api);
    const counts = await readCounts(page);
    expect(counts.unhandled).toBe((await listFeedback(api, "?status=new")).length);
    expect(counts.unhandled).toBe(counts.byStatus.new);
    for (const status of ["new", "reviewing", "planned"] as const) {
      expect(counts.byStatus[status], status).toBe(countBy(all, "status", status));
      expect(counts.byStatus[status], status).toBe(
        (await listFeedback(api, `?status=${status}`)).length,
      );
    }
    for (const category of ["bug", "request", "question"] as const) {
      expect(counts.byCategory[category], category).toBe(countBy(all, "category", category));
      expect(counts.byCategory[category], category).toBe(
        (await listFeedback(api, `?category=${category}`)).length,
      );
    }
    // seed分（未対応 3、新着 3、確認中 2、計画済み 1、不具合 2、要望 3、質問 1）以上ある
    expect(counts.unhandled).toBeGreaterThanOrEqual(3);
    expect(counts.byStatus.reviewing).toBeGreaterThanOrEqual(2);
    expect(counts.byStatus.planned).toBeGreaterThanOrEqual(1);
    expect(counts.byCategory.bug).toBeGreaterThanOrEqual(2);
    expect(counts.byCategory.request).toBeGreaterThanOrEqual(3);
    expect(counts.byCategory.question).toBeGreaterThanOrEqual(1);
  });

  test("第6回: Globex の owner にはGlobexの件数だけが出て、Acmeが混ざらない", async ({ page }) => {
    await loginViaApi(page, globexOwner);
    await gotoAndWaitForHydration(page, "/app/dashboard");
    await expect(testId(page, "unhandled-count")).toHaveText("1");
    expect(await readCounts(page)).toEqual({
      unhandled: 1,
      byStatus: { new: 1, reviewing: 1, planned: 0 },
      byCategory: { bug: 1, request: 1, question: 0 },
    });
  });

  test("第6回: ダッシュボードAPIは未ログインで401", async ({ playwright, baseURL }) => {
    const api = await apiAs(playwright, baseURL);
    expect((await api.get("/api/dashboard")).status()).toBe(401);
  });
});

test.describe("設定", () => {
  test("第6回: owner にはメンバー一覧とプロジェクト一覧（自workspaceだけ）が出る", async ({
    page,
  }) => {
    await loginViaApi(page, acmeOwner);
    await gotoAndWaitForHydration(page, "/app/settings");

    await expect(page.getByRole("heading", { level: 1, name: "設定" })).toBeVisible();
    await expect(page.getByText("プラン")).toBeVisible();
    await expect(page.getByText("Pro", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "メンバー" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "プロジェクト" })).toBeVisible();
    await expect(page.getByRole("cell", { name: acmeOwner })).toBeVisible();
    await expect(page.getByRole("cell", { name: acmeMember })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Acme Feedback" })).toBeVisible();
    await expect(page.getByText(globexOwner)).toHaveCount(0);
    await expect(page.getByText("Globex Feedback")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "設定" })).toBeVisible();
    await expect(page.getByRole("link", { name: "ダッシュボード" })).toBeVisible();
  });

  test("第6回: member には403の案内が出て、メンバー・プロジェクトの一覧は出ない", async ({
    page,
  }) => {
    await loginViaApi(page, acmeMember);
    await gotoAndWaitForHydration(page, "/app/settings");

    await expect(page.getByRole("alert")).toContainText("この画面はオーナーだけが利用できます");
    await expect(page.getByRole("heading", { name: "設定" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "メンバー" })).toHaveCount(0);
    await expect(page.getByText(acmeOwner)).toHaveCount(0);
    await expect(page.getByText("Acme Feedback")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "設定" })).toHaveCount(0);
  });

  test("第6回: 未ログインで /app/settings を開くと /login へ遷移する", async ({ page }) => {
    await page.goto("/app/settings");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("第6回: 設定APIは member 403、未ログイン 401、owner 200（プランはworkspaceごと）", async ({
    playwright,
    baseURL,
  }) => {
    const member = await apiAs(playwright, baseURL, acmeMember);
    const denied = await member.get("/api/settings");
    expect(denied.status()).toBe(403);
    expect(((await denied.json()) as { error: { code: string } }).error.code).toBe(
      "forbidden_role",
    );

    const visitor = await apiAs(playwright, baseURL);
    expect((await visitor.get("/api/settings")).status()).toBe(401);

    const owner = await apiAs(playwright, baseURL, acmeOwner);
    const response = await owner.get("/api/settings?workspaceId=ws-globex");
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      plan: string;
      members: { email: string; role: string }[];
      projects: { slug: string }[];
    };
    expect(body.plan).toBe("pro");
    expect(body.members.map((item) => item.email).sort()).toEqual([acmeMember, acmeOwner]);
    expect(body.members.find((item) => item.email === acmeOwner)?.role).toBe("owner");
    expect(body.projects.map((project) => project.slug)).toContain("acme");
    expect(body.projects.map((project) => project.slug)).not.toContain("globex");

    const globex = await apiAs(playwright, baseURL, globexOwner);
    expect(((await (await globex.get("/api/settings")).json()) as { plan: string }).plan).toBe(
      "free",
    );
  });
});

test.describe("CSV出力 API（権限 × プラン）", () => {
  test("第6回: owner(pro) 200、member 403 forbidden_role、owner(free) 403 plan_required、未ログイン 401", async ({
    playwright,
    baseURL,
  }) => {
    const owner = await apiAs(playwright, baseURL, acmeOwner);
    const ok = await owner.get(csvPath);
    expect(ok.status()).toBe(200);
    expect(ok.headers()["content-type"]).toMatch(/^text\/csv/);
    expect(ok.headers()["content-type"]).toMatch(/charset=utf-8/i);
    expect(ok.headers()["content-disposition"]).toContain("attachment");

    const errorCode = async (api: APIRequestContext) => {
      const response = await api.get(csvPath);
      const body = (await response.json()) as { error: { code: string } };
      return [response.status(), body.error.code];
    };
    expect(await errorCode(await apiAs(playwright, baseURL, acmeMember))).toEqual([
      403,
      "forbidden_role",
    ]);
    expect(await errorCode(await apiAs(playwright, baseURL, globexOwner))).toEqual([
      403,
      "plan_required",
    ]);
    const visitor = await apiAs(playwright, baseURL);
    expect((await visitor.get(csvPath)).status()).toBe(401);
  });
});

test.describe("CSVの中身", () => {
  test("第6回: UTF-8 BOM、ヘッダ行、自workspaceの行だけ、他workspaceの指定は無視される", async ({
    playwright,
    baseURL,
  }) => {
    const owner = await apiAs(playwright, baseURL, acmeOwner);
    const { bytes, header, rows } = await fetchCsv(owner, "?workspaceId=ws-globex");

    expect(Array.from(bytes.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(header).toEqual([
      "id",
      "title",
      "name",
      "email",
      "body",
      "status",
      "category",
      "priority",
      "createdAt",
    ]);
    const titles = rows.map((row) => row[1]);
    expect(titles).toEqual(
      expect.arrayContaining([
        "CSV export",
        "Saved searches",
        "Weekly reports",
        "Login error on Safari",
        "How to invite members",
        "Dashboard loads slowly",
      ]),
    );
    expect(titles).not.toContain("Globex SSO request");
    expect(titles).not.toContain("Globex audit log");
    expect(rows.map((row) => row[0])).not.toContain("feedback-globex-001");

    // 一覧APIと同じ行（同じ並び）になる
    const member = await apiAs(playwright, baseURL, acmeMember);
    expect(rows.map((row) => row[0])).toEqual((await listFeedback(member)).map((item) => item.id));
    const login = rows.find((row) => row[1] === "Login error on Safari");
    expect(login?.slice(5, 8)).toEqual(["new", "bug", "high"]);
  });

  test("第6回: 現在の絞り込み条件どおりの行だけが出る", async ({ playwright, baseURL }) => {
    const owner = await apiAs(playwright, baseURL, acmeOwner);
    const filtered = await fetchCsv(owner, "?status=new&category=bug");
    expect(filtered.rows.length).toBeGreaterThanOrEqual(1);
    for (const row of filtered.rows) {
      expect([row[5], row[6]], row[1]).toEqual(["new", "bug"]);
    }
    const titles = filtered.rows.map((row) => row[1]);
    expect(titles).toContain("Login error on Safari");
    expect(titles).not.toContain("Dashboard loads slowly");
    expect(titles).not.toContain("CSV export");
    expect(filtered.rows.map((row) => row[0])).toEqual(
      (await listFeedback(owner, "?status=new&category=bug")).map((item) => item.id),
    );

    const highOnly = await fetchCsv(owner, "?priority=high");
    expect(highOnly.rows.every((row) => row[7] === "high")).toBe(true);
    expect(highOnly.rows.map((row) => row[1])).toEqual(
      expect.arrayContaining(["Login error on Safari", "Dashboard loads slowly"]),
    );

    expect((await owner.get(`${csvPath}?status=done`)).status()).toBe(400);
  });

  test("第6回: = + - @ で始まるセルは ' を付けて無害化され、カンマ・引用符・改行は壊れない", async ({
    playwright,
    baseURL,
  }) => {
    const visitor = await apiAs(playwright, baseURL);
    const stamp = Date.now();
    const dangerous = [`=SUM(1,1) ${stamp}`, `+1 ${stamp}`, `-1 ${stamp}`, `@cmd ${stamp}`];
    for (const title of dangerous) {
      await postPublicFeedback(visitor, "acme", { title, name: `=名前 ${stamp}` });
    }
    const tricky = await postPublicFeedback(visitor, "acme", {
      title: `引用符 ${stamp}`,
      body: 'a,"b"\nc',
    });

    const owner = await apiAs(playwright, baseURL, acmeOwner);
    const { rows } = await fetchCsv(owner);

    for (const title of dangerous) {
      const row = rows.find((candidate) => candidate[1] === `'${title}`);
      expect(row, title).toBeDefined();
      expect(row?.[2]).toBe(`'=名前 ${stamp}`);
    }
    for (const row of rows) {
      for (const cell of row.slice(1, 5)) expect(cell, row[0]).not.toMatch(/^[=+\-@]/);
    }
    expect(rows.find((row) => row[0] === tricky.id)?.[4]).toBe('a,"b"\nc');
  });
});

test.describe("CSVボタン", () => {
  test("第6回: owner(pro) は現在の絞り込み条件のCSVをダウンロードできる", async ({ page }) => {
    await loginViaApi(page, acmeOwner);
    await gotoAndWaitForHydration(page, "/app/feedback?status=new");
    await expect(page.getByRole("link", { name: "CSV export" })).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "CSVをダウンロード" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("feedback.csv");

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const bytes = Buffer.concat(chunks);
    expect(Array.from(bytes.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const [, ...rows] = parseCsv(bytes.toString("utf8").replace(/^\uFEFF/, ""));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((row) => row[5] === "new")).toBe(true);
    expect(rows.map((row) => row[1])).not.toContain("Saved searches");
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("第6回: member と owner(free) には理由別の案内が出る", async ({ page }) => {
    await loginViaApi(page, acmeMember);
    await gotoAndWaitForHydration(page, "/app/feedback");
    await page.getByRole("button", { name: "CSVをダウンロード" }).click();
    await expect(page.getByRole("alert")).toHaveText(forbiddenRoleMessage);

    await page.context().clearCookies();
    await loginViaApi(page, globexOwner);
    await gotoAndWaitForHydration(page, "/app/feedback");
    await page.getByRole("button", { name: "CSVをダウンロード" }).click();
    await expect(page.getByRole("alert")).toHaveText(planRequiredMessage);
  });
});
