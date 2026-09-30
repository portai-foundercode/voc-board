import { expect, test } from "@playwright/test";

test("第1回: トップページの見出し・説明文・heroレイアウト", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: "顧客の声を、次の一手に。" }),
  ).toBeVisible();
  await expect(page.getByText("顧客の声を、事業の前進に。")).toHaveCount(0);
  await expect(page.getByText("顧客の声を、次の行動へつなげる場所です。")).toBeVisible();
  await expect(page.getByRole("main")).toHaveClass(/(^|\s)hero(\s|$)/);
});
