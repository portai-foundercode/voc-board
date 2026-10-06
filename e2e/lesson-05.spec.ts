import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type PlaywrightWorkerArgs,
} from "@playwright/test";
import { readDevVars } from "../scripts/lib/dev-vars";

// Basic 認証の資格情報は apps/app/.dev.vars から読む（第4回の入口は第5回でも全ページに掛かったまま）
const vars = readDevVars();
const credentials = {
  username: vars.BASIC_AUTH_USERNAME ?? "",
  password: vars.BASIC_AUTH_PASSWORD ?? "",
};
const password = "password1234";
const acmeOwner = "owner@acme.test";
const acmeMember = "member@acme.test";
const globexOwner = "owner@globex.test";
const globexFeedbackId = "feedback-globex-001";

test.use({ httpCredentials: credentials });

const uniqueSlug = () => `e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

// hydration前にフォームを送信するとブラウザ標準の送信になってしまうため、通信が落ち着くまで待つ
async function gotoAndWaitForHydration(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

// 画面のログインフォームを使う
async function loginViaUi(page: Page, email: string) {
  await gotoAndWaitForHydration(page, "/login");
  await page.getByLabel("メール").fill(email);
  await page.getByLabel("パスワード").fill(password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page).toHaveURL(/\/app\/feedback$/);
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

async function postPublicFeedback(api: APIRequestContext, slug: string, title: string) {
  const response = await api.post(`/api/projects/${slug}/feedback`, {
    data: { title, name: "山田 太郎", email: "taro@example.com", body: "E2Eから投稿しました" },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { feedback: { id: string } }).feedback.id;
}

test.describe("ログインと画面遷移", () => {
  test("第5回: 未ログインで /app 配下を開くと /login へ遷移する", async ({ page }) => {
    for (const path of ["/app/feedback", "/app/projects"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
    }
  });

  test("第5回: member がログインでき、一覧は自workspace（Acme）の投稿だけで、ログアウトできる", async ({
    page,
  }) => {
    await loginViaUi(page, acmeMember);
    await expect(page.getByRole("link", { name: "CSV export" })).toBeVisible();
    await expect(page.getByText("Globex SSO request")).toHaveCount(0);

    await page.getByRole("button", { name: "ログアウト" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/app/feedback");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("第5回: owner のログイン後の一覧にも他workspaceの投稿は出ない", async ({ page }) => {
    await loginViaUi(page, acmeOwner);
    await expect(page.getByRole("link", { name: "CSV export" })).toBeVisible();
    await expect(page.getByText("Globex SSO request")).toHaveCount(0);
  });

  test("第5回: Globex の owner には Globex の投稿だけが出る", async ({ page }) => {
    await loginViaUi(page, globexOwner);
    await expect(page.getByRole("link", { name: "Globex SSO request" })).toBeVisible();
    await expect(page.getByText("CSV export")).toHaveCount(0);
  });

  test("第5回: パスワードが違うとログインできず、画面にエラーが出る", async ({ page }) => {
    await gotoAndWaitForHydration(page, "/login");
    await page.getByLabel("メール").fill(acmeMember);
    await page.getByLabel("パスワード").fill("wrong-password");
    await page.getByRole("button", { name: "ログイン" }).click();
    await expect(page.getByRole("alert")).toContainText("メールまたはパスワードが正しくありません");
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/app/feedback");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("第5回: ログイン済みで /login を開くと /app/feedback へ遷移する", async ({ page }) => {
    await loginViaApi(page, acmeMember);
    await page.goto("/login");
    await expect(page).toHaveURL(/\/app\/feedback$/);
  });
});

test.describe("API の認証と認可", () => {
  test("第5回: 未ログインの管理用 API は 401（Basic 認証を通っていても）", async ({
    playwright,
    baseURL,
  }) => {
    const api = await apiAs(playwright, baseURL);
    for (const path of [
      "/api/me",
      "/api/feedback",
      "/api/feedback/feedback-001",
      "/api/projects",
    ]) {
      expect((await api.get(path)).status(), path).toBe(401);
    }
    expect(
      (
        await api.patch("/api/feedback/feedback-001/status", { data: { status: "planned" } })
      ).status(),
    ).toBe(401);
    expect(
      (await api.post("/api/projects", { data: { name: "x", slug: uniqueSlug() } })).status(),
    ).toBe(401);
  });

  test("第5回: member は自workspaceの status を更新できるが、project は作れない（403）", async ({
    playwright,
    baseURL,
  }) => {
    const visitor = await apiAs(playwright, baseURL);
    const id = await postPublicFeedback(visitor, "acme", `権限確認 ${Date.now()}`);

    const member = await apiAs(playwright, baseURL, acmeMember);
    const updated = await member.patch(`/api/feedback/${id}/status`, {
      data: { status: "reviewing" },
    });
    expect(updated.status()).toBe(200);
    expect(((await updated.json()) as { feedback: { status: string } }).feedback.status).toBe(
      "reviewing",
    );

    const slug = uniqueSlug();
    const created = await member.post("/api/projects", { data: { name: "Member Project", slug } });
    expect(created.status()).toBe(403);
    const projects = (await (await member.get("/api/projects")).json()) as {
      projects: { slug: string }[];
    };
    expect(projects.projects.map((project) => project.slug)).not.toContain(slug);
  });

  for (const email of [acmeOwner, acmeMember]) {
    test(`第5回: ${email} は他workspaceの feedback の詳細・status 更新が 404 になり、状態も変わらない`, async ({
      playwright,
      baseURL,
    }) => {
      const api = await apiAs(playwright, baseURL, email);
      expect((await api.get(`/api/feedback/${globexFeedbackId}`)).status()).toBe(404);
      const patch = await api.patch(`/api/feedback/${globexFeedbackId}/status`, {
        data: { status: "planned" },
      });
      expect(patch.status()).toBe(404);

      const list = (await (await api.get("/api/feedback")).json()) as {
        feedback: { id: string }[];
      };
      expect(list.feedback.map((item) => item.id)).not.toContain(globexFeedbackId);

      // Globex 側からは存在し、status は変わっていない
      const globex = await apiAs(playwright, baseURL, globexOwner);
      const detail = await globex.get(`/api/feedback/${globexFeedbackId}`);
      expect(detail.status()).toBe(200);
      expect(((await detail.json()) as { feedback: { status: string } }).feedback.status).toBe(
        "new",
      );
    });
  }

  test("第5回: クライアントが workspace ID を送っても所属 workspace は変わらない", async ({
    playwright,
    baseURL,
  }) => {
    const api = await apiAs(playwright, baseURL, acmeMember);
    const response = await api.get(`/api/feedback/${globexFeedbackId}?workspaceId=ws-globex`, {
      headers: { "x-workspace-id": "ws-globex" },
    });
    expect(response.status()).toBe(404);
  });
});

test.describe("project 作成", () => {
  test("第5回: owner は project を作成でき、公開フォームの URL が増える", async ({
    page,
    playwright,
    baseURL,
  }) => {
    const slug = uniqueSlug();
    await loginViaApi(page, acmeOwner);
    await gotoAndWaitForHydration(page, "/app/projects");
    const publicLinks = page.getByRole("link", { name: /^\/p\// });
    await expect(publicLinks.first()).toBeVisible();
    const before = await publicLinks.count();

    await page.getByLabel("プロジェクト名").fill("E2E Project");
    await page.getByLabel("スラッグ").fill(slug);
    await page.getByRole("button", { name: "プロジェクトを作成" }).click();
    await expect(page.getByRole("link", { name: `/p/${slug}` })).toBeVisible();
    await expect(publicLinks).toHaveCount(before + 1);

    // 同じ slug は作れず、項目のエラーが label 内に出る
    await page.getByLabel("プロジェクト名").fill("E2E Project 2");
    await page.getByLabel("スラッグ").fill(slug);
    await page.getByRole("button", { name: "プロジェクトを作成" }).click();
    const label = page.locator("label").filter({ has: page.getByLabel("スラッグ") });
    await expect(label).not.toHaveText("スラッグ", { timeout: 10_000 });
    await expect(publicLinks).toHaveCount(before + 1);

    // 作った project の公開フォームは、ログインしていない訪問者が使える
    const visitor = await apiAs(playwright, baseURL);
    await postPublicFeedback(visitor, slug, `新project ${Date.now()}`);
  });

  test("第5回: owner の API は project を作成して 201 を返し、不正な slug は 400", async ({
    playwright,
    baseURL,
  }) => {
    const api = await apiAs(playwright, baseURL, acmeOwner);
    const slug = uniqueSlug();
    const created = await api.post("/api/projects", { data: { name: "API Project", slug } });
    expect(created.status()).toBe(201);
    expect((await api.post("/api/projects", { data: { name: "Duplicate", slug } })).status()).toBe(
      409,
    );
    expect(
      (await api.post("/api/projects", { data: { name: "Bad", slug: "Not Valid!" } })).status(),
    ).toBe(400);
  });

  test("第5回: member は project 一覧を見られるが、作成フォームは出ない", async ({ page }) => {
    await loginViaApi(page, acmeMember);
    await gotoAndWaitForHydration(page, "/app/projects");
    await expect(page.getByRole("link", { name: "/p/acme" })).toBeVisible();
    await expect(page.getByRole("button", { name: "プロジェクトを作成" })).toHaveCount(0);
    await expect(page.getByText("プロジェクトを作成できるのはオーナーだけです")).toBeVisible();
  });
});

test.describe("公開フォーム", () => {
  test("第5回: 公開フォームはログインなしで投稿でき、他workspaceのprojectにも投稿できる", async ({
    page,
  }) => {
    for (const slug of ["acme", "globex"]) {
      await gotoAndWaitForHydration(page, `/p/${slug}`);
      await expect(page).toHaveURL(new RegExp(`/p/${slug}$`));
      await page.getByLabel("タイトル").fill(`公開投稿 ${slug} ${Date.now()}`);
      await page.getByLabel("名前").fill("山田 太郎");
      await page.getByLabel("メール").fill("taro@example.com");
      await page.getByLabel("フィードバック").fill("ログインせずに投稿しました");
      await page.getByRole("button", { name: "送信する" }).click();
      await expect(page.getByText("フィードバックを受け付けました")).toBeVisible();
    }
  });

  test("第5回: 公開フォームの API から管理用 API は呼べない", async ({ playwright, baseURL }) => {
    const visitor = await apiAs(playwright, baseURL);
    const created = await visitor.post("/api/projects/acme/feedback", {
      data: { title: "t", name: "n", email: "n@example.com", body: "b" },
    });
    expect(created.status()).toBe(201);
    const id = ((await created.json()) as { feedback: { id: string } }).feedback.id;
    expect((await visitor.get(`/api/feedback/${id}`)).status()).toBe(401);
    expect(
      (await visitor.patch(`/api/feedback/${id}/status`, { data: { status: "planned" } })).status(),
    ).toBe(401);
  });
});
