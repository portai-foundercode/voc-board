import { describe, expect, it, vi } from "vitest";
import { getLesson, type Runner } from "./lib/lesson";
import { runLessonVerification } from "./lesson-verify";

const ok = { status: 0, stdout: "", stderr: "" };

describe("lesson verification", () => {
  it("stops at the first failing check", () => {
    const runner = vi.fn<Runner>((_command, args) =>
      args[0] === "lint" ? { ...ok, status: 2 } : ok,
    );
    const report = vi.fn();

    const status = runLessonVerification(getLesson("01"), {
      run: runner,
      report,
      announce: vi.fn(),
    });

    expect(status).toBe(2);
    expect(runner).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledWith("NG: lint");
  });

  it("runs only the lesson e2e spec after the quality checks", () => {
    const runner = vi.fn<Runner>().mockReturnValue(ok);
    const announce = vi.fn();

    const status = runLessonVerification(getLesson("02"), {
      run: runner,
      report: vi.fn(),
      announce,
    });

    expect(status).toBe(0);
    expect(runner).toHaveBeenLastCalledWith("pnpm", [
      "exec",
      "playwright",
      "test",
      "e2e/lesson-02.spec.ts",
    ]);
    expect(announce).toHaveBeenLastCalledWith("OK: 第2回の完了条件を満たしています");
  });

  it("builds and resets the database only for lesson 03", () => {
    const args = (id: "01" | "03") =>
      getLesson(id).verifyCommands.map((check) => check.args.join(" "));

    expect(args("01")).not.toContain("build");
    expect(args("03")).toEqual(
      expect.arrayContaining(["build", "--filter @voc-board/app db:reset"]),
    );
  });

  it("checks .dev.vars first and then runs gate, build, db:reset and the e2e for lesson 04", () => {
    const args = getLesson("04").verifyCommands.map((check) => check.args.join(" "));

    expect(args[0]).toBe("exec tsx scripts/check-dev-vars.ts");
    expect(args.slice(1)).toEqual([
      "typecheck",
      "lint",
      "format:check",
      "test",
      "build",
      "--filter @voc-board/app db:reset",
      "exec playwright test e2e/lesson-04.spec.ts",
    ]);
  });
});
