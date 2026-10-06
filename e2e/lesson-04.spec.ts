import { expect, test, type Page } from "@playwright/test";
import { readDevVars } from "../scripts/lib/dev-vars";

// 資格情報は apps/app/.dev.vars から読む（無ければ作り方を案内するエラーになる）
const vars = readDevVars();
const credentials = {
  username: vars.BASIC_AUTH_USERNAME ?? "",
  password: vars.BASIC_AUTH_PASSWORD ?? "",
};

const uniqueTitle = (prefix: string) =>
  `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// hydration前にフォームを送信するとブラウザ標準の送信になってしまうため、通信が落ち着くまで待つ
async function gotoAndWaitForHydration(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

const statusSelect = (page: Page) => page.getByRole("combobox", { name: "ステータス" });

test.describe("資格情報なし", () => {
  test.use({ httpCredentials: undefined });

  for (const path of [
    "/",
    "/p/acme",
    "/app/feedback",
    "/api/health",
    "/api/projects/acme/feedback",
  ]) {
    test(`第4回: ${path} は 401 と Basic 認証の要求を返す`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(401);
      expect(response.headers()["www-authenticate"]).toMatch(/^Basic /i);
    });
  }

  test("第4回: 誤ったパスワードの API 呼び出しは 401 になる", async ({ request }) => {
    const token = Buffer.from(`${credentials.username}:wrong-${credentials.password}`).toString(
      "base64",
    );
    const response = await request.get("/api/projects/acme/feedback", {
      headers: { authorization: `Basic ${token}` },
    });
    expect(response.status()).toBe(401);
  });

  test("第4回: 資格情報なしの投稿 API は 401 で、投稿は作られない", async ({ request }) => {
    const response = await request.post("/api/projects/acme/feedback", { data: {} });
    expect(response.status()).toBe(401);
  });
});

test.describe("資格情報あり", () => {
  test.use({ httpCredentials: credentials });

  test("第4回: ホームに「限定公開β」のbadgeが出る", async ({ page }) => {
    await gotoAndWaitForHydration(page, "/");
    await expect(page.getByText("限定公開β")).toBeVisible();
  });

  test("第4回: 投稿→一覧→詳細→status更新の流れが動く", async ({ page }) => {
    const title = uniqueTitle("限定公開確認");
    await gotoAndWaitForHydration(page, "/p/acme");
    await page.getByLabel("タイトル").fill(title);
    await page.getByLabel("名前").fill("山田 太郎");
    await page.getByLabel("メール").fill("taro@example.com");
    await page.getByLabel("フィードバック").fill("E2Eから投稿したフィードバックです");
    await page.getByRole("button", { name: "送信する" }).click();
    await expect(page.getByText("フィードバックを受け付けました")).toBeVisible();

    await gotoAndWaitForHydration(page, "/app/feedback");
    await page.getByRole("link", { name: title }).click();
    await expect(page).toHaveURL(/\/app\/feedback\/[^/]+$/);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();

    await statusSelect(page).selectOption({ label: "確認中" });
    const updated = page.waitForResponse(
      (response) =>
        response.request().method() !== "GET" &&
        new URL(response.url()).pathname.startsWith("/api/"),
    );
    await page.getByRole("button", { name: /ステータスを更新|更新/ }).click();
    expect((await updated).ok()).toBe(true);
    await page.reload();
    await expect(statusSelect(page)).toHaveValue("reviewing");
  });

  test("第4回: 存在しない詳細に、API の x-request-id と同じ「問い合わせID」が出る", async ({
    page,
  }) => {
    const missingId = `missing-${Date.now()}`;
    const apiResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === `/api/projects/acme/feedback/${missingId}`,
    );
    await page.goto(`/app/feedback/${missingId}`);

    const response = await apiResponse;
    expect(response.status()).toBe(404);
    const requestId = response.headers()["x-request-id"];
    expect(requestId).toBeTruthy();
    await expect(page.getByText(`問い合わせID: ${requestId}`)).toBeVisible();
  });

  test("第4回: API は全レスポンスに x-request-id を付け、リクエストごとに異なる", async ({
    request,
  }) => {
    const ids = new Set<string>();
    for (const path of [
      "/api/health",
      "/api/projects/acme/feedback",
      "/api/projects/missing/feedback",
    ]) {
      const id = (await request.get(path)).headers()["x-request-id"];
      expect(id).toBeTruthy();
      ids.add(id);
    }
    const invalid = await request.post("/api/projects/acme/feedback", { data: {} });
    expect(invalid.status()).toBe(400);
    expect(invalid.headers()["x-request-id"]).toBeTruthy();
    expect(ids.size).toBe(3);
  });

  test("第4回: validation エラーには問い合わせIDを出さない", async ({ page }) => {
    await gotoAndWaitForHydration(page, "/p/acme");
    await page.locator("form").evaluate((form) => {
      (form as HTMLFormElement).noValidate = true;
    });
    await page.getByRole("button", { name: "送信する" }).click();

    const label = page.locator("label").filter({ has: page.getByLabel("タイトル") });
    await expect(label).not.toHaveText("タイトル", { timeout: 10_000 });
    await expect(page.getByText("問い合わせID")).toHaveCount(0);
  });

  test("第4回: 想定外のエラーは一般的な文言と問い合わせIDだけを出し、stack を出さない", async ({
    page,
  }) => {
    const stack = "Error: boom\n    at handler (/src/api/feedback.ts:42:13)";
    await page.route("**/api/projects/acme/feedback/broken", (route) =>
      route.fulfill({
        status: 500,
        headers: { "x-request-id": "req-e2e-500" },
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "internal_error", message: stack, stack } }),
      }),
    );
    await page.goto("/app/feedback/broken");

    await expect(
      page.getByText("エラーが発生しました。時間をおいて再度お試しください。"),
    ).toBeVisible();
    await expect(page.getByText("問い合わせID: req-e2e-500")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/boom|\bat \S+ \(|\.ts:\d+/);
  });
});
