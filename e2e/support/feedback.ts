import { expect, type Locator, type Page, type Request } from "@playwright/test";

import { findForm, findList, normalize } from "./screens";

export const uniqueToken = () => `E2E${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

const isApi = (url: string) => new URL(url).pathname.startsWith("/api/");
const isApiWrite = (request: Request) => request.method() !== "GET" && isApi(request.url());

export const feedbackForm = (page: Page) =>
  page.locator("form").filter({ has: page.locator('input[type="email"]') });

export const submitButton = (form: Locator) =>
  form.locator('button[type="submit"], button:not([type]), input[type="submit"]').first();

// 名前・メール・本文に識別用の文字列を入れて投稿し、投稿APIへのリクエストを返す
export async function submitFeedback(page: Page, token: string) {
  await findForm(page);
  const form = feedbackForm(page);
  const textInputs = await form.locator('input[type="text"], input:not([type])').all();
  for (const [index, input] of textInputs.entries()) {
    await input.fill(index === 0 ? `山田 ${token}` : token);
  }
  await form.locator('input[type="email"]').fill("taro@example.com");
  await form.locator("textarea").first().fill(`${token} のフィードバックです`);
  const posted = page.waitForRequest(isApiWrite);
  await submitButton(form).click();
  await expect(page.getByText("フィードバックを受け付けました")).toBeVisible();
  return posted;
}

// 一覧から識別用の文字列を含むフィードバックを開く
export async function openDetail(page: Page, token: string) {
  const listPath = await findList(page);
  await page
    .getByRole("link", { name: new RegExp(token) })
    .first()
    .click();
  await expect(page).not.toHaveURL((url) => normalize(url.pathname) === listPath && !url.search);
  // URLは先に変わり、詳細のデータを読み終えるまで一覧が残る作りもあるため、通信が落ち着くまで待つ
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(token).first()).toBeVisible();
}

// 詳細画面のURLから、フィードバックを指す部分を取り出す
export function detailId(detailUrl: string) {
  const url = new URL(detailUrl);
  return url.search
    ? ([...url.searchParams.values()][0] ?? "")
    : (normalize(url.pathname).split("/").at(-1) ?? "");
}

const statusSelect = (page: Page, label: string) =>
  page.locator("select").filter({ has: page.locator("option", { hasText: label }) });

// 状態を選ぶ部品（選択欄か、状態ごとのボタン）が表示されるまで待つ
async function waitForStatusControl(page: Page, label: string) {
  const control = statusSelect(page, label).or(page.getByRole("button", { name: label }));
  await expect(control.first()).toBeVisible();
}

// 選ぶだけで保存される画面・保存ボタンを押す画面・状態ごとのボタンの画面のどれでも、保存の応答まで待つ
export async function changeStatus(page: Page, label: string) {
  await waitForStatusControl(page, label);
  const saved = page.waitForResponse((response) => isApiWrite(response.request()));
  const select = statusSelect(page, label);
  if ((await select.count()) > 0) {
    await select.first().selectOption({ label });
    const save = page.getByRole("button", { name: /更新|保存|変更/ });
    if ((await save.count()) > 0) await save.first().click();
  } else {
    await page.getByRole("button", { name: label }).first().click();
  }
  expect((await saved).ok()).toBe(true);
}

export async function expectStatus(page: Page, label: string) {
  await waitForStatusControl(page, label);
  const select = statusSelect(page, label);
  if ((await select.count()) > 0) {
    await expect(select.first().locator("option:checked")).toHaveText(label);
  } else {
    await expect(page.getByText(label).first()).toBeVisible();
  }
}

// 画面を開いている間にブラウザが呼んだAPI（GET）のURLを集める
export function recordApiGets(page: Page) {
  const urls: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "GET" && isApi(request.url())) urls.push(request.url());
  });
  return urls;
}
