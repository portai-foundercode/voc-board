import { Link, createFileRoute } from "@tanstack/react-router";

import { Navigation } from "../../../components/navigation";
import { findFeedbackById, statusLabels } from "../../../data/mock-feedback";

export const Route = createFileRoute("/app/feedback/$feedbackId")({ component: FeedbackDetail });

function FeedbackDetail() {
  const { feedbackId } = Route.useParams();
  const item = findFeedbackById(feedbackId);

  return (
    <>
      <Navigation />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
        {item ? (
          <article className="card card-border">
            <div className="card-body">
              <div className="flex flex-wrap gap-2">
                <span className="badge">Member / Owner向け</span>
                <span className="badge badge-soft">{statusLabels[item.status]}</span>
              </div>
              <h1 className="card-title">{item.title}</h1>
              <p>{item.body}</p>
              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="font-bold">顧客</dt>
                  <dd>
                    {item.customerName} / {item.companyName}
                  </dd>
                </div>
                <div>
                  <dt className="font-bold">受付日</dt>
                  <dd>{item.receivedAt}</dd>
                </div>
              </dl>
              <div className="card-actions">
                <Link className="btn" to="/app/feedback">
                  一覧へ戻る
                </Link>
              </div>
            </div>
          </article>
        ) : (
          <div role="alert" className="alert">
            <div>
              <h1 className="font-bold">フィードバックが見つかりません</h1>
              <Link className="link" to="/app/feedback">
                一覧へ戻る
              </Link>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
