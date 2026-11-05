import { createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { createProject, downloadCsv, findSettings, replay, withNewToken } from "./support/admin";
import { closeUserPages, credentials, devVar, userPage, users } from "./support/auth";
import { captureApiWrite, submitFeedback, uniqueToken } from "./support/feedback";
import { findList, open } from "./support/screens";

test.use({ httpCredentials: credentials });
test.afterEach(closeUserPages);
// shop2 を Free から Pro へ変えていくので順番に実行する（lesson:verify が実行前に db:reset で初期データに戻す）
test.describe.configure({ mode: "serial" });

const webhookSecret = devVar(/WEBHOOK.*SECRET/i);
const seededSession = "cs_test_shop2";

const proButton = (page: Page) => page.getByRole("button", { name: /Proにする/ });

// 権限やプランを読み込み終えるまで押せない表示の画面もあるので、押せるようになるのを少し待ってから判定する
async function canUpgrade(page: Page) {
  return expect(proButton(page).first())
    .toBeEnabled({ timeout: 5_000 })
    .then(
      () => true,
      () => false,
    );
}

// Webhookの窓口はブラウザから呼ばれないので、アプリのソースにある webhook を含むパスを候補にする
function webhookCandidates() {
  const root = "apps/app/src";
  const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((file) =>
    /\.(ts|tsx)$/.test(file),
  );
  const paths = new Set<string>();
  for (const file of files) {
    const source = readFileSync(join(root, file), "utf8");
    for (const match of source.matchAll(/["'`](\/[^"'`\s]*webhook[^"'`\s]*)["'`]/gi)) {
      paths.add(match[1]);
      if (!match[1].startsWith("/api/")) paths.add(`/api${match[1]}`);
    }
  }
  return [...paths];
}

// 署名のない通知に400を返す候補を、Webhookの窓口とみなす（Basic認証の資格情報は付けない）
async function findWebhook(request: APIRequestContext) {
  for (const path of webhookCandidates()) {
    const response = await request.post(path, { data: {} });
    if (response.status() === 400) return path;
  }
  throw new Error(
    `Webhookの窓口が見つかりません（候補: ${webhookCandidates().join(", ") || "なし"}）`,
  );
}

function completedEvent(
  workspace: string,
  session = seededSession,
  id = `evt_e2e_${uniqueToken()}`,
) {
  const metadata = { workspaceId: workspace, workspace_id: workspace, workspace };
  return JSON.stringify({
    id,
    object: "event",
    type: "checkout.session.completed",
    api_version: "2024-06-20",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: {
      object: {
        id: session,
        object: "checkout.session",
        mode: "subscription",
        status: "complete",
        payment_status: "paid",
        client_reference_id: workspace,
        customer: "cus_e2e",
        subscription: "sub_e2e",
        metadata,
      },
    },
  });
}

// Stripe と同じ方式（timestamp.payload の HMAC-SHA256）で署名して送る
function sendSigned(
  request: APIRequestContext,
  path: string,
  payload: string,
  secret = webhookSecret,
) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return request.post(path, {
    data: payload,
    headers: {
      "content-type": "application/json",
      "stripe-signature": `t=${timestamp},v1=${signature}`,
    },
  });
}

async function expectShop2Plan(page: Page, pro: boolean) {
  await findSettings(page);
  expect(await canUpgrade(page)).toBe(!pro);
}

test("第7回: 「Proにする」を押せるのは Free の workspace の Owner だけ", async ({ browser }) => {
  const freeOwner = await userPage(browser, users.shop2Owner);
  await findSettings(freeOwner);
  expect(await canUpgrade(freeOwner)).toBe(true);

  for (const email of [users.shop1Owner, users.shop1Member]) {
    const user = await userPage(browser, email);
    await findSettings(user);
    expect(await canUpgrade(user)).toBe(false);
  }
});

test("第7回: 申し込みは未ログインでは401で、Member とすでに Pro の Owner では断られる", async ({
  browser,
}) => {
  const freeOwner = await userPage(browser, users.shop2Owner);
  await findSettings(freeOwner);
  // テスト用の鍵ではStripeへの接続は失敗するが、申し込みのAPIのURLと内容はここで分かる
  const checkout = await captureApiWrite(freeOwner, () => proButton(freeOwner).first().click());

  const visitor = await userPage(browser);
  await open(visitor, "/");
  expect((await replay(visitor, checkout)).status()).toBe(401);

  // URLや送信内容に workspace が入る作りでは他社扱いの404になるので、shop1 の申し込みに差し替えて送る
  const shop1Checkout = withNewToken(checkout, "shop2", "shop1");
  for (const email of [users.shop1Member, users.shop1Owner]) {
    const user = await userPage(browser, email);
    await open(user, "/");
    const status = (await replay(user, shop1Checkout)).status();
    expect(status, email).toBeGreaterThanOrEqual(400);
    expect(status, email).toBeLessThan(500);
    expect([401, 404], email).not.toContain(status);
  }
});

test("第7回: Free の workspace はフィードバック20件・プロジェクト1件までで、超えると403とProへの案内が出る", async ({
  page,
  browser,
}) => {
  const token = uniqueToken();
  const first = await captureApiWrite(page, async () => {
    await submitFeedback(page, token, { slug: "shop2", expectAccepted: false });
  });
  const statuses = [first.status];
  for (let attempt = 0; attempt < 25 && statuses.at(-1)! < 300; attempt++) {
    statuses.push((await replay(page, withNewToken(first, token))).status());
  }
  expect(statuses.at(-1)).toBe(403);
  expect(statuses.filter((status) => status < 300).length).toBeLessThanOrEqual(20);

  // 上限に達した投稿フォームではProへの案内が出る
  await submitFeedback(page, uniqueToken(), { slug: "shop2", expectAccepted: false });
  await expect(page.getByText(/Pro/).first()).toBeVisible();

  const freeOwner = await userPage(browser, users.shop2Owner);
  const project = await createProject(freeOwner);
  expect(project.status).toBe(403);
  await expect(freeOwner.getByText(/Pro/).first()).toBeVisible();
});

test("第7回: 署名のない・不正な通知は400で、プランは変わらない（Basic認証は要らない）", async ({
  playwright,
  baseURL,
  browser,
}) => {
  const stripe = await playwright.request.newContext({ baseURL });
  const webhook = await findWebhook(stripe);
  expect((await sendSigned(stripe, webhook, completedEvent("shop2"), "whsec_wrong")).status()).toBe(
    400,
  );
  await stripe.dispose();

  await expectShop2Plan(await userPage(browser, users.shop2Owner), false);
});

test("第7回: 署名が正しくても、workspace の不一致・不明な申し込みでは何も変えない", async ({
  playwright,
  baseURL,
  browser,
}) => {
  const stripe = await playwright.request.newContext({ baseURL });
  const webhook = await findWebhook(stripe);
  await sendSigned(stripe, webhook, completedEvent("shop1"));
  await sendSigned(stripe, webhook, completedEvent("shop2", "cs_test_unknown"));
  await stripe.dispose();

  await expectShop2Plan(await userPage(browser, users.shop2Owner), false);
});

test("第7回: 正しい通知で shop2 が Pro になり、CSVが使えて上限なく投稿できる。同じ通知の再送では壊れない", async ({
  page,
  playwright,
  baseURL,
  browser,
}) => {
  const stripe = await playwright.request.newContext({ baseURL });
  const webhook = await findWebhook(stripe);
  const event = completedEvent("shop2");
  expect((await sendSigned(stripe, webhook, event)).status()).toBeLessThan(300);

  const owner = await userPage(browser, users.shop2Owner);
  await expectShop2Plan(owner, true);
  await findList(owner);
  expect((await downloadCsv(owner)).bytes.length).toBeGreaterThan(0);
  await submitFeedback(page, uniqueToken(), { slug: "shop2" });

  // 同じ通知がもう一度届いても、受け付けて状態は Pro のまま
  expect((await sendSigned(stripe, webhook, event)).status()).toBeLessThan(300);
  await stripe.dispose();
  await expectShop2Plan(owner, true);
});
