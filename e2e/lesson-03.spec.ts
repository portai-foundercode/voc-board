import { spawn, type ChildProcess } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

const restartPort = 3100;
const restartOrigin = `http://localhost:${restartPort}`;

const uniqueTitle = (prefix: string) =>
  `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// hydration前にフォームを送信するとブラウザ標準の送信になってしまうため、通信が落ち着くまで待つ
async function gotoAndWaitForHydration(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

async function submitFeedback(page: Page, origin: string, title: string) {
  await gotoAndWaitForHydration(page, `${origin}/p/acme`);
  await page.getByLabel("タイトル").fill(title);
  await page.getByLabel("名前").fill("山田 太郎");
  await page.getByLabel("メール").fill("taro@example.com");
  await page.getByLabel("フィードバック").fill("E2Eから投稿したフィードバックです");
  await page.getByRole("button", { name: "送信する" }).click();
  await expect(page.getByText("フィードバックを受け付けました")).toBeVisible();
}

async function openDetail(page: Page, origin: string, title: string) {
  await gotoAndWaitForHydration(page, `${origin}/app/feedback`);
  await page.getByRole("link", { name: title }).click();
  await expect(page).toHaveURL(/\/app\/feedback\/[^/]+$/);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

const statusSelect = (page: Page) => page.getByRole("combobox", { name: "ステータス" });

async function changeStatus(page: Page, label: string, value: string) {
  await statusSelect(page).selectOption({ label });
  await page.getByRole("button", { name: /ステータスを更新|更新/ }).click();
  await expect(statusSelect(page)).toHaveValue(value);
}

test("第3回: 投稿が一覧に出て、詳細に遷移できる", async ({ page }) => {
  const title = uniqueTitle("一覧確認");
  await submitFeedback(page, "", title);
  await openDetail(page, "", title);
});

test("第3回: statusを変更でき、再読込後も残る", async ({ page }) => {
  const title = uniqueTitle("status確認");
  await submitFeedback(page, "", title);
  await openDetail(page, "", title);

  await changeStatus(page, "確認中", "reviewing");
  await page.reload();
  await expect(statusSelect(page)).toHaveValue("reviewing");
});

test("第3回: 空欄で送信すると項目ごとにエラーが表示される", async ({ page }) => {
  await gotoAndWaitForHydration(page, "/p/acme");
  // ブラウザ標準のrequired検証を外して、サーバー側の検証結果を表示させる
  await page.locator("form").evaluate((form) => {
    (form as HTMLFormElement).noValidate = true;
  });
  await page.getByRole("button", { name: "送信する" }).click();

  await expect(page.getByText("フィードバックを受け付けました")).toHaveCount(0);
  // 各入力欄のlabel内に、項目名以外のエラー文が表示される
  for (const name of ["タイトル", "名前", "メール", "フィードバック"]) {
    const label = page.locator("label").filter({ has: page.getByLabel(name) });
    await expect(label).not.toHaveText(name, { timeout: 10_000 });
    await expect(label.locator("input, textarea")).toBeVisible();
  }
});

test("第3回: API は不正入力で400、存在しないものは404を返す", async ({ request }) => {
  const invalid = await request.post("/api/projects/acme/feedback", { data: {} });
  expect(invalid.status()).toBe(400);

  expect((await request.get("/api/projects/missing/feedback")).status()).toBe(404);
  expect((await request.get("/api/projects/acme/feedback/missing")).status()).toBe(404);
});

// 永続化の確認にはサーバーの再起動が必要なので、専用portでdev serverを自前で起動・停止する
function startDevServer() {
  return spawn(
    "pnpm",
    [
      "--filter",
      "@voc-board/app",
      "exec",
      "vite",
      "dev",
      "--port",
      String(restartPort),
      "--strictPort",
    ],
    {
      detached: true,
      stdio: "ignore",
    },
  );
}

async function stopDevServer(server: ChildProcess) {
  if (server.pid === undefined || server.exitCode !== null) return;
  const exited = new Promise((resolve) => server.once("exit", resolve));
  process.kill(-server.pid, "SIGTERM");
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

test("第3回: dev server を再起動しても投稿とstatus変更が残る", async ({ page }) => {
  test.setTimeout(240_000);
  const title = uniqueTitle("永続化確認");

  let server = startDevServer();
  try {
    await waitForServer();
    await submitFeedback(page, restartOrigin, title);
    await openDetail(page, restartOrigin, title);
    await changeStatus(page, "計画済み", "planned");

    await stopDevServer(server);
    server = startDevServer();
    await waitForServer();

    await openDetail(page, restartOrigin, title);
    await expect(statusSelect(page)).toHaveValue("planned");
  } finally {
    await stopDevServer(server);
  }
});
