import { expect, test, type Page } from "@playwright/test";

import { downloadCsv, expectCsvNotice, findSettings } from "./support/admin";
import { apiFetch, closeUserPages, credentials, userPage, users } from "./support/auth";
import {
  changeChoice,
  choiceSelect,
  expectChoice,
  openDetail,
  submitFeedback,
  uniqueToken,
} from "./support/feedback";
import { findList, findScreen, open } from "./support/screens";

test.use({ httpCredentials: credentials });
test.afterEach(closeUserPages);

// shop1 に投稿し、shop1 の Member で詳細を開いてカテゴリと優先度を付ける
async function postClassified(page: Page, member: Page, category: string, priority: string) {
  const token = uniqueToken();
  await submitFeedback(page, token, { slug: "shop1" });
  await openDetail(member, token);
  await changeChoice(member, category);
  await changeChoice(member, priority);
  return token;
}

// 一覧の絞り込みで label を選ぶ。選ぶだけで変わる画面と、絞り込むボタンを押す画面の両方に対応する
async function applyFilter(page: Page, label: string) {
  await choiceSelect(page, label).first().selectOption({ label });
  const apply = page.getByRole("button", { name: /絞り込|検索|適用/ });
  if ((await apply.count()) > 0) await apply.first().click();
  await page.waitForLoadState("networkidle");
}

const unhandledPattern = /未対応\D{0,20}?(\d+)/;

const findDashboard = (page: Page) =>
  findScreen(page, "ダッシュボード", async (current) => {
    const text = await current.locator("body").innerText();
    return (
      unhandledPattern.test(text) &&
      ["不具合", "要望", "質問"].every((label) => text.includes(label))
    );
  });

async function unhandledCount(page: Page) {
  await page.reload();
  await page.waitForLoadState("networkidle");
  const match = unhandledPattern.exec(await page.locator("body").innerText());
  return Number(match?.[1]);
}

test.describe("カテゴリ・優先度と絞り込み", () => {
  test("第6回: 詳細でカテゴリと優先度を変えられ、再読込後も残る", async ({ page, browser }) => {
    const member = await userPage(browser, users.shop1Member);
    await postClassified(page, member, "不具合", "高");
    await member.reload();
    await member.waitForLoadState("networkidle");
    await expectChoice(member, "不具合");
    await expectChoice(member, "高");
  });

  test("第6回: 一覧をカテゴリと優先度で絞り込め、条件はURLに残り、再読込や共有でも保たれる", async ({
    page,
    browser,
  }) => {
    const member = await userPage(browser, users.shop1Member);
    const matched = await postClassified(page, member, "不具合", "高");
    const other = await postClassified(page, member, "要望", "低");

    await findList(member);
    await applyFilter(member, "不具合");
    await applyFilter(member, "高");
    await expect(member).toHaveURL((url) => url.search.length > 0);
    await expect(member.getByText(matched).first()).toBeVisible();
    await expect(member.getByText(other)).toHaveCount(0);

    await member.reload();
    await member.waitForLoadState("networkidle");
    await expect(member.getByText(matched).first()).toBeVisible();
    await expect(member.getByText(other)).toHaveCount(0);

    const shared = new URL(member.url());
    const colleague = await userPage(browser, users.shop1Owner);
    await open(colleague, shared.pathname + shared.search);
    await expect(colleague.getByText(matched).first()).toBeVisible();
    await expect(colleague.getByText(other)).toHaveCount(0);
  });
});

test.describe("ダッシュボード", () => {
  test("第6回: 未対応の件数は自分のworkspaceの投稿だけを数える", async ({ page, browser }) => {
    const shop1Member = await userPage(browser, users.shop1Member);
    const dashboard = await findDashboard(shop1Member);
    const shop2Owner = await userPage(browser, users.shop2Owner);
    await open(shop2Owner, dashboard);
    const before = {
      shop1: await unhandledCount(shop1Member),
      shop2: await unhandledCount(shop2Owner),
    };

    await submitFeedback(page, uniqueToken(), { slug: "shop2" });
    expect(await unhandledCount(shop2Owner)).toBe(before.shop2 + 1);
    expect(await unhandledCount(shop1Member)).toBe(before.shop1);
  });
});

test.describe("設定", () => {
  test("第6回: Owner にはメンバー一覧が出て他のworkspaceのメンバーは出ず、Member には出ない", async ({
    browser,
  }) => {
    const owner = await userPage(browser, users.shop1Owner);
    const settings = await findSettings(owner);
    await expect(owner.getByText(users.shop1Member).first()).toBeVisible();
    await expect(owner.getByText(users.shop2Owner)).toHaveCount(0);

    const member = await userPage(browser, users.shop1Member);
    await open(member, settings);
    await expect(member.getByText(users.shop1Owner)).toHaveCount(0);
    await expect(member.getByText(/権限|Owner/).first()).toBeVisible();
  });
});

test.describe("CSV（権限 × プラン）", () => {
  test("第6回: Pro の Owner は文字化けしない自分のworkspaceだけのCSVを受け取り、数式は無害化される", async ({
    page,
    browser,
  }) => {
    const own = uniqueToken();
    const formula = uniqueToken();
    const otherShop = uniqueToken();
    await submitFeedback(page, own, { slug: "shop1" });
    await submitFeedback(page, formula, { slug: "shop1", body: `=1+1 ${formula}` });
    await submitFeedback(page, otherShop, { slug: "shop2" });

    const owner = await userPage(browser, users.shop1Owner);
    await findList(owner);
    const csv = await downloadCsv(owner);
    expect([...csv.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv.text).toContain(own);
    expect(csv.text).not.toContain(otherShop);
    expect(csv.text).toContain("'=1+1");

    // URLに他のworkspaceを足しても、自分のworkspaceの行だけが返る
    const url = new URL(csv.url);
    for (const key of ["workspaceId", "workspace_id", "workspace"])
      url.searchParams.set(key, "shop2");
    expect(await (await apiFetch(owner, url.toString())).text()).not.toContain(otherShop);
  });

  test("第6回: CSVは今の絞り込み条件どおりの行だけを出す", async ({ page, browser }) => {
    const member = await userPage(browser, users.shop1Member);
    const matched = await postClassified(page, member, "不具合", "中");
    const other = await postClassified(page, member, "質問", "中");

    const owner = await userPage(browser, users.shop1Owner);
    await findList(owner);
    await applyFilter(owner, "不具合");
    const csv = await downloadCsv(owner);
    expect(csv.text).toContain(matched);
    expect(csv.text).not.toContain(other);
  });

  test("第6回: Member と Free の Owner は断られ、理由ごとに案内が出る。未ログインは401", async ({
    browser,
  }) => {
    const owner = await userPage(browser, users.shop1Owner);
    await findList(owner);
    const { url } = await downloadCsv(owner);

    const member = await userPage(browser, users.shop1Member);
    await open(member, "/");
    expect((await apiFetch(member, url)).status()).toBe(403);
    await expectCsvNotice(member, "Ownerに依頼してください");

    const freeOwner = await userPage(browser, users.shop2Owner);
    await open(freeOwner, "/");
    expect((await apiFetch(freeOwner, url)).status()).toBe(403);
    await expectCsvNotice(freeOwner, "Proで使えます");

    const visitor = await userPage(browser);
    await open(visitor, "/");
    expect((await apiFetch(visitor, url)).status()).toBe(401);
  });
});
