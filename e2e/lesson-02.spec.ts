import { expect, test } from "@playwright/test";

test("第2回: LPから公開フォームと管理画面デモへのリンクがある", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("link", { name: "フィードバックを送る" })).toHaveAttribute(
    "href",
    "/p/acme",
  );
  await expect(page.getByRole("link", { name: "管理画面デモを見る" })).toHaveAttribute(
    "href",
    "/app/feedback",
  );
});

test("第2回: 公開フォームは必須入力で、送信後に完了表示になり再訪で初期状態に戻る", async ({
  page,
}) => {
  await page.goto("/p/acme");

  for (const name of ["名前", "メール", "フィードバック"]) {
    await expect(page.getByLabel(name)).toHaveJSProperty("required", true);
  }
  await page.getByLabel("名前").fill("山田 太郎");
  await page.getByLabel("メール").fill("taro@example.com");
  await page.getByLabel("フィードバック").fill("CSV出力を使いたいです");
  await page.getByRole("button", { name: "送信する" }).click();
  await expect(page.getByText("フィードバックを受け付けました")).toBeVisible();

  await page.goto("/p/acme");
  await expect(page.getByText("フィードバックを受け付けました")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "送信する" })).toBeVisible();
});

test("第2回: 管理画面の一覧・詳細・見つからない場合の表示", async ({ page }) => {
  await page.goto("/app/feedback");

  await expect(page.getByText("Member / Owner向け").first()).toBeVisible();
  await expect(page.getByTestId("feedback-row")).toHaveCount(3);
  for (const label of ["新着", "確認中", "計画済み"]) {
    await expect(page.getByText(label).first()).toBeVisible();
  }

  await page.getByRole("link", { name: "CSV出力に対応してほしい" }).click();
  await expect(page).toHaveURL(/\/app\/feedback\/fb-001$/);
  await expect(page.getByRole("heading", { name: "CSV出力に対応してほしい" })).toBeVisible();
  await expect(page.getByText("集計結果を社内共有するため、CSVで出力したいです。")).toBeVisible();
  await expect(page.getByText("山田 太郎 / 株式会社サンプル")).toBeVisible();
  await expect(page.getByText("新着").first()).toBeVisible();
  await expect(page.getByText("Member / Owner向け").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "一覧へ戻る" })).toHaveAttribute(
    "href",
    "/app/feedback",
  );

  await page.goto("/app/feedback/missing");
  await expect(page.getByText("フィードバックが見つかりません")).toBeVisible();
  await expect(page.getByRole("link", { name: "一覧へ戻る" })).toHaveAttribute(
    "href",
    "/app/feedback",
  );
});

test("第2回: 共通ナビから料金ページへ移動できる", async ({ page }) => {
  await page.goto("/app/feedback");

  await page.getByRole("link", { name: "料金" }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByText("Owner向け").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Free" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pro" })).toBeVisible();
});
