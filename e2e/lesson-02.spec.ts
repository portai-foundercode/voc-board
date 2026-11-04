import { expect, test } from "@playwright/test";

import {
  feedbackLinks,
  findForm,
  findList,
  linkTo,
  missingDetailPath,
  normalize,
  open,
  statuses,
} from "./support/screens";

test("第2回: 投稿フォームは名前・メール・本文が必須で、送信後に完了表示になり再訪で初期状態に戻る", async ({
  page,
}) => {
  const formPath = await findForm(page);
  const form = page.locator("form").filter({ has: page.locator('input[type="email"]') });

  const name = form.locator('input[type="text"], input:not([type])').first();
  const email = form.locator('input[type="email"]');
  const body = form.locator("textarea").first();
  for (const field of [name, email, body]) {
    await expect(field).toHaveJSProperty("required", true);
  }
  await name.fill("山田 太郎");
  await email.fill("taro@example.com");
  await body.fill("CSV出力を使いたいです");
  await form
    .locator('button[type="submit"], button:not([type]), input[type="submit"]')
    .first()
    .click();
  await expect(page.getByText("フィードバックを受け付けました")).toBeVisible();

  await open(page, formPath);
  await expect(page.getByText("フィードバックを受け付けました")).toHaveCount(0);
  await expect(page.locator('form input[type="email"]')).toBeVisible();
});

test("第2回: 一覧に状態の異なる3件が並び、詳細を開いて一覧へ戻れる", async ({ page }) => {
  const listPath = await findList(page);
  for (const status of statuses) {
    await expect(page.getByText(status).first()).toBeVisible();
  }
  const links = await feedbackLinks(page);
  expect(links).toHaveLength(3);

  const title =
    (await links[0].innerText())
      .split("\n")
      .find((line) => line.trim())
      ?.trim() ?? "";
  await links[0].click();
  await expect(page).not.toHaveURL((url) => normalize(url.pathname) === listPath && !url.search);
  await expect(page.getByText(title).first()).toBeVisible();
  await expect(page.getByText("フィードバックが見つかりません")).toHaveCount(0);

  await (await linkTo(page, listPath)).click();
  await expect(page).toHaveURL((url) => normalize(url.pathname) === listPath);
});

test("第2回: 存在しないフィードバックでは見つからない旨と一覧へのリンクを表示する", async ({
  page,
}) => {
  const listPath = await findList(page);
  const [link] = await feedbackLinks(page);
  await link.click();
  await expect(page).not.toHaveURL((url) => normalize(url.pathname) === listPath && !url.search);

  await open(page, missingDetailPath(page.url()));
  await expect(page.getByText("フィードバックが見つかりません")).toBeVisible();
  await expect(await linkTo(page, listPath)).toBeVisible();
});

test("第2回: 一覧のnavigationから設定画面へ移動し、FreeとProの料金プランを比べられる", async ({
  page,
}) => {
  const listPath = await findList(page);
  await page
    .getByRole("link", { name: /設定/ })
    .first()
    .click();
  await expect(page).not.toHaveURL((url) => normalize(url.pathname) === listPath);

  await expect(page.getByText(/\bFree\b/).first()).toBeVisible();
  await expect(page.getByText(/\bPro\b/).first()).toBeVisible();
  await expect(await linkTo(page, listPath)).toBeVisible();
});
