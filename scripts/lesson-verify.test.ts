import { describe, expect, it, vi } from "vitest";
import { getLesson, type Runner } from "./lib/lesson";
import { runLessonVerification } from "./lesson-verify";

const result = { status: 0, stdout: "", stderr: "" };

describe("lesson verification", () => {
  it("stops before quality commands when the safety preflight rejects the workspace", () => {
    const events: string[] = [];
    const runner = vi.fn<Runner>((command) => {
      events.push(command);
      return result;
    });
    const report = vi.fn();

    const status = runLessonVerification(getLesson("01"), {
      run: runner,
      resolveStartRef: () => {
        events.push("resolve start");
        return "checkpoint/01-start";
      },
      verifyLessonSafety: () => {
        events.push("safety");
        return ["unsafe change"];
      },
      report,
      announce: vi.fn(),
    });

    expect(status).toBe(1);
    expect(events).toEqual(["resolve start", "safety"]);
    expect(report).toHaveBeenCalledWith("NG: unsafe change");
  });

  it("uses the selected lesson allowlist and deletion policy and announces its completion", () => {
    const announce = vi.fn();
    const verify = vi.fn(() => []);

    const status = runLessonVerification(getLesson("02"), {
      run: vi.fn<Runner>().mockReturnValue(result),
      resolveStartRef: () => "checkpoint/02-start",
      verifyLessonSafety: verify,
      report: vi.fn(),
      announce,
    });

    expect(status).toBe(0);
    expect(verify).toHaveBeenCalledWith(
      "checkpoint/02-start",
      [
        "apps/app/src/routes/index.tsx",
        "apps/app/src/routes/p/$projectSlug.tsx",
        "apps/app/src/routes/app/feedback/index.tsx",
        "apps/app/src/routes/app/feedback/$feedbackId.tsx",
        "apps/app/src/routes/pricing.tsx",
        "apps/app/src/components/navigation.tsx",
        "apps/app/src/data/mock-feedback.ts",
        "apps/app/src/routeTree.gen.ts",
      ],
      [],
      [],
    );
    expect(announce).toHaveBeenLastCalledWith("OK: 第2回の完了条件を満たしています");
  });
});
