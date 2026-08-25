import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Navigation } from "../../../components/navigation";
import { listFeedback } from "../../../data/feedback-api";
import type { Feedback, FeedbackStatus } from "../../../domain/feedback";

export const Route = createFileRoute("/app/feedback/")({ component: FeedbackList });

const projectSlug = "acme";
const statusLabels: Record<FeedbackStatus, string> = {
  new: "新着",
  reviewing: "確認中",
  planned: "計画済み",
};

type ListState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "success"; feedback: Feedback[] };

function FeedbackList() {
  const [requestKey, setRequestKey] = useState(0);
  const [state, setState] = useState<ListState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });

    void listFeedback(projectSlug, controller.signal)
      .then((feedback) => {
        if (!controller.signal.aborted) setState({ status: "success", feedback });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" });
      });

    return () => controller.abort();
  }, [requestKey]);

  return (
    <>
      <Navigation />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-10 sm:px-8">
        <div className="space-y-2">
          <span className="badge">Member / Owner向け</span>
          <h1 className="text-3xl font-bold">フィードバック一覧</h1>
          <p className="text-base-content/70">届いた声を確認し、次のアクションを検討できます。</p>
        </div>

        {state.status === "loading" ? (
          <div role="status">
            <span aria-hidden="true" className="loading align-middle" />
            <span className="ml-2">読み込み中</span>
          </div>
        ) : state.status === "error" ? (
          <div role="alert" className="alert alert-error">
            <span>読み込みに失敗しました</span>
            <button className="btn" type="button" onClick={() => setRequestKey((key) => key + 1)}>
              再試行
            </button>
          </div>
        ) : state.feedback.length === 0 ? (
          <p>フィードバックはありません</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>タイトル</th>
                  <th>投稿者</th>
                  <th>ステータス</th>
                  <th>受付日</th>
                </tr>
              </thead>
              <tbody>
                {state.feedback.map((item) => (
                  <tr key={item.id} data-testid="feedback-row">
                    <td>
                      <Link
                        className="link"
                        to="/app/feedback/$feedbackId"
                        params={{ feedbackId: item.id }}
                      >
                        {item.title}
                      </Link>
                    </td>
                    <td>{item.name}</td>
                    <td>
                      <span className="badge">{statusLabels[item.status]}</span>
                    </td>
                    <td>{item.createdAt.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
