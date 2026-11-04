import { spawn, spawnSync, type ChildProcess } from "node:child_process";

import { expect, test } from "@playwright/test";

import {
  changeStatus,
  detailId,
  expectStatus,
  feedbackForm,
  openDetail,
  recordApiGets,
  submitButton,
  submitFeedback,
  uniqueToken,
} from "./support/feedback";
import { findForm, missingDetailPath, open } from "./support/screens";

const isWindows = process.platform === "win32";
const restartPort = 3100;
const restartOrigin = `http://localhost:${restartPort}`;

test("第3回: 投稿が一覧に出て詳細を開け、ステータスの変更が再読込後も残る", async ({ page }) => {
  const token = uniqueToken();
  await submitFeedback(page, token);
  await openDetail(page, token);

  await changeStatus(page, "確認中");
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expectStatus(page, "確認中");
});

test("第3回: 空欄で送信すると項目ごとにエラーが表示される", async ({ page }) => {
  await findForm(page);
  const form = feedbackForm(page);
  // ブラウザ標準のrequired検証を外して、アプリ側の検証結果を表示させる
  await form.evaluate((element) => {
    (element as HTMLFormElement).noValidate = true;
  });
  const before = new Set((await page.locator("body").innerText()).split("\n"));
  await submitButton(form).click();

  await expect(page.getByText("フィードバックを受け付けました")).toHaveCount(0);
  // エラー文の書き方は問わず、名前・メール・本文の3項目ぶん新しい行が増えたことを確かめる
  await expect
    .poll(
      async () =>
        (await page.locator("body").innerText())
          .split("\n")
          .filter((line) => line.trim() && !before.has(line)).length,
      { timeout: 10_000 },
    )
    .toBeGreaterThanOrEqual(3);
});

test("第3回: 存在しないフィードバックを開くと見つからない旨が表示される", async ({ page }) => {
  const token = uniqueToken();
  await submitFeedback(page, token);
  await openDetail(page, token);

  await open(page, missingDetailPath(page.url()));
  await expect(page.getByText("フィードバックが見つかりません")).toBeVisible();
});

test("第3回: APIは入力の誤りに400、存在しないフィードバックに404を返す", async ({
  page,
  request,
}) => {
  const token = uniqueToken();
  const posted = await submitFeedback(page, token);
  const isJson = ((await posted.allHeaders())["content-type"] ?? "").includes("json");
  const invalid = isJson
    ? await request.post(posted.url(), { data: {} })
    : await request.post(posted.url(), { form: {} });
  expect(invalid.status()).toBe(400);

  // 詳細を開いたときにブラウザが呼んだAPIがあればそれを、なければ投稿APIの下を詳細APIとみなす
  const apiGets = recordApiGets(page);
  await openDetail(page, token);
  const id = detailId(page.url());
  const detailApi = apiGets.find((url) => url.includes(id));
  const missingApi = detailApi ? detailApi.replace(id, "missing") : `${posted.url()}/missing`;
  expect((await request.get(missingApi)).status()).toBe(404);
});

// 永続化の確認にはサーバーの再起動が必要なので、専用portでdev serverを自前で起動・停止する
// Windows でも pnpm の .cmd を経由せずに起動できるよう、vite の JS を Node で直接実行する
function startDevServer() {
  return spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "dev", "--port", String(restartPort), "--strictPort"],
    {
      cwd: "apps/app",
      // POSIX ではプロセスグループごと止めるため、別グループで起動する
      detached: !isWindows,
      stdio: "ignore",
    },
  );
}

// vite が起動した workerd などの子プロセスもまとめて止める
async function stopDevServer(server: ChildProcess) {
  if (server.pid === undefined || server.exitCode !== null) return;
  const exited = new Promise((resolve) => server.once("exit", resolve));
  if (isWindows) spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"]);
  else process.kill(-server.pid, "SIGTERM");
  await exited;
}

async function waitForServer() {
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`${restartOrigin}/api/health`)).status;
        } catch {
          return 0;
        }
      },
      { timeout: 90_000, intervals: [500] },
    )
    .toBe(200);
}

test("第3回: 開発サーバーを再起動しても投稿とステータスの変更が残る", async ({ browser }) => {
  test.setTimeout(240_000);
  const token = uniqueToken();
  const context = await browser.newContext({ baseURL: restartOrigin });
  const page = await context.newPage();

  let server = startDevServer();
  try {
    await waitForServer();
    await submitFeedback(page, token);
    await openDetail(page, token);
    await changeStatus(page, "計画済み");

    await stopDevServer(server);
    server = startDevServer();
    await waitForServer();

    await openDetail(page, token);
    await expectStatus(page, "計画済み");
  } finally {
    await stopDevServer(server);
    await context.close();
  }
});
