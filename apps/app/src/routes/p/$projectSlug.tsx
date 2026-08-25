import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { Navigation } from "../../components/navigation";

export const Route = createFileRoute("/p/$projectSlug")({ component: PublicFeedbackForm });

function PublicFeedbackForm() {
  const { projectSlug } = Route.useParams();
  const [isComplete, setIsComplete] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsComplete(true);
  };

  return (
    <>
      <Navigation />
      <main className="mx-auto max-w-2xl space-y-6 px-4 py-10 sm:px-8">
        <div className="space-y-2">
          <span className="badge">Visitor向け</span>
          <h1 className="text-3xl font-bold">フィードバックを送る</h1>
          <p className="text-base-content/70">
            {projectSlug} チームへのご意見やご要望をお聞かせください。
          </p>
        </div>

        {isComplete ? (
          <div role="alert" className="alert alert-success">
            <span>フィードバックを受け付けました</span>
          </div>
        ) : (
          <section className="card card-border">
            <form className="card-body gap-4" onSubmit={handleSubmit}>
              <label className="fieldset">
                <span className="fieldset-legend">名前</span>
                <input className="input w-full" name="name" required type="text" />
              </label>
              <label className="fieldset">
                <span className="fieldset-legend">メール</span>
                <input className="input w-full" name="email" required type="email" />
              </label>
              <label className="fieldset">
                <span className="fieldset-legend">フィードバック</span>
                <textarea className="textarea min-h-32 w-full" name="feedback" required />
              </label>
              <div className="card-actions justify-end">
                <button className="btn" type="submit">
                  送信する
                </button>
              </div>
            </form>
          </section>
        )}
      </main>
    </>
  );
}
