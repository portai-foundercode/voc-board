import type { CreateFeedbackInput, Feedback, FeedbackStatus } from "../domain/feedback";

type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
    fields?: Record<string, string>;
  };
};

class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | undefined;

  constructor(status: number, body: ApiErrorBody | undefined) {
    super(body?.error?.message ?? `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseFeedback(value: unknown): Feedback | undefined {
  if (!isRecord(value)) return undefined;
  const status = value.status;
  if (status !== "new" && status !== "reviewing" && status !== "planned") return undefined;
  for (const field of [
    "id",
    "projectId",
    "title",
    "name",
    "email",
    "body",
    "createdAt",
    "updatedAt",
  ] as const) {
    if (typeof value[field] !== "string") return undefined;
  }
  return value as Feedback;
}

const invalidResponse = (): never => {
  throw new Error("Invalid API response");
};

async function parseResponse<T>(
  response: Response,
  parseSuccess: (body: unknown) => T | undefined,
): Promise<T> {
  const body: unknown = await response.json().catch(() => undefined);

  if (!response.ok) throw new ApiError(response.status, body as ApiErrorBody | undefined);
  return parseSuccess(body) ?? invalidResponse();
}

const parseFeedbackEnvelope = (body: unknown) =>
  isRecord(body) ? parseFeedback(body.feedback) : undefined;

const parseFeedbackListEnvelope = (body: unknown) => {
  if (!isRecord(body) || !Array.isArray(body.feedback)) return undefined;
  const feedback = body.feedback.map(parseFeedback);
  return feedback.every((item): item is Feedback => item !== undefined) ? feedback : undefined;
};

export async function createFeedback(
  projectSlug: string,
  input: CreateFeedbackInput,
  signal?: AbortSignal,
): Promise<Feedback> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  return await parseResponse(response, parseFeedbackEnvelope);
}

export async function listFeedback(projectSlug: string, signal?: AbortSignal): Promise<Feedback[]> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/feedback`, {
    signal,
  });
  return await parseResponse(response, parseFeedbackListEnvelope);
}

export async function getFeedback(
  projectSlug: string,
  feedbackId: string,
  signal?: AbortSignal,
): Promise<Feedback> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectSlug)}/feedback/${encodeURIComponent(feedbackId)}`,
    { signal },
  );
  return await parseResponse(response, parseFeedbackEnvelope);
}

export async function updateFeedbackStatus(
  projectSlug: string,
  feedbackId: string,
  status: FeedbackStatus,
  signal?: AbortSignal,
): Promise<Feedback> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectSlug)}/feedback/${encodeURIComponent(feedbackId)}/status`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
      signal,
    },
  );
  return await parseResponse(response, parseFeedbackEnvelope);
}
