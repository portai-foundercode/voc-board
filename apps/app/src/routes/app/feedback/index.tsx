import { Link, createFileRoute } from "@tanstack/react-router";

import { Navigation } from "../../../components/navigation";
import { mockFeedback, statusLabels } from "../../../data/mock-feedback";

export const Route = createFileRoute("/app/feedback/")({ component: FeedbackList });

function FeedbackList() {
  return (
    <>
      <Navigation />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-10 sm:px-8">
        <div className="space-y-2">
          <span className="badge">Member / Owner向け</span>
          <h1 className="text-3xl font-bold">フィードバック一覧</h1>
          <p className="text-base-content/70">届いた声を確認し、次のアクションを検討できます。</p>
        </div>

        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>タイトル</th>
                <th>会社</th>
                <th>ステータス</th>
                <th>受付日</th>
              </tr>
            </thead>
            <tbody>
              {mockFeedback.map((item) => (
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
                  <td>{item.companyName}</td>
                  <td>
                    <span className="badge badge-soft">{statusLabels[item.status]}</span>
                  </td>
                  <td>{item.receivedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
