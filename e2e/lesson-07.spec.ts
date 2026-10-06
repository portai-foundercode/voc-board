import { createHmac } from "node:crypto";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type PlaywrightWorkerArgs,
} from "@playwright/test";
import { readDevVars } from "../scripts/lib/dev-vars";

// Basic 認証の資格情報と Webhook の署名 secret は apps/app/.dev.vars から読む（Stripe は呼ばない）
const vars = readDevVars();
const credentials = {
  username: vars.BASIC_AUTH_USERNAME ?? "",
  password: vars.BASIC_AUTH_PASSWORD ?? "",
};
const webhookSecret = vars.STRIPE_WEBHOOK_SECRET ?? "";
const password = "password1234";
const acmeOwner = "owner@acme.test";
const acmeMember = "member@acme.test";
const globexOwner = "owner@globex.test";

test.use({ httpCredentials: credentials });

// Globex を Free から Pro へ変えていくため、1つのスイートの中で順番に実行する（実行前に db:reset が必要）
test.describe.configure({ mode: "serial" });

const seedSessionId = "cs_test_seed_globex";
const webhookPath = "/api/webhooks/stripe";
const planLimitCode = "plan_limit";

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

// Stripe は Basic 認証の資格情報を送れない。Webhook は資格情報なしで届く
async function stripeAs(playwright: Playwright, baseURL: string | undefined) {
  const context = await playwright.request.newContext({ baseURL: baseURL ?? "" });
  apiContexts.push(context);
  return context;
}

// Stripe 形式の署名: t={unix秒},v1={HMAC-SHA256(secret, "{t}.{body}")}
function sign(body: string, secret = webhookSecret, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

// 「Pro 化」のイベント。重複のテストで同じ Event ID のまま再送する
let activatedBody = "";

let eventCounter = 0;
function newEventId() {
  eventCounter += 1;
  return `evt_e2e_${Date.now()}_${eventCounter}`;
}

function completedEvent(options: {
  eventId?: string;
  type?: string;
  sessionId?: string;
  workspaceId?: string;
}) {
  const {
    eventId = newEventId(),
    type = "checkout.session.completed",
    sessionId = seedSessionId,
    workspaceId = "ws-globex",
  } = options;
  return {
    eventId,
    body: JSON.stringify({
      id: eventId,
      object: "event",
      type,
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: sessionId,
          object: "checkout.session",
          mode: "subscription",
          metadata: { workspace_id: workspaceId },
        },
      },
    }),
  };
}

async function postWebhook(
  stripe: APIRequestContext,
  body: string,
  signature: string | null = sign(body),
) {
  return await stripe.post(webhookPath, {
    data: body,
    headers: {
      "content-type": "application/json",
      ...(signature === null ? {} : { "stripe-signature": signature }),
    },
  });
}

const resultOf = async (response: Awaited<ReturnType<typeof postWebhook>>) =>
  ((await response.json()) as { result?: string }).result;

async function planOf(api: APIRequestContext) {
  const response = await api.get("/api/billing");
  expect(response.status()).toBe(200);
  return ((await response.json()) as { plan: string }).plan;
}

async function postPublicFeedback(api: APIRequestContext, slug: string, title: string) {
  return await api.post(`/api/projects/${slug}/feedback`, {
    data: { title, name: "山田 太郎", email: "taro@example.com", body: "E2Eから投稿しました" },
  });
}

const errorCode = async (response: Awaited<ReturnType<typeof postWebhook>>) =>
  ((await response.json()) as { error?: { code?: string } }).error?.code;

test("第7回: 料金ページに Free / Pro が出て、Proにするボタンは Free の owner にだけ出る", async ({
  page,
}) => {
  await loginViaApi(page, globexOwner);
  await gotoAndWaitForHydration(page, "/pricing");
  await expect(page.getByRole("heading", { name: "料金プラン", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Free", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pro", level: 2 })).toBeVisible();
  await expect(page.getByTestId("plan-free")).toContainText("現在のプラン");
  await expect(page.getByTestId("plan-pro")).not.toContainText("現在のプラン");
  await expect(page.getByRole("button", { name: "Proにする" })).toBeVisible();

  await page.context().clearCookies();
  await loginViaApi(page, acmeMember);
  await gotoAndWaitForHydration(page, "/pricing");
  await expect(page.getByRole("button", { name: "Proにする" })).toHaveCount(0);
  await expect(page.getByText("プランを変更できるのはオーナーだけです")).toBeVisible();

  await page.context().clearCookies();
  await loginViaApi(page, acmeOwner);
  await gotoAndWaitForHydration(page, "/pricing");
  await expect(page.getByTestId("plan-pro")).toContainText("現在のプラン");
  await expect(page.getByRole("button", { name: "Proにする" })).toHaveCount(0);
  await expect(page.getByText("Proプランをご利用中です")).toBeVisible();
});

test("第7回: Checkout 作成は未ログイン 401・member 403・すでに Pro は 409（Stripe は呼ばない）", async ({
  playwright,
  baseURL,
}) => {
  const checkout = (api: APIRequestContext) => api.post("/api/billing/checkout");

  const visitor = await apiAs(playwright, baseURL);
  expect((await checkout(visitor)).status()).toBe(401);

  const member = await apiAs(playwright, baseURL, acmeMember);
  const forbidden = await checkout(member);
  expect(forbidden.status()).toBe(403);
  expect(await errorCode(forbidden)).toBe("forbidden_role");

  const proOwner = await apiAs(playwright, baseURL, acmeOwner);
  const conflict = await checkout(proOwner);
  expect(conflict.status()).toBe(409);
  expect(await errorCode(conflict)).toBe("already_pro");

  expect(await planOf(await apiAs(playwright, baseURL, globexOwner))).toBe("free");
});

test("第7回: Free の Globex は feedback が20件目まで作れ、21件目と2件目の project は 403 plan_limit", async ({
  playwright,
  baseURL,
}) => {
  const visitor = await apiAs(playwright, baseURL);
  const owner = await apiAs(playwright, baseURL, globexOwner);
  const listed = async () =>
    ((await (await owner.get("/api/feedback")).json()) as { feedback: unknown[] }).feedback;
  expect(await listed()).toHaveLength(19);

  expect((await postPublicFeedback(visitor, "globex", "上限確認 20件目")).status()).toBe(201);
  const over = await postPublicFeedback(visitor, "globex", "上限確認 21件目");
  expect(over.status()).toBe(403);
  expect(await errorCode(over)).toBe(planLimitCode);
  expect(await listed()).toHaveLength(20);

  // 他の workspace（Acme は Pro）には影響しない
  expect((await postPublicFeedback(visitor, "acme", "Acmeは上限なし")).status()).toBe(201);

  const projects = async () =>
    ((await (await owner.get("/api/projects")).json()) as { projects: unknown[] }).projects;
  expect(await projects()).toHaveLength(1);
  const created = await owner.post("/api/projects", {
    data: { name: "Second", slug: `globex-second-${Date.now()}` },
  });
  expect(created.status()).toBe(403);
  expect(await errorCode(created)).toBe(planLimitCode);
  expect(await projects()).toHaveLength(1);
});

test("第7回: 上限に達した Free には画面で Pro への案内が出る", async ({ page }) => {
  await loginViaApi(page, globexOwner);
  await gotoAndWaitForHydration(page, "/app/feedback");
  const notice = page.getByTestId("plan-limit-notice");
  await expect(notice).toContainText("Freeプランの上限（20件）に達しています");
  await expect(notice.getByRole("link", { name: "Proにする" })).toHaveAttribute("href", "/pricing");

  await gotoAndWaitForHydration(page, "/app/projects");
  await page.getByLabel("プロジェクト名").fill("Second Project");
  await page.getByLabel("スラッグ").fill(`globex-second-ui-${Date.now()}`);
  await page.getByRole("button", { name: "プロジェクトを作成" }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Freeプランのプロジェクトは1件までです");
  await expect(alert.getByRole("link", { name: "料金プラン" })).toHaveAttribute("href", "/pricing");

  // 公開フォームの訪問者には、プランの内部事情ではなく受け付けていない旨だけを出す
  await page.context().clearCookies();
  await gotoAndWaitForHydration(page, "/p/globex");
  await page.getByLabel("タイトル").fill("上限後の投稿");
  await page.getByLabel("名前").fill("山田 太郎");
  await page.getByLabel("メール").fill("taro@example.com");
  await page.getByLabel("フィードバック").fill("E2Eから投稿しました");
  await page.getByRole("button", { name: "送信する" }).click();
  await expect(page.getByRole("alert")).toContainText("現在このフォームは投稿を受け付けていません");
});

test("第7回: 署名のない・不正な Webhook は 400 で、プランは変わらない（Basic 認証は不要）", async ({
  playwright,
  baseURL,
}) => {
  const stripe = await stripeAs(playwright, baseURL);
  const { body } = completedEvent({});
  const now = Math.floor(Date.now() / 1000);

  const attempts: [string, string | null][] = [
    ["署名なし", null],
    ["形式が違う署名", "invalid"],
    ["別 secret の署名", sign(body, "whsec_someone_else")],
    ["body 改ざん", sign(body.replace("ws-globex", "ws-acme"))],
    ["古い timestamp", sign(body, webhookSecret, now - 3600)],
  ];
  for (const [label, signature] of attempts) {
    const response = await postWebhook(stripe, body, signature);
    expect(response.status(), label).toBe(400);
    expect(await errorCode(response), label).toBe("invalid_signature");
  }

  expect(await planOf(await apiAs(playwright, baseURL, globexOwner))).toBe("free");
});

test("第7回: 署名が正しくても、workspace 不一致・不明な Session・対象外のイベントでは何も変えない", async ({
  playwright,
  baseURL,
}) => {
  const stripe = await stripeAs(playwright, baseURL);
  const cases = [
    ["workspace_mismatch", completedEvent({ workspaceId: "ws-acme" })],
    ["unknown_session", completedEvent({ sessionId: "cs_test_unknown" })],
    ["ignored_type", completedEvent({ type: "invoice.paid" })],
  ] as const;

  for (const [result, event] of cases) {
    const response = await postWebhook(stripe, event.body);
    expect(response.status(), result).toBe(200);
    expect(await resultOf(response), result).toBe(result);
  }

  expect(await planOf(await apiAs(playwright, baseURL, globexOwner))).toBe("free");
});

test("第7回: 成功ページは「反映中」を出すだけでプランを変えず、Webhook の後に Pro へ変わる", async ({
  page,
  playwright,
  baseURL,
}) => {
  await loginViaApi(page, globexOwner);
  await gotoAndWaitForHydration(page, `/pricing/success?session_id=${seedSessionId}`);
  const status = page.getByRole("status");
  await expect(page.getByRole("heading", { name: "お申し込みありがとうございます" })).toBeVisible();
  await expect(status).toContainText("プランを反映中です");
  expect(await planOf(await apiAs(playwright, baseURL, globexOwner))).toBe("free");

  const { body } = completedEvent({});
  const response = await postWebhook(await stripeAs(playwright, baseURL), body);
  expect(response.status()).toBe(200);
  expect(await resultOf(response)).toBe("activated");
  activatedBody = body;

  // ページは再取得して表示を変える
  await expect(status).toContainText("Proプランが有効になりました", { timeout: 20_000 });
  expect(await planOf(await apiAs(playwright, baseURL, globexOwner))).toBe("pro");
});

test("第7回: Pro になった Globex は CSV を出力でき、上限なく作成できる", async ({
  playwright,
  baseURL,
}) => {
  const owner = await apiAs(playwright, baseURL, globexOwner);
  const csv = await owner.get("/api/export/feedback.csv");
  expect(csv.status()).toBe(200);

  const visitor = await apiAs(playwright, baseURL);
  expect((await postPublicFeedback(visitor, "globex", "Pro 21件目")).status()).toBe(201);
  expect((await postPublicFeedback(visitor, "globex", "Pro 22件目")).status()).toBe(201);

  const created = await owner.post("/api/projects", {
    data: { name: "Second", slug: `globex-second-pro-${Date.now()}` },
  });
  expect(created.status()).toBe(201);
});

test("第7回: 同じイベントの再送は 200 duplicate で、状態は壊れない", async ({
  playwright,
  baseURL,
}) => {
  expect(activatedBody).not.toBe("");
  const stripe = await stripeAs(playwright, baseURL);
  const retry = await postWebhook(stripe, activatedBody);
  expect(retry.status()).toBe(200);
  expect(await resultOf(retry)).toBe("duplicate");

  const owner = await apiAs(playwright, baseURL, globexOwner);
  expect(await planOf(owner)).toBe("pro");
  expect((await owner.get("/api/export/feedback.csv")).status()).toBe(200);
});
