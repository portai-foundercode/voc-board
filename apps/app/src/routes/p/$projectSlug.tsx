import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Navigation } from "../../components/navigation";
import { createFeedback } from "../../data/feedback-api";
import type { CreateFeedbackInput } from "../../domain/feedback";

export const Route = createFileRoute("/p/$projectSlug")({ component: PublicFeedbackForm });

function PublicFeedbackForm() {
  const { projectSlug } = Route.useParams();
  const [isComplete, setIsComplete] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof CreateFeedbackInput, string>>
  >({});
  const submissionController = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    submissionController.current?.abort();
    setIsComplete(false);
    setIsSubmitting(false);
    setFormError(undefined);
    setFieldErrors({});

    return () => submissionController.current?.abort();
  }, [projectSlug]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submissionController.current?.abort();
    const controller = new AbortController();
    submissionController.current = controller;
    const form = new FormData(event.currentTarget);
    const input: CreateFeedbackInput = {
      title: String(form.get("title") ?? ""),
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      body: String(form.get("body") ?? ""),
    };

    setIsSubmitting(true);
    setFormError(undefined);
    setFieldErrors({});

    try {
      await createFeedback(projectSlug, input, controller.signal);
      if (controller.signal.aborted) return;
      setIsComplete(true);
    } catch (error) {
      if (controller.signal.aborted) return;
      const apiError = error as { body?: unknown; status?: unknown };
      const body = apiError.body;
      const fields =
        typeof body === "object" && body !== null && "error" in body
          ? (body.error as { fields?: unknown }).fields
          : undefined;

      if (apiError.status === 400 && typeof fields === "object" && fields !== null) {
        const source = fields as Record<string, unknown>;
        setFieldErrors({
          title: typeof source.title === "string" ? source.title : undefined,
          name: typeof source.name === "string" ? source.name : undefined,
          email: typeof source.email === "string" ? source.email : undefined,
          body: typeof source.body === "string" ? source.body : undefined,
        });
      } else {
        setFormError("送信に失敗しました");
      }
    } finally {
      if (!controller.signal.aborted) setIsSubmitting(false);
      if (submissionController.current === controller) submissionController.current = undefined;
    }
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
          <section className="card">
            <form key={projectSlug} className="card-body gap-4" onSubmit={handleSubmit}>
              {formError ? (
                <div role="alert" className="alert alert-error">
                  <span>{formError}</span>
                </div>
              ) : null}
              <label className="fieldset">
                <span className="fieldset-legend">タイトル</span>
                <input className="input w-full" name="title" required type="text" />
                {fieldErrors.title ? (
                  <span className="label text-error">{fieldErrors.title}</span>
                ) : null}
              </label>
              <label className="fieldset">
                <span className="fieldset-legend">名前</span>
                <input className="input w-full" name="name" required type="text" />
                {fieldErrors.name ? (
                  <span className="label text-error">{fieldErrors.name}</span>
                ) : null}
              </label>
              <label className="fieldset">
                <span className="fieldset-legend">メール</span>
                <input className="input w-full" name="email" required type="email" />
                {fieldErrors.email ? (
                  <span className="label text-error">{fieldErrors.email}</span>
                ) : null}
              </label>
              <label className="fieldset">
                <span className="fieldset-legend">フィードバック</span>
                <textarea className="textarea min-h-32 w-full" name="body" required />
                {fieldErrors.body ? (
                  <span className="label text-error">{fieldErrors.body}</span>
                ) : null}
              </label>
              <div className="card-actions justify-end">
                <button className="btn" disabled={isSubmitting} type="submit">
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
