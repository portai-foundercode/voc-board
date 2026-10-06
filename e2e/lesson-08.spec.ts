import { randomInt } from "node:crypto";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type PlaywrightWorkerArgs,
} from "@playwright/test";
import { readDevVars } from "../scripts/lib/dev-vars";

// Basic 認証の資格情報は apps/app/.dev.vars から読む
const vars = readDevVars();
const credentials = {
  username: vars.BASIC_AUTH_USERNAME ?? "",
  password: vars.BASIC_AUTH_PASSWORD ?? "",
};
const password = "password1234";
const acmeOwner = "owner@acme.test";
const feedbackPath = (slug: string) => `/api/projects/${slug}/feedback`;

test.use({ httpCredentials: credentials });

type Playwright = PlaywrightWorkerArgs["playwright"];

const apiContexts: APIRequestContext[] = [];
test.afterEach(async () => {
  await Promise.all(apiContexts.splice(0).map((context) => context.dispose()));
});

// レート制限のカウントがテスト同士・実行同士で混ざらないよう、テストごとに別の送信元IPにする
// （ローカルには Cloudflare がないため、CF-Connecting-IP は E2E が自分で付ける）
const newIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

// email 省略は未ログイン（Basic 認証だけ）。ip は CF-Connecting-IP として付ける
async function apiAs(
  playwright: Playwright,
  baseURL: string | undefined,
  options: { email?: string; ip?: string } = {},
) {
  const origin = baseURL ?? "";
  const context = await playwright.request.newContext({
    baseURL: origin,
    httpCredentials: { ...credentials, send: "always" },
    extraHTTPHeaders: { origin, ...(options.ip ? { "cf-connecting-ip": options.ip } : {}) },
  });
  apiContexts.push(context);
  if (options.email) {
    const response = await context.post("/api/auth/sign-in/email", {
      data: { email: options.email, password },
    });
    expect(response.status()).toBe(200);
  }
  return context;
}

const validInput = (title: string) => ({
  title,
  name: "E2E 太郎",
  email: "e2e@example.com",
  body: "第8回のE2Eで送信しました",
});

let counter = 0;
const uniqueTitle = (label: string) => {
  counter += 1;
  return `${label} ${Date.now()}-${counter}`;
};

type FeedbackItem = { title: string; body: string };

async function listAcmeFeedback(playwright: Playwright, baseURL: string | undefined) {
  const owner = await apiAs(playwright, baseURL, { email: acmeOwner });
  const response = await owner.get("/api/feedback");
  expect(response.status()).toBe(200);
  return ((await response.json()) as { feedback: FeedbackItem[] }).feedback;
}

// hydration前に操作するとブラウザ標準の動作になってしまうため、通信が落ち着くまで待つ
async function gotoAndWaitForHydration(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

async function submitForm(page: Page, title: string, honeypot?: string) {
  await page.getByLabel("タイトル").fill(title);
  await page.getByLabel("名前").fill("E2E 太郎");
  await page.getByLabel("メール").fill("e2e@example.com");
  await page.getByLabel("フィードバック", { exact: true }).fill("第8回のE2Eで送信しました");
  if (honeypot !== undefined) {
    // 人には見えない欄は、botのように値だけを直接入れる
    await page.locator('input[name="website"]').evaluate((input, value) => {
      (input as HTMLInputElement).value = value;
    }, honeypot);
  }
  await page.getByRole("button", { name: "送信する" }).click();
}

test.describe("第8回: レート制限", () => {
  test("同じproject・同じIPの6回目で429になり、別のIP・別のprojectは影響を受けない", async ({
    playwright,
    baseURL,
  }) => {
    const ip = newIp();
    const visitor = await apiAs(playwright, baseURL, { ip });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await visitor.post(feedbackPath("acme"), {
        data: validInput(uniqueTitle("rate")),
      });
      expect(response.status(), `${attempt}回目`).toBe(201);
    }
    const limited = await visitor.post(feedbackPath("acme"), {
      data: validInput(uniqueTitle("rate")),
    });
    expect(limited.status()).toBe(429);
    expect(await limited.json()).toMatchObject({ error: { code: "rate_limited" } });

    // 429のあとも、不正入力やhoneypotの連投は数えられて止まる（保存はされない）
    const stillLimited = await visitor.post(feedbackPath("acme"), { data: { title: "" } });
    expect(stillLimited.status()).toBe(429);

    const otherIp = await apiAs(playwright, baseURL, { ip: newIp() });
    const fromOtherIp = await otherIp.post(feedbackPath("acme"), {
      data: validInput(uniqueTitle("other-ip")),
    });
    expect(fromOtherIp.status()).toBe(201);

    const otherProject = await visitor.post(feedbackPath("globex"), {
      data: validInput(uniqueTitle("other-project")),
    });
    expect(otherProject.status()).toBe(201);
  });

  test("429のとき、公開フォームが再送を促す案内を出す", async ({ page, playwright, baseURL }) => {
    const ip = newIp();
    const visitor = await apiAs(playwright, baseURL, { ip });
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await visitor.post(feedbackPath("acme"), {
        data: validInput(uniqueTitle("rate-ui")),
      });
      expect(response.status()).toBe(201);
    }

    await page.context().setExtraHTTPHeaders({ "cf-connecting-ip": ip });
    await gotoAndWaitForHydration(page, "/p/acme");
    await submitForm(page, uniqueTitle("rate-ui-blocked"));

    await expect(page.getByRole("alert")).toContainText("時間をおいて再送してください");
    await expect(page.getByText("フィードバックを受け付けました")).toHaveCount(0);
  });
});

test.describe("第8回: honeypot", () => {
  test("APIはwebsiteに値がある投稿を201で受けて保存しない", async ({ playwright, baseURL }) => {
    const visitor = await apiAs(playwright, baseURL, { ip: newIp() });
    const spamTitle = uniqueTitle("honeypot-api-spam");
    const humanTitle = uniqueTitle("honeypot-api-human");

    const spam = await visitor.post(feedbackPath("acme"), {
      data: { ...validInput(spamTitle), website: "https://spam.example" },
    });
    expect(spam.status()).toBe(201);
    const human = await visitor.post(feedbackPath("acme"), {
      data: { ...validInput(humanTitle), website: "" },
    });
    expect(human.status()).toBe(201);

    const titles = (await listAcmeFeedback(playwright, baseURL)).map((item) => item.title);
    expect(titles).toContain(humanTitle);
    expect(titles).not.toContain(spamTitle);
  });

  test("画面でも、見えない欄が埋まった投稿は成功表示のまま保存されない", async ({
    page,
    playwright,
    baseURL,
  }) => {
    await page.context().setExtraHTTPHeaders({ "cf-connecting-ip": newIp() });
    const spamTitle = uniqueTitle("honeypot-ui-spam");
    await gotoAndWaitForHydration(page, "/p/acme");
    await expect(page.locator('input[name="website"]')).not.toBeInViewport();
    await submitForm(page, spamTitle, "https://spam.example");
    await expect(page.getByText("フィードバックを受け付けました")).toBeVisible();

    const humanTitle = uniqueTitle("honeypot-ui-human");
    await gotoAndWaitForHydration(page, "/p/acme");
    await submitForm(page, humanTitle);
    await expect(page.getByText("フィードバックを受け付けました")).toBeVisible();

    const titles = (await listAcmeFeedback(playwright, baseURL)).map((item) => item.title);
    expect(titles).toContain(humanTitle);
    expect(titles).not.toContain(spamTitle);
  });
});

test.describe("第8回: 入力の安全性", () => {
  test("制御文字は取り除かれて保存され、改行は残る", async ({ playwright, baseURL }) => {
    const visitor = await apiAs(playwright, baseURL, { ip: newIp() });
    const label = uniqueTitle("control");

    const response = await visitor.post(feedbackPath("acme"), {
      data: {
        ...validInput(`${label}\u0000-\u001b[31m`),
        body: "line1\nli\u0007ne2\u007f",
      },
    });
    expect(response.status()).toBe(201);

    const saved = (await listAcmeFeedback(playwright, baseURL)).find(
      (item) => item.title === `${label}-[31m`,
    );
    expect(saved?.body).toBe("line1\nline2");
  });

  test("制御文字だけのtitleは400になる", async ({ playwright, baseURL }) => {
    const visitor = await apiAs(playwright, baseURL, { ip: newIp() });

    const response = await visitor.post(feedbackPath("acme"), {
      data: { ...validInput("x"), title: "\u0000\u0001\u001b" },
    });

    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "validation_error", fields: { title: expect.any(String) } },
    });
  });

  test("巨大なbodyと長すぎるtitleは400で、保存されない", async ({ playwright, baseURL }) => {
    const visitor = await apiAs(playwright, baseURL, { ip: newIp() });
    const label = uniqueTitle("oversized");

    const hugeBody = await visitor.post(feedbackPath("acme"), {
      data: { ...validInput(label), body: "あ".repeat(100_000) },
    });
    expect(hugeBody.status()).toBe(400);
    expect(await hugeBody.json()).toMatchObject({
      error: { code: "validation_error", fields: { body: expect.any(String) } },
    });

    const longTitle = await visitor.post(feedbackPath("acme"), {
      data: validInput(`${label} ${"a".repeat(101)}`),
    });
    expect(longTitle.status()).toBe(400);
    expect(await longTitle.json()).toMatchObject({
      error: { code: "validation_error", fields: { title: expect.any(String) } },
    });

    const titles = (await listAcmeFeedback(playwright, baseURL)).map((item) => item.title);
    expect(titles.some((title) => title.startsWith(label))).toBe(false);
  });
});

test.describe("第8回: 規約・プライバシーポリシー・問い合わせ", () => {
  const legalPages = [
    { path: "/terms", heading: "利用規約" },
    { path: "/privacy", heading: "プライバシーポリシー" },
    { path: "/contact", heading: "お問い合わせ" },
  ] as const;

  test.describe("資格情報なし", () => {
    test.use({ httpCredentials: undefined });

    for (const { path } of legalPages) {
      test(`${path} は401を返す`, async ({ request }) => {
        const response = await request.get(path, { maxRedirects: 0 });
        expect(response.status()).toBe(401);
      });
    }
  });

  for (const { path, heading } of legalPages) {
    test(`${path} は資格情報ありで「要リーガルチェック」つきで開ける`, async ({ page }) => {
      await gotoAndWaitForHydration(page, path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(page.getByText("要リーガルチェック").first()).toBeVisible();
    });
  }

  for (const start of ["/", "/p/acme"]) {
    test(`${start} のフッターから3つのページへ移動できる`, async ({ page }) => {
      for (const { path, heading } of legalPages) {
        await gotoAndWaitForHydration(page, start);
        await page
          .getByRole("navigation", { name: "フッター" })
          .getByRole("link", { name: heading, exact: true })
          .click();
        await expect(page).toHaveURL(new RegExp(`${path}$`));
        await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      }
    });
  }
});

test.describe("第8回: 拒否の再確認", () => {
  test("未ログインでは管理用APIに入れず、公開フォームの投稿だけ通る", async ({
    playwright,
    baseURL,
  }) => {
    const visitor = await apiAs(playwright, baseURL, { ip: newIp() });

    for (const path of [
      "/api/feedback",
      "/api/dashboard",
      "/api/settings",
      "/api/billing",
      "/api/export/feedback.csv",
    ]) {
      expect((await visitor.get(path)).status(), path).toBe(401);
    }
    const response = await visitor.post(feedbackPath("acme"), {
      data: validInput(uniqueTitle("anonymous")),
    });
    expect(response.status()).toBe(201);
  });
});
