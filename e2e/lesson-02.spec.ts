import { readFileSync } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";

// 第2回は画面のURLを受講者に指定させないため、TanStack Routerが生成したルート一覧の画面を開き、内容で判定する
const routeTree = readFileSync(
  new URL("../apps/app/src/routeTree.gen.ts", import.meta.url),
  "utf8",
);
const fullPaths = routeTree.match(/interface FileRoutesByFullPath \{([^}]*)\}/)?.[1] ?? "";
const normalize = (path: string) => (path.length > 1 ? path.replace(/\/$/, "") : path);
const staticPaths = [...fullPaths.matchAll(/'([^']+)':/g)]
  .map((match) => normalize(match[1]))
  .filter((path) => !path.includes("$"));

const statuses = ["新着", "確認中", "計画済み"];

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

// ルート一覧の画面と、そこからリンクで1回たどれる画面（/p/$slug のようなURL）を順に開いて探す
async function findScreen(page: Page, name: string, matches: (page: Page) => Promise<boolean>) {
  const queue = staticPaths.map((path) => ({ path, linked: false }));
  const visited = new Set<string>();
  for (const { path, linked } of queue) {
    if (visited.has(path)) continue;
    visited.add(path);
    await open(page, path);
    if (await matches(page)) return path;
    if (!linked) {
      for (const target of (await linksByTarget(page)).keys())
        queue.push({ path: target, linked: true });
    }
  }
  throw new Error(`${name}の画面が見つかりません（確認したURL: ${[...visited].join(", ")}）`);
}

const findForm = (page: Page) =>
  findScreen(page, "投稿フォーム", async (current) => {
    return (await current.locator('form input[type="email"]').count()) > 0;
  });

const findList = (page: Page) =>
  findScreen(page, "フィードバック一覧", async (current) => {
    for (const status of statuses) {
      if ((await current.getByText(status).count()) === 0) return false;
    }
    return true;
  });

// 画面内のリンクを、遷移先（同一オリジンのパス + クエリ）ごとに1つずつ返す
async function linksByTarget(page: Page) {
  const origin = new URL(page.url()).origin;
  const anchors = await page.locator("a[href]").evaluateAll((elements) =>
    elements.map((element) => ({
      href: (element as HTMLAnchorElement).href,
      attribute: element.getAttribute("href") ?? "",
    })),
  );
  const links = new Map<string, Locator>();
  for (const { href, attribute } of anchors) {
    const url = new URL(href);
    const target = normalize(url.pathname) + url.search;
    if (url.origin === origin && !links.has(target)) {
      links.set(target, page.locator(`a[href=${JSON.stringify(attribute)}]`).first());
    }
  }
  return links;
}

async function linkTo(page: Page, path: string) {
  const link = (await linksByTarget(page)).get(path);
  if (!link) throw new Error(`${page.url()} に ${path} へのリンクがありません`);
  return link;
}

// ルート一覧にない遷移先を親パスでまとめ、最も多いまとまりを各フィードバックの詳細へのリンクとみなす
async function feedbackLinks(page: Page) {
  const groups = new Map<string, Locator[]>();
  for (const [target, link] of await linksByTarget(page)) {
    if (staticPaths.includes(target)) continue;
    const url = new URL(target, page.url());
    const parent = url.search ? url.pathname : url.pathname.replace(/\/[^/]+$/, "");
    groups.set(parent, [...(groups.get(parent) ?? []), link]);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length)[0] ?? [];
}

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

  const missing = new URL(page.url());
  if (missing.search) {
    for (const key of missing.searchParams.keys()) missing.searchParams.set(key, "missing");
  } else {
    missing.pathname = missing.pathname.replace(/[^/]+\/?$/, "missing");
  }
  await open(page, missing.pathname + missing.search);
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
