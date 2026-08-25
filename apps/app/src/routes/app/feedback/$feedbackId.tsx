import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { Navigation } from "../../../components/navigation";
import { getFeedback, updateFeedbackStatus } from "../../../data/feedback-api";
import type { Feedback, FeedbackStatus } from "../../../domain/feedback";

export const Route = createFileRoute("/app/feedback/$feedbackId")({
  component: FeedbackDetailRoute,
});

const projectSlug = "acme";
const statusLabels: Record<FeedbackStatus, string> = {
  new: "新着",
  reviewing: "確認中",
  planned: "計画済み",
};

type DetailState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error" }
  | { status: "success"; feedback: Feedback };

function FeedbackDetailRoute() {
  const { feedbackId } = Route.useParams();
  return <FeedbackDetail key={feedbackId} feedbackId={feedbackId} />;
}

function FeedbackDetail({ feedbackId }: { feedbackId: string }) {
  const [requestKey, setRequestKey] = useState(0);
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const [selectedStatus, setSelectedStatus] = useState<FeedbackStatus>("new");
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string>();
  const updateController = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    updateController.current?.abort();
    setState({ status: "loading" });
    setIsUpdating(false);
    setUpdateError(undefined);

    void getFeedback(projectSlug, feedbackId, controller.signal)
      .then((feedback) => {
        if (controller.signal.aborted) return;
        setState({ status: "success", feedback });
        setSelectedStatus(feedback.status);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const status = (error as { status?: unknown }).status;
        setState({ status: status === 404 ? "not-found" : "error" });
      });

    return () => {
      controller.abort();
      updateController.current?.abort();
    };
  }, [feedbackId, requestKey]);

  const handleStatusUpdate = async () => {
    updateController.current?.abort();
    const controller = new AbortController();
    updateController.current = controller;
    setIsUpdating(true);
    setUpdateError(undefined);

    try {
      await updateFeedbackStatus(projectSlug, feedbackId, selectedStatus, controller.signal);
      if (controller.signal.aborted) return;

      try {
        const feedback = await getFeedback(projectSlug, feedbackId, controller.signal);
        if (controller.signal.aborted) return;
        setState({ status: "success", feedback });
        setSelectedStatus(feedback.status);
      } catch {
        if (controller.signal.aborted) return;
        setUpdateError("更新後の再取得に失敗しました");
      }
    } catch {
      if (controller.signal.aborted) return;
      setUpdateError("ステータスの更新に失敗しました");
    } finally {
      if (!controller.signal.aborted) setIsUpdating(false);
      if (updateController.current === controller) updateController.current = undefined;
    }
  };

  return (
    <>
      <Navigation />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
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
        ) : state.status === "not-found" ? (
          <div role="alert" className="alert alert-warning">
            <div>
              <h1 className="font-bold">フィードバックが見つかりません</h1>
              <Link className="link" to="/app/feedback">
                一覧へ戻る
              </Link>
            </div>
          </div>
        ) : (
          <article className="card">
            <div className="card-body">
              <div className="flex flex-wrap gap-2">
                <span className="badge">Member / Owner向け</span>
                <span className="badge">{statusLabels[state.feedback.status]}</span>
              </div>
              <h1 className="card-title">{state.feedback.title}</h1>
              <p>{state.feedback.body}</p>
              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="font-bold">顧客</dt>
                  <dd>
                    {state.feedback.name} / {state.feedback.email}
                  </dd>
                </div>
                <div>
                  <dt className="font-bold">受付日</dt>
                  <dd>{state.feedback.createdAt.slice(0, 10)}</dd>
                </div>
              </dl>
              <fieldset className="fieldset">
                <legend className="fieldset-legend">ステータス</legend>
                <select
                  aria-label="ステータス"
                  className="select"
                  disabled={isUpdating}
                  value={selectedStatus}
                  onChange={(event) => setSelectedStatus(event.target.value as FeedbackStatus)}
                >
                  <option value="new">新着</option>
                  <option value="reviewing">確認中</option>
                  <option value="planned">計画済み</option>
                </select>
                {updateError ? <span className="label text-error">{updateError}</span> : null}
              </fieldset>
              <div className="card-actions">
                <button
                  className="btn"
                  disabled={isUpdating}
                  type="button"
                  onClick={handleStatusUpdate}
                >
                  ステータスを更新
                </button>
                <Link className="btn" to="/app/feedback">
                  一覧へ戻る
                </Link>
              </div>
            </div>
          </article>
        )}
      </main>
    </>
  );
}
