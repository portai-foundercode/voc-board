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

export function validateCreateFeedback(_input: unknown): ValidationResult<CreateFeedbackInput> {
  throw new Error("Lesson 3 implementation is incomplete");
}

export function validateFeedbackStatus(_input: unknown): ValidationResult<FeedbackStatus> {
  throw new Error("Lesson 3 implementation is incomplete");
}
