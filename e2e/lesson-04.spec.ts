import { expect, test } from "@playwright/test";

import { readDevVars } from "../scripts/lib/dev-vars";
import {
  changeStatus,
  expectStatus,
  feedbackForm,
  openDetail,
  submitButton,
  submitFeedback,
  uniqueToken,
} from "./support/feedback";
import {
  feedbackLinks,
  findForm,
  findList,
  missingDetailPath,
  open,
  staticPaths,
} from "./support/screens";

// 資格情報は apps/app/.dev.vars から読む。変数名は受講者に指定していないので、BASIC と USER / PASS を含む名前を探す
const vars = readDevVars();
const findVar = (pattern: RegExp) =>
  Object.entries(vars).find(([key]) => pattern.test(key))?.[1] ?? "";
const credentials = { username: findVar(/BASIC.*USER/i), password: findVar(/BASIC.*PASS/i) };

// 問い合わせIDのヘッダー名も指定していないので、x-request-id のような名前を探す
const requestIdOf = (headers: Record<string, string>) =>
  Object.entries(headers).find(([name]) => /request.?id/i.test(name))?.[1];

const shownRequestId = /問い合わせID\s*[:：]\s*(\S+)/;

test.describe("資格情報なし", () => {
  test.use({ httpCredentials: undefined });

  test("第4回: すべての画面とAPIが401とBasic認証の要求を返す", async ({ request }) => {
    for (const path of [...staticPaths, "/api/health"]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(401);
      expect(response.headers()["www-authenticate"], path).toMatch(/^Basic /i);
    }
  });

  test("第4回: 誤ったパスワードと資格情報なしの投稿は401になる", async ({ browser, request }) => {
    // 投稿APIのURLは、正しい資格情報で一度投稿して調べる
    const context = await browser.newContext({ httpCredentials: credentials });
    const posted = await submitFeedback(await context.newPage(), uniqueToken());
    await context.close();

    const wrong = Buffer.from(`${credentials.username}:wrong-${credentials.password}`).toString(
      "base64",
    );
    const withWrongPassword = await request.get("/api/health", {
      headers: { authorization: `Basic ${wrong}` },
    });
    expect(withWrongPassword.status()).toBe(401);
    expect((await request.post(posted.url(), { data: {} })).status()).toBe(401);
  });
});

test.describe("資格情報あり", () => {
  test.use({ httpCredentials: credentials });

  test("第4回: トップ画面に「限定公開β」と表示される", async ({ page }) => {
    await open(page, "/");
    await expect(page.getByText("限定公開β")).toBeVisible();
  });

  test("第4回: 投稿→一覧→詳細→ステータス変更の流れが動く", async ({ page }) => {
    const token = uniqueToken();
    await submitFeedback(page, token);
    await openDetail(page, token);
    await changeStatus(page, "確認中");
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expectStatus(page, "確認中");
  });

  test("第4回: APIの返事にはリクエストごとに違う問い合わせIDが付く", async ({ page, request }) => {
    const posted = await submitFeedback(page, uniqueToken());
    const responses = [
      await request.get("/api/health"),
      await request.get("/api/health"),
      await request.post(posted.url(), { data: {} }),
    ];
    const ids = responses.map((response) => requestIdOf(response.headers()));
    for (const id of ids) expect(id).toBeTruthy();
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("第4回: 存在しないフィードバックでは画面に問い合わせIDが出て、APIの問い合わせIDと一致する", async ({
    page,
  }) => {
    const token = uniqueToken();
    await submitFeedback(page, token);
    await openDetail(page, token);

    // ブラウザがAPIを呼ぶ作りなら、その返事の問い合わせIDと画面の表示を突き合わせる
    const apiIds: string[] = [];
    page.on("response", (response) => {
      const id = requestIdOf(response.headers());
      if (new URL(response.url()).pathname.startsWith("/api/") && id) apiIds.push(id);
    });
    await open(page, missingDetailPath(page.url()));

    const shown = page.getByText(shownRequestId).first();
    await expect(shown).toBeVisible();
    const id = shownRequestId.exec(await shown.innerText())?.[1];
    if (apiIds.length > 0) expect(apiIds).toContain(id);
  });

  test("第4回: 入力の誤りのエラーには問い合わせIDを出さない", async ({ page }) => {
    await findForm(page);
    const form = feedbackForm(page);
    await form.evaluate((element) => {
      (element as HTMLFormElement).noValidate = true;
    });
    const before = new Set((await page.locator("body").innerText()).split("\n"));
    await submitButton(form).click();

    await expect
      .poll(
        async () =>
          (await page.locator("body").innerText())
            .split("\n")
            .filter((line) => line.trim() && !before.has(line)).length,
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);
    await expect(page.getByText("問い合わせID")).toHaveCount(0);
  });

  test("第4回: 想定外のエラーでは問い合わせIDだけを出し、エラーの詳細を出さない", async ({
    page,
  }) => {
    await findList(page);
    const [link] = await feedbackLinks(page);

    // 詳細を開くときのAPIを、エラーの詳細（stack）付きの500に差し替える
    const stack = "Error: boom\n    at handler (/src/api/feedback.ts:42:13)";
    let intercepted = false;
    await page.route("**/api/**", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      intercepted = true;
      await route.fulfill({
        status: 500,
        headers: { "x-request-id": "req-e2e-500" },
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "internal_error", message: stack, stack, requestId: "req-e2e-500" },
          requestId: "req-e2e-500",
        }),
      });
    });
    await link.click();
    await page.waitForLoadState("networkidle");
    test.skip(!intercepted, "詳細のデータをサーバー側で取得する作りのため、APIの500を再現できない");

    await expect(page.getByText(/問い合わせID\s*[:：]\s*req-e2e-500/)).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/boom|\bat \S+ \(|\.ts:\d+/);
  });
});
