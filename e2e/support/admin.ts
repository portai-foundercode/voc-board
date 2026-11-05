import { readFile } from "node:fs/promises";

import { expect, type Page } from "@playwright/test";

import { apiFetch } from "./auth";
import { captureApiWrite, isApi, submitButton, uniqueToken } from "./feedback";
import { findList, findScreen } from "./screens";

type Captured = Awaited<ReturnType<typeof captureApiWrite>>;

// 送り直すときに、URLと送信内容にある文字列（識別用の文字列やworkspaceのID）を差し替える
export function withNewToken(captured: Captured, oldToken: string, newToken = uniqueToken()) {
  const data = JSON.parse(JSON.stringify(captured.data).replaceAll(oldToken, newToken)) as unknown;
  return { ...captured, url: captured.url.replaceAll(oldToken, newToken), data, token: newToken };
}

export function replay(
  page: Page,
  captured: Pick<Captured, "method" | "url" | "data">,
  headers?: Record<string, string>,
) {
  return apiFetch(page, captured.url, { method: captured.method, data: captured.data, headers });
}

// 画面を開いている間にブラウザが受け取ったAPI（GET）の返事を、あとで中身ごと確かめられるように集める
export function recordApiResponses(page: Page) {
  const bodies: Promise<{ url: string; text: string }>[] = [];
  page.on("response", (response) => {
    if (response.request().method() !== "GET" || !isApi(response.url())) return;
    bodies.push(
      response.text().then(
        (text) => ({ url: response.url(), text }),
        () => ({ url: response.url(), text: "" }),
      ),
    );
  });
  return () => Promise.all(bodies);
}

// 一覧を開いたときに呼ばれ、token の投稿を含む返事をしたAPIを、一覧のAPIとみなす
export async function findListApi(page: Page, token: string) {
  const responses = recordApiResponses(page);
  await findList(page);
  const url = (await responses()).find((response) => response.text.includes(token))?.url;
  if (!url)
    throw new Error(
      "一覧のデータを返すAPIが見つかりません（ブラウザから /api/ を呼ぶ作りを前提にしています）",
    );
  return url;
}

const projectForm = (page: Page) =>
  page
    .locator("form")
    .filter({ hasNot: page.locator('input[type="email"], input[type="password"]') })
    .filter({ has: page.locator('input[type="text"], input:not([type])') })
    .filter({ has: page.getByRole("button", { name: /作成|追加/ }) });

export const findProjectScreen = (page: Page) =>
  findScreen(page, "プロジェクトの作成", async (current) => {
    return (
      (await projectForm(current).count()) > 0 &&
      (await current.locator("body").innerText()).includes("プロジェクト")
    );
  });

// プロジェクト作成の画面で、名前やIDの欄をすべて同じ識別用の文字列で埋めて作成する
export async function createProject(page: Page, token = uniqueToken().toLowerCase()) {
  await findProjectScreen(page);
  const form = projectForm(page).first();
  const captured = await captureApiWrite(page, async () => {
    for (const input of await form
      .locator('input[type="text"]:visible, input:not([type]):visible')
      .all()) {
      await input.fill(token);
    }
    await submitButton(form).click();
  });
  return { ...captured, token };
}

// 一覧の「設定」リンクから設定画面を開き、そのURLを返す（第2回で作った導線）
export async function findSettings(page: Page) {
  const listPath = await findList(page);
  await page
    .getByRole("link", { name: /設定/ })
    .first()
    .click();
  await expect(page).not.toHaveURL((url) => url.pathname + url.search === listPath);
  await page.waitForLoadState("networkidle");
  const url = new URL(page.url());
  return url.pathname + url.search;
}

const csvControl = (page: Page) =>
  page
    .getByRole("button", { name: /CSV/ })
    .or(page.getByRole("link", { name: /CSV/ }))
    .first();

// 一覧のCSVボタンでダウンロードし、中身とAPIのURLを返す
export async function downloadCsv(page: Page) {
  const csvResponse = page
    .waitForResponse(
      (response) => isApi(response.url()) && /csv/i.test(response.headers()["content-type"] ?? ""),
    )
    .catch(() => undefined);
  const [download] = await Promise.all([page.waitForEvent("download"), csvControl(page).click()]);
  const bytes = await readFile(await download.path());
  const fromDownload = download.url().startsWith("http") ? download.url() : undefined;
  const url = fromDownload ?? (await csvResponse)?.url();
  if (!url) throw new Error("CSVを返すAPIのURLが見つかりません");
  return { bytes, text: bytes.toString("utf8"), url };
}

// CSVを使えない人向けの案内。表示されていなければボタンを押して出す
export async function expectCsvNotice(page: Page, notice: string) {
  await findList(page);
  const message = page.getByText(notice).first();
  if (!(await message.isVisible())) {
    const control = csvControl(page);
    if ((await control.count()) > 0 && (await control.isEnabled())) await control.click();
  }
  await expect(message).toBeVisible();
}
