export type FeedbackStatus = "new" | "reviewing" | "planned";

export type CreateFeedbackInput = {
  title: string;
  name: string;
  email: string;
  body: string;
};

export type Feedback = CreateFeedbackInput & {
  id: string;
  projectId: string;
  status: FeedbackStatus;
  createdAt: string;
  updatedAt: string;
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      fields: Partial<Record<keyof CreateFeedbackInput | "status", string>>;
    };

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateCreateFeedback(input: unknown): ValidationResult<CreateFeedbackInput> {
  const source =
    typeof input === "object" && input !== null && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const value = {
    title: typeof source.title === "string" ? source.title.trim() : "",
    name: typeof source.name === "string" ? source.name.trim() : "",
    email: typeof source.email === "string" ? source.email.trim() : "",
    body: typeof source.body === "string" ? source.body.trim() : "",
  };
  const fields: Partial<Record<keyof CreateFeedbackInput, string>> = {};

  if (!value.title) fields.title = "Title is required.";
  else if (value.title.length > 100) fields.title = "Title must be 100 characters or fewer.";

  if (!value.name) fields.name = "Name is required.";
  else if (value.name.length > 80) fields.name = "Name must be 80 characters or fewer.";

  if (!value.email) fields.email = "Email is required.";
  else if (value.email.length > 254) fields.email = "Email must be 254 characters or fewer.";
  else if (!emailPattern.test(value.email)) fields.email = "Enter a valid email address.";

  if (!value.body) fields.body = "Feedback is required.";
  else if (value.body.length > 2_000) {
    fields.body = "Feedback must be 2,000 characters or fewer.";
  }

  return Object.keys(fields).length > 0 ? { ok: false, fields } : { ok: true, value };
}

export function validateFeedbackStatus(input: unknown): ValidationResult<FeedbackStatus> {
  if (input === "new" || input === "reviewing" || input === "planned") {
    return { ok: true, value: input };
  }

  return {
    ok: false,
    fields: { status: "Status must be new, reviewing, or planned." },
  };
}
