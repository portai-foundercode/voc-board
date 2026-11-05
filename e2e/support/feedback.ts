import { expect, type Locator, type Page, type Request } from "@playwright/test";

import { dynamicPaths, findForm, findList, findScreen, normalize, open } from "./screens";

export const uniqueToken = () => `E2E${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

export const isApi = (url: string) => new URL(url).pathname.startsWith("/api/");
export const isApiWrite = (request: Request) => request.method() !== "GET" && isApi(request.url());

// メール欄と本文欄があり、パスワード欄がないフォームを投稿フォームとみなす（ログインのフォームと区別する）
export const feedbackForm = (page: Page) =>
  page
    .locator("form")
    .filter({ has: page.locator('input[type="email"]') })
    .filter({ has: page.locator("textarea") })
    .filter({ hasNot: page.locator('input[type="password"]') });

export const submitButton = (form: Locator) =>
  form.locator('button[type="submit"], button:not([type]), input[type="submit"]').first();

const hasFeedbackForm = async (page: Page) => (await feedbackForm(page).count()) > 0;

// 画面に見えないダミーの入力欄（いたずら対策）かどうか。画面外に置く・透明にするなど隠し方は問わない
const looksHidden = (input: Locator) =>
  input.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      Boolean(element.closest('[aria-hidden="true"]')) ||
      (element as HTMLInputElement).tabIndex < 0 ||
      rect.width <= 1 ||
      rect.height <= 1 ||
      rect.right <= 0 ||
      rect.bottom <= 0 ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    );
  });

export async function textInputs(form: Locator, hidden = false) {
  const inputs = await form.locator('input[type="text"], input:not([type])').all();
  const matched: Locator[] = [];
  for (const input of inputs) {
    if ((await looksHidden(input)) === hidden) matched.push(input);
  }
  return matched;
}

// プロジェクトごとの投稿フォームを探す。URLか画面にプロジェクトのIDが出ている画面を選ぶ。
// 見つからなければ、IDが入るURLの画面にIDを当てはめて開き、それでもなければ shop1 のフォームのURLのIDを差し替える
export async function findProjectForm(page: Page, slug: string) {
  try {
    return await findScreen(page, `${slug}の投稿フォーム`, async (current) => {
      if (!(await hasFeedbackForm(current))) return false;
      return (
        current.url().includes(slug) || (await current.locator("body").innerText()).includes(slug)
      );
    });
  } catch (error) {
    const candidates = dynamicPaths
      .filter((path) => (path.match(/\$/g) ?? []).length === 1)
      .map((path) => path.replace(/\$[^/]+/, slug));
    const shop1Form = await findForm(page).catch(() => "");
    if (shop1Form.includes("shop1")) candidates.push(shop1Form.replaceAll("shop1", slug));
    for (const path of candidates) {
      await open(page, path);
      if (await hasFeedbackForm(page)) return path;
    }
    throw error;
  }
}

// 名前・メール・本文に識別用の文字列を入れて投稿し、投稿APIへのリクエストを返す
export async function submitFeedback(
  page: Page,
  token: string,
  options: { slug?: string; body?: string; expectAccepted?: boolean } = {},
) {
  if (options.slug) await findProjectForm(page, options.slug);
  else await findForm(page);
  const form = feedbackForm(page);
  for (const [index, input] of (await textInputs(form)).entries()) {
    await input.fill(index === 0 ? `山田 ${token}` : token);
  }
  await form.locator('input[type="email"]').fill("taro@example.com");
  await form
    .locator("textarea")
    .first()
    .fill(options.body ?? `${token} のフィードバックです`);
  const posted = page.waitForRequest(isApiWrite);
  await submitButton(form).click();
  if (options.expectAccepted !== false) {
    await expect(page.getByText("フィードバックを受け付けました")).toBeVisible();
  }
  return posted;
}

// 一覧から識別用の文字列を含むフィードバックを開く
export async function openDetail(page: Page, token: string) {
  const listPath = await findList(page);
  const links = page.getByRole("link", { name: new RegExp(token) });
  await links.first().click();
  await expect(page).not.toHaveURL((url) => normalize(url.pathname) === listPath && !url.search);
  // URLは先に変わり、詳細のデータを読み終えるまで一覧が残る作りもあるため、一覧のリンクが消えるまで待つ
  await expect(links).toHaveCount(0);
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

const exactly = (label: string) => new RegExp(`^\\s*${label}\\s*$`);

// 選択肢に label がある選択欄（「中」が「確認中」に一致しないよう完全一致で探す）
export const choiceSelect = (page: Page, label: string) =>
  page.locator("select").filter({ has: page.locator("option", { hasText: exactly(label) }) });

const choiceButton = (page: Page, label: string) =>
  page.getByRole("button", { name: exactly(label) });

// 選ぶ部品（選択欄か、選択肢ごとのボタン）が表示されるまで待つ
async function waitForChoice(page: Page, label: string) {
  await expect(choiceSelect(page, label).or(choiceButton(page, label)).first()).toBeVisible();
}

// 選ぶだけで保存される画面・保存ボタンを押す画面・選択肢ごとのボタンの画面のどれでも、保存の応答まで待つ
export async function changeChoice(page: Page, label: string) {
  await waitForChoice(page, label);
  const select = choiceSelect(page, label).first();
  const isSelect = (await choiceSelect(page, label).count()) > 0;
  // すでに選ばれている値を選び直しても保存は起きないので、何もしない
  if (isSelect && (await select.locator("option:checked").innerText()).trim() === label) return;
  const saved = page.waitForResponse((response) => isApiWrite(response.request()));
  if (isSelect) {
    await select.selectOption({ label });
    const form = select.locator("xpath=ancestor::form[1]");
    const save =
      (await form.count()) > 0
        ? submitButton(form)
        : page.getByRole("button", { name: /更新|保存|変更/ }).first();
    if ((await save.count()) > 0 && (await save.isEnabled())) await save.click();
  } else {
    await choiceButton(page, label).first().click();
  }
  expect((await saved).ok()).toBe(true);
}

export async function expectChoice(page: Page, label: string) {
  await waitForChoice(page, label);
  if ((await choiceSelect(page, label).count()) > 0) {
    const selected = page.locator("select option:checked", { hasText: exactly(label) });
    await expect(selected.first()).toBeAttached();
  } else {
    await expect(page.getByText(label).first()).toBeVisible();
  }
}

export const changeStatus = changeChoice;
export const expectStatus = expectChoice;

// 画面を開いている間にブラウザが呼んだAPI（GET）のURLを集める
export function recordApiGets(page: Page) {
  const urls: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "GET" && isApi(request.url())) urls.push(request.url());
  });
  return urls;
}

// 画面の操作でブラウザが送った書き込みのAPIを、同じ内容で送り直せる形で返す
export async function captureApiWrite(page: Page, action: () => Promise<void>) {
  const response = page.waitForResponse((received) => isApiWrite(received.request()));
  await action();
  const received = await response;
  const sent = received.request();
  return {
    method: sent.method(),
    url: sent.url(),
    data: sent.postDataJSON() as unknown,
    contentType: (await sent.allHeaders())["content-type"] ?? "",
    status: received.status(),
  };
}
