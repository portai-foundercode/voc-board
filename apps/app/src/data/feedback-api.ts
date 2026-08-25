import type { CreateFeedbackInput, Feedback, FeedbackStatus } from "../domain/feedback";

const incomplete = (): never => {
  throw new Error("Lesson 3 implementation is incomplete");
};

export async function createFeedback(
  _projectSlug: string,
  _input: CreateFeedbackInput,
  _signal?: AbortSignal,
): Promise<Feedback> {
  return incomplete();
}

export async function listFeedback(
  _projectSlug: string,
  _signal?: AbortSignal,
): Promise<Feedback[]> {
  return incomplete();
}

export async function getFeedback(
  _projectSlug: string,
  _feedbackId: string,
  _signal?: AbortSignal,
): Promise<Feedback> {
  return incomplete();
}

export async function updateFeedbackStatus(
  _projectSlug: string,
  _feedbackId: string,
  _status: FeedbackStatus,
  _signal?: AbortSignal,
): Promise<Feedback> {
  return incomplete();
}
