import { expect, test, type Page } from "@playwright/test";

import { createProject, findListApi, replay, withNewToken } from "./support/admin";
import {
  apiFetch,
  closeUserPages,
  credentials,
  fillLogin,
  findLogin,
  logout,
  userPage,
  users,
} from "./support/auth";
import {
  captureApiWrite,
  changeStatus,
  detailId,
  openDetail,
  recordApiGets,
  submitFeedback,
  uniqueToken,
} from "./support/feedback";
import { findList, open } from "./support/screens";

// 第4回の Basic 認証は第5回でも全ページに掛かったまま
test.use({ httpCredentials: credentials });
test.afterEach(closeUserPages);

// ログインなしの投稿フォームから、shop1 と shop2 に1件ずつ識別用の文字列を入れて投稿する
async function postToBothShops(page: Page) {
  const tokens = { shop1: uniqueToken(), shop2: uniqueToken() };
  await submitFeedback(page, tokens.shop1, { slug: "shop1" });
  await submitFeedback(page, tokens.shop2, { slug: "shop2" });
  return tokens;
}

const passwordField = (page: Page) => page.locator('input[type="password"]');

test.describe("ログインと画面の移動", () => {
  test("第5回: 未ログインで一覧を開くとログイン画面に移る", async ({ browser }) => {
    const member = await userPage(browser, users.shop1Member);
    const listPath = await findList(member);

    const visitor = await userPage(browser);
    await open(visitor, listPath);
    await expect(passwordField(visitor)).toBeVisible();
  });

  test("第5回: Member はログインでき、一覧は自分のworkspaceの投稿だけで、ログアウトできる", async ({
    page,
    browser,
  }) => {
    const tokens = await postToBothShops(page);
    const member = await userPage(browser, users.shop1Member);
    const listPath = await findList(member);
    await expect(member.getByText(tokens.shop1).first()).toBeVisible();
    await expect(member.getByText(tokens.shop2)).toHaveCount(0);

    await logout(member);
    await open(member, listPath);
    await expect(passwordField(member)).toBeVisible();
  });

  test("第5回: shop2 の Owner には shop2 の投稿だけが出る", async ({ page, browser }) => {
    const tokens = await postToBothShops(page);
    const owner = await userPage(browser, users.shop2Owner);
    await findList(owner);
    await expect(owner.getByText(tokens.shop2).first()).toBeVisible();
    await expect(owner.getByText(tokens.shop1)).toHaveCount(0);
  });

  test("第5回: パスワードが違うとログインできない", async ({ browser }) => {
    const visitor = await userPage(browser);
    await findLogin(visitor);
    await fillLogin(visitor, users.shop1Member, "wrong-password");
    await visitor.waitForLoadState("networkidle");
    await expect(passwordField(visitor)).toBeVisible();
  });
});

test.describe("APIの認証と認可", () => {
  test("第5回: 未ログインでは一覧のAPIが401になる（Basic認証は通っていても）", async ({
    page,
    browser,
  }) => {
    const tokens = await postToBothShops(page);
    const member = await userPage(browser, users.shop1Member);
    const listApi = await findListApi(member, tokens.shop1);

    const visitor = await userPage(browser);
    await open(visitor, "/");
    expect((await apiFetch(visitor, listApi)).status()).toBe(401);
  });

  test("第5回: 画面から送られたworkspaceは信用されず、自分のworkspaceのデータだけが返る", async ({
    page,
    browser,
  }) => {
    const tokens = await postToBothShops(page);
    const member = await userPage(browser, users.shop1Member);
    const url = new URL(await findListApi(member, tokens.shop1));
    for (const key of ["workspaceId", "workspace_id", "workspace"])
      url.searchParams.set(key, "shop2");

    const text = await (await apiFetch(member, url.toString())).text();
    expect(text).not.toContain(tokens.shop2);
  });

  test("第5回: Member は自分のworkspaceのステータスを変えられるが、プロジェクトは作れない（403）", async ({
    page,
    browser,
  }) => {
    const tokens = await postToBothShops(page);
    const member = await userPage(browser, users.shop1Member);
    await openDetail(member, tokens.shop1);
    await changeStatus(member, "確認中");

    const owner = await userPage(browser, users.shop1Owner);
    const created = await createProject(owner);
    const denied = await replay(
      member,
      withNewToken(created, created.token, uniqueToken().toLowerCase()),
    );
    expect(denied.status()).toBe(403);
  });

  test("第5回: 他のworkspaceのフィードバックは開けず、ステータスも変えられない（404）", async ({
    page,
    browser,
  }) => {
    const tokens = await postToBothShops(page);
    const shop2Owner = await userPage(browser, users.shop2Owner);
    const apiGets = recordApiGets(shop2Owner);
    await openDetail(shop2Owner, tokens.shop2);
    const detailUrl = new URL(shop2Owner.url());
    const id = detailId(detailUrl.toString());
    const detailApi = apiGets.find((url) => url.includes(id));
    const change = await captureApiWrite(shop2Owner, () => changeStatus(shop2Owner, "確認中"));

    // shop1 の Member は shop2 の詳細のURLを開いても中身を見られない
    const member = await userPage(browser, users.shop1Member);
    await open(member, detailUrl.pathname + detailUrl.search);
    await expect(member.getByText("フィードバックが見つかりません")).toBeVisible();
    await expect(member.getByText(tokens.shop2)).toHaveCount(0);
    if (detailApi) expect((await apiFetch(member, detailApi)).status()).toBe(404);

    // shop1 の Owner が shop2 のフィードバックのステータスを変えようとしても 404
    const owner = await userPage(browser, users.shop1Owner);
    await open(owner, "/");
    expect((await replay(owner, change)).status()).toBe(404);
  });
});

test.describe("プロジェクトの作成と投稿フォーム", () => {
  test("第5回: Owner はプロジェクトを作成でき、そのプロジェクトの投稿フォームができる", async ({
    page,
    browser,
  }) => {
    const owner = await userPage(browser, users.shop1Owner);
    const created = await createProject(owner);
    expect(created.status).toBeLessThan(300);
    await submitFeedback(page, uniqueToken(), { slug: created.token });
  });

  test("第5回: 投稿フォームはログインなしで、shop1 と shop2 のどちらにも投稿できる", async ({
    page,
  }) => {
    await postToBothShops(page);
  });
});
