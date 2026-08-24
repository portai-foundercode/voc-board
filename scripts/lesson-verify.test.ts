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
});
