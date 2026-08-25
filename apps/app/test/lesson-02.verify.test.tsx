import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { afterEach, describe, expect, it } from "vitest";
import { routeTree } from "../src/routeTree.gen";

afterEach(cleanup);

async function renderPath(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(router.state.status).toBe("idle"));
  return router;
}

describe("lesson 02 completion", () => {
  it("links the LP", async () => {
    await renderPath("/");
    expect(screen.getByRole("link", { name: "フィードバックを送る" })).toHaveAttribute(
      "href",
      "/p/acme",
    );
    expect(screen.getByRole("link", { name: "管理画面デモを見る" })).toHaveAttribute(
      "href",
      "/app/feedback",
    );
  });

  it("submits the required form", async () => {
    await renderPath("/p/acme");
    for (const name of ["名前", "メール", "フィードバック"]) {
      expect(screen.getByLabelText(name)).toBeRequired();
    }
    fireEvent.change(screen.getByLabelText("名前"), { target: { value: "山田 太郎" } });
    fireEvent.change(screen.getByLabelText("メール"), { target: { value: "taro@example.com" } });
    fireEvent.change(screen.getByLabelText("フィードバック"), {
      target: { value: "CSV出力を使いたいです" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "送信する" }).closest("form")!);
    expect(await screen.findByText("フィードバックを受け付けました")).toBeInTheDocument();

    cleanup();
    await renderPath("/p/acme");
    expect(screen.queryByText("フィードバックを受け付けました")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "送信する" })).toBeInTheDocument();
  });

  it("shows list, detail, and fallback", async () => {
    const router = await renderPath("/app/feedback");
    expect(screen.getByText("Member / Owner向け")).toBeInTheDocument();
    expect(screen.getAllByTestId("feedback-row")).toHaveLength(3);
    for (const label of ["新着", "確認中", "計画済み"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("link", { name: "CSV出力に対応してほしい" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/feedback/fb-001"));
    expect(screen.getByRole("heading", { name: "CSV出力に対応してほしい" })).toBeInTheDocument();
    expect(
      screen.getByText("集計結果を社内共有するため、CSVで出力したいです。"),
    ).toBeInTheDocument();
    expect(screen.getByText("山田 太郎 / 株式会社サンプル")).toBeInTheDocument();
    expect(screen.getByText("新着")).toBeInTheDocument();
    expect(screen.getByText("Member / Owner向け")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "一覧へ戻る" })).toHaveAttribute(
      "href",
      "/app/feedback",
    );

    cleanup();
    await renderPath("/app/feedback/missing");
    expect(screen.getByText("フィードバックが見つかりません")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "一覧へ戻る" })).toHaveAttribute(
      "href",
      "/app/feedback",
    );
  });

  it("navigates to Owner pricing from the shared navigation", async () => {
    const router = await renderPath("/app/feedback");
    fireEvent.click(screen.getByRole("link", { name: "料金" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/pricing"));
    expect(screen.getByText("Owner向け")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Free" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pro" })).toBeInTheDocument();
  });
});
