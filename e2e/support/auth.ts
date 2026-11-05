import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { readDevVars } from "../../scripts/lib/dev-vars";
import { submitButton } from "./feedback";
import { findScreen, normalize } from "./screens";

// 資格情報や鍵は apps/app/.dev.vars から読む。変数名は受講者に指定していないので、名前の一部で探す
const vars = readDevVars();
export const devVar = (pattern: RegExp) =>
  Object.entries(vars).find(([key]) => pattern.test(key))?.[1] ?? "";

// 第8回でBasic認証を外したあとは値がなくなるので、そのときは資格情報を付けない
const basicUsername = devVar(/BASIC.*USER/i);
export const credentials = basicUsername
  ? { username: basicUsername, password: devVar(/BASIC.*PASS/i) }
  : undefined;

// 第5回のスライドで受講者に作ってもらうテスト用ユーザー
export const password = "password1234";
export const users = {
  shop1Owner: "owner@shop1.test",
  shop1Member: "member@shop1.test",
  shop2Owner: "owner@shop2.test",
} as const;

const loginForm = (page: Page) =>
  page.locator("form").filter({ has: page.locator('input[type="password"]') });

// 未ログインで開くとパスワード欄のある画面に出会うので、それをログイン画面とみなす
export const findLogin = (page: Page) =>
  findScreen(page, "ログイン", async (current) => (await loginForm(current).count()) > 0);

export async function fillLogin(page: Page, email: string, userPassword = password) {
  const form = loginForm(page);
  await form
    .locator('input[type="email"], input[autocomplete="email"], input[autocomplete="username"]')
    .first()
    .fill(email);
  await form.locator('input[type="password"]').fill(userPassword);
  await submitButton(form).click();
}

export async function login(page: Page, email: string) {
  const loginPath = await findLogin(page);
  await fillLogin(page, email);
  await expect(page).not.toHaveURL((url) => normalize(url.pathname) === loginPath.split("?")[0]);
  await page.waitForLoadState("networkidle");
}

const contexts: BrowserContext[] = [];

// Basic認証だけを通したブラウザを作り、email を渡したらそのユーザーでログインする
export async function userPage(browser: Browser, email?: string) {
  const context = await browser.newContext({
    httpCredentials: credentials && { ...credentials, send: "always" },
  });
  contexts.push(context);
  const page = await context.newPage();
  if (email) await login(page, email);
  return page;
}

// 各テストの後に test.afterEach(closeUserPages) で閉じる
export async function closeUserPages() {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
}

export async function logout(page: Page) {
  await page
    .getByRole("button", { name: /ログアウト/ })
    .or(page.getByRole("link", { name: /ログアウト/ }))
    .first()
    .click();
  await page.waitForLoadState("networkidle");
}

// 画面と同じログイン状態・同じOriginでAPIを呼ぶ（CSRF対策でOriginを確かめるアプリもあるため）
export function apiFetch(
  page: Page,
  url: string,
  options: { method?: string; data?: unknown; headers?: Record<string, string> } = {},
) {
  const origin = new URL(page.url() === "about:blank" ? url : page.url()).origin;
  return page.request.fetch(url, {
    method: options.method ?? "GET",
    data: options.data,
    headers: { origin, ...options.headers },
    maxRedirects: 0,
  });
}
