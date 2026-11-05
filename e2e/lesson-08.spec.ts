import { expect, test, type Page } from "@playwright/test";

import { findListApi, replay, withNewToken } from "./support/admin";
import { apiFetch, closeUserPages, credentials, userPage, users } from "./support/auth";
import {
  captureApiWrite,
  feedbackForm,
  findProjectForm,
  isApiWrite,
  openDetail,
  submitButton,
  submitFeedback,
  textInputs,
  uniqueToken,
} from "./support/feedback";
import { findList, open } from "./support/screens";

test.use({ httpCredentials: credentials });
test.afterEach(closeUserPages);
// レート制限は送信元ごとに数えるので、テストごとに別の送信元として投稿する
test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": randomIp() });
});

// テスト用のアドレス帯（198.18.0.0/15）から、テストどうしで重ならないように選ぶ
const randomIp = () =>
  `198.${18 + Math.floor(Math.random() * 2)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`;

// 画面から1件投稿して、投稿APIを同じ形で送り直せるようにする
async function capturePost(page: Page, slug: string) {
  const token = uniqueToken();
  const captured = await captureApiWrite(page, async () => {
    await submitFeedback(page, token, { slug });
  });
  return { captured, token };
}

// 本文の欄だけを value に差し替える（本文は「{token} のフィードバックです」で投稿している）
function withBody(post: Awaited<ReturnType<typeof capturePost>>, value: string) {
  const original = `${post.token} のフィードバックです`;
  const data = JSON.parse(
    JSON.stringify(post.captured.data).replace(JSON.stringify(original), JSON.stringify(value)),
  );
  return { ...post.captured, data: data as unknown };
}

test.describe("第8回: レート制限", () => {
  test("同じ送信元・同じプロジェクトの6回目で429になり、別の送信元・別のプロジェクトは影響を受けない", async ({
    page,
  }) => {
    const shop1 = await capturePost(page, "shop1");
    const ip = randomIp();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      const response = await replay(page, withNewToken(shop1.captured, shop1.token), {
        "cf-connecting-ip": ip,
      });
      statuses.push(response.status());
    }
    expect(statuses.slice(0, 5).every((status) => status < 300)).toBe(true);
    expect(statuses[5]).toBe(429);

    const otherIp = await replay(page, withNewToken(shop1.captured, shop1.token), {
      "cf-connecting-ip": randomIp(),
    });
    expect(otherIp.status()).toBeLessThan(300);

    // 別のプロジェクト（shop2）には同じ送信元から画面で1件だけ投稿する。Free の上限（初期データ19件＋1件）に収まる
    await page.setExtraHTTPHeaders({ "cf-connecting-ip": ip });
    const otherProject = await capturePost(page, "shop2");
    expect(otherProject.captured.status).toBeLessThan(300);
  });

  test("429のとき、投稿フォームが時間をおいて再送するよう案内する", async ({ page }) => {
    await findProjectForm(page, "shop1");
    await page.route("**/api/**", (route) =>
      isApiWrite(route.request())
        ? route.fulfill({
            status: 429,
            contentType: "application/json",
            body: JSON.stringify({ error: { code: "rate_limited" } }),
          })
        : route.continue(),
    );
    await submitFeedback(page, uniqueToken(), { slug: "shop1", expectAccepted: false });
    await expect(page.getByText("時間をおいて再送してください")).toBeVisible();
  });
});

test.describe("第8回: いたずら対策", () => {
  test("画面に見えないダミーの欄が埋まった投稿は、成功したように見えて保存されない", async ({
    page,
    browser,
  }) => {
    await findProjectForm(page, "shop1");
    const form = feedbackForm(page);
    const [honeypot] = await textInputs(form, true);
    expect(honeypot, "画面に見えないダミーの入力欄がありません").toBeDefined();
    // React などの入力欄にも値が伝わるよう、ブラウザ標準の setter で入れて input イベントを送る
    await honeypot.evaluate((element) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(element, "https://spam.example");
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const token = uniqueToken();
    for (const [index, input] of (await textInputs(form)).entries()) {
      await input.fill(index === 0 ? `山田 ${token}` : token);
    }
    await form.locator('input[type="email"]').fill("taro@example.com");
    await form.locator("textarea").first().fill(`${token} のフィードバックです`);
    await submitButton(form).click();
    await expect(page.getByText("フィードバックを受け付けました")).toBeVisible();

    const owner = await userPage(browser, users.shop1Owner);
    await findList(owner);
    await expect(owner.getByText(token)).toHaveCount(0);
  });
});

test.describe("第8回: 入力の安全性", () => {
  test("制御文字は取り除かれて保存され、改行は残る", async ({ page, browser }) => {
    const post = await capturePost(page, "shop1");
    const token = uniqueToken();
    const response = await replay(page, withBody(post, `${token}\u0007\u0000 1行目\n2行目`));
    expect(response.status()).toBeLessThan(300);

    const owner = await userPage(browser, users.shop1Owner);
    await openDetail(owner, token);
    const html = await owner.content();
    expect(["\u0000", "\u0007"].filter((char) => html.includes(char))).toEqual([]);
    await expect(owner.getByText("2行目").first()).toBeVisible();
  });

  test("大きすぎる本文は400で保存されない", async ({ page, browser }) => {
    const post = await capturePost(page, "shop1");
    const token = uniqueToken();
    const response = await replay(page, withBody(post, `${token} ${"あ".repeat(100_000)}`));
    expect(response.status()).toBe(400);

    const owner = await userPage(browser, users.shop1Owner);
    await findList(owner);
    await expect(owner.getByText(token)).toHaveCount(0);
  });
});

test.describe("第8回: 規約・プライバシーポリシー・問い合わせ", () => {
  for (const [name, needsLegalCheck] of [
    [/利用規約/, true],
    [/プライバシー/, true],
    [/問い合わせ/, false],
  ] as const) {
    test(`${name.source} のページに画面の下からリンクされている`, async ({ page }) => {
      for (const start of ["/", await findProjectForm(page, "shop1")]) {
        await open(page, start);
        await expect(page.getByRole("link", { name }).last()).toBeVisible();
      }
      await page.getByRole("link", { name }).last().click();
      await page.waitForLoadState("networkidle");
      if (needsLegalCheck) await expect(page.getByText("要リーガルチェック").first()).toBeVisible();
    });
  }
});

test.describe("第8回: 拒否の再確認", () => {
  test("未ログインでは一覧のAPIに入れず、投稿フォームの投稿だけ通る", async ({ page, browser }) => {
    const { token } = await capturePost(page, "shop1");
    const owner = await userPage(browser, users.shop1Owner);
    const listApi = await findListApi(owner, token);

    const visitor = await userPage(browser);
    await open(visitor, "/");
    expect((await apiFetch(visitor, listApi)).status()).toBe(401);
  });
});

test.describe("第8回: Basic認証を外した完成版", () => {
  test.use({ httpCredentials: undefined });

  test("資格情報なしでトップ画面と投稿フォームが開け、一覧はログイン画面に移り、一覧のAPIは401のまま", async ({
    page,
    browser,
  }) => {
    const top = await page.goto("/");
    expect(top?.status()).toBeLessThan(400);
    await expect(page.getByText("限定公開β")).toHaveCount(0);
    const { token } = await capturePost(page, "shop1");

    const owner = await userPage(browser, users.shop1Owner);
    const listPath = await findList(owner);
    const listApi = await findListApi(owner, token);

    await open(page, listPath);
    await expect(page.locator('input[type="password"]')).toBeVisible();
    const denied = await apiFetch(page, listApi);
    expect(denied.status()).toBe(401);
    expect(denied.headers()["www-authenticate"] ?? "").not.toMatch(/^Basic /i);
  });
});
