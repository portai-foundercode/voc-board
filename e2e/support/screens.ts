import { readFileSync } from "node:fs";

import type { Locator, Page } from "@playwright/test";

// 第2回以降は画面のURLを受講者に指定させないため、TanStack Routerが生成したルート一覧の画面を開き、内容で判定する
const routeTree = readFileSync(
  new URL("../../apps/app/src/routeTree.gen.ts", import.meta.url),
  "utf8",
);
const fullPaths = routeTree.match(/interface FileRoutesByFullPath \{([^}]*)\}/)?.[1] ?? "";
export const normalize = (path: string) => (path.length > 1 ? path.replace(/\/$/, "") : path);
const allPaths = [...fullPaths.matchAll(/'([^']+)':/g)].map((match) => normalize(match[1]));
export const staticPaths = allPaths.filter((path) => !path.includes("$"));
// /p/$slug のように、URLの一部にIDなどが入る画面
export const dynamicPaths = allPaths.filter((path) => path.includes("$"));

export const statuses = ["新着", "確認中", "計画済み"];

// hydration前にフォームを送信するとブラウザ標準の送信になってしまうため、通信が落ち着くまで待つ
export async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

const currentPath = (page: Page) => {
  const url = new URL(page.url());
  return normalize(url.pathname) + url.search;
};

// ルート一覧の画面と、そこからリンクで1回たどれる画面（/p/$slug のようなURL）を順に開いて探す
// ログイン画面などへ転送されることもあるので、見つかった画面の実際のURLを返す
export async function findScreen(
  page: Page,
  name: string,
  matches: (page: Page) => Promise<boolean>,
) {
  const queue = staticPaths.map((path) => ({ path, linked: false }));
  const visited = new Set<string>();
  for (const { path, linked } of queue) {
    if (visited.has(path)) continue;
    visited.add(path);
    await open(page, path);
    if (await matches(page)) return currentPath(page);
    if (!linked) {
      for (const target of (await linksByTarget(page)).keys())
        queue.push({ path: target, linked: true });
    }
  }
  throw new Error(`${name}の画面が見つかりません（確認したURL: ${[...visited].join(", ")}）`);
}

export const findForm = (page: Page) =>
  findScreen(page, "投稿フォーム", async (current) => {
    const form = current
      .locator("form")
      .filter({ has: current.locator('input[type="email"]') })
      .filter({ has: current.locator("textarea") })
      .filter({ hasNot: current.locator('input[type="password"]') });
    return (await form.count()) > 0;
  });

// 状態が表示され、各フィードバックの詳細へのリンクがある画面を一覧とみなす（状態別の件数を出すダッシュボードと区別する）
export const findList = (page: Page) =>
  findScreen(page, "フィードバック一覧", async (current) => {
    let shown = false;
    for (const status of statuses) {
      if ((await current.getByText(status).count()) > 0) shown = true;
    }
    return shown && (await feedbackLinks(current)).length > 0;
  });

// 画面内のリンクを、遷移先（同一オリジンのパス + クエリ）ごとに1つずつ返す
export async function linksByTarget(page: Page) {
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

export async function linkTo(page: Page, path: string) {
  const link = (await linksByTarget(page)).get(path);
  if (!link) throw new Error(`${page.url()} に ${path} へのリンクがありません`);
  return link;
}

// ルート一覧にない遷移先を親パスでまとめ、最も多いまとまりを各フィードバックの詳細へのリンクとみなす
export async function feedbackLinks(page: Page) {
  const groups = new Map<string, Locator[]>();
  for (const [target, link] of await linksByTarget(page)) {
    if (staticPaths.includes(target)) continue;
    const url = new URL(target, page.url());
    const parent = url.search ? url.pathname : url.pathname.replace(/\/[^/]+$/, "");
    groups.set(parent, [...(groups.get(parent) ?? []), link]);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length)[0] ?? [];
}

// 詳細画面のURLの、フィードバックを指す部分だけを存在しない値に差し替える
export function missingDetailPath(detailUrl: string) {
  const url = new URL(detailUrl);
  if (url.search) {
    for (const key of url.searchParams.keys()) url.searchParams.set(key, "missing");
  } else {
    url.pathname = url.pathname.replace(/[^/]+\/?$/, "missing");
  }
  return url.pathname + url.search;
}
