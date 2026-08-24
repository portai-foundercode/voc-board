import { describe, expect, it, vi } from "vitest";
import {
  getLesson,
  parseLessonId,
  run,
  resolveStartRef,
  type Runner,
  verifyLessonSafety,
} from "./lesson";

const result = (status = 0, stdout = "", stderr = "") => ({ status, stdout, stderr });

describe("lesson contract", () => {
  it("parses only lesson 01", () => {
    expect(parseLessonId(["01"])).toBe("01");
    expect(() => parseLessonId([])).toThrow("講義番号は 01");
  });

  it("defines the branches and commands", () => {
    expect(getLesson("01")).toMatchObject({
      startBranch: "checkpoint/01-start",
      completeBranch: "checkpoint/01-complete",
      verifyCommands: [
        { label: "型検査", command: "pnpm", args: ["typecheck"] },
        { label: "lint", command: "pnpm", args: ["lint"] },
        { label: "format検査", command: "pnpm", args: ["format:check"] },
        { label: "通常test", command: "pnpm", args: ["test"] },
        {
          label: "第1回の到達検証",
          command: "pnpm",
          args: ["--filter", "@voc-board/app", "test:lesson"],
        },
      ],
    });
  });

  it("prefers the local start ref and falls back to origin", () => {
    const local = vi.fn<Runner>().mockReturnValue(result());
    expect(resolveStartRef(getLesson("01"), local)).toBe("checkpoint/01-start");
    expect(local).toHaveBeenCalledTimes(1);

    const remote = vi.fn<Runner>().mockReturnValueOnce(result(1)).mockReturnValueOnce(result());
    expect(resolveStartRef(getLesson("01"), remote)).toBe("origin/checkpoint/01-start");
  });

  it("reports a Git failure while resolving the start ref", () => {
    const failed = vi.fn<Runner>().mockReturnValue(result(2, "", "fatal: not a repository"));
    expect(() => resolveStartRef(getLesson("01"), failed)).toThrow("fatal: not a repository");
  });

  it("reports a command that could not start", () => {
    const command = "voc-board-command-that-does-not-exist";
    const output = run(command, [], { capture: true });
    expect(output.status).not.toBe(0);
    expect(output.failedToStart).toBe(true);
    expect(output.stderr).toContain(command);
  });
});

function safetyRunner(
  options: {
    dependencyStatus?: number;
    dependencyError?: string;
    sourceStatus?: string;
    untracked?: string;
    ignored?: string;
    errors?: Record<string, string>;
  } = {},
): Runner {
  return (_command, args) => {
    const key = args.join(" ");
    const error = Object.entries(options.errors ?? {}).find(([match]) => key.includes(match));
    if (error) return result(2, "", error[1]);
    if (args.includes("--quiet")) {
      return result(options.dependencyStatus ?? 0, "", options.dependencyError ?? "");
    }
    if (args.includes("--name-status")) return result(0, options.sourceStatus ?? "");
    if (args.includes("--ignored")) return result(0, options.ignored ?? "");
    if (args.includes("--others")) return result(0, options.untracked ?? "");
    return result();
  };
}

describe("lesson safety", () => {
  it("rejects dependency changes", () => {
    expect(
      verifyLessonSafety(
        "checkpoint/01-start",
        safetyRunner({ sourceStatus: "M\0package.json\0" }),
      ),
    ).toContain("依存関係または検証ファイルが開始時点から変更されています");
  });

  it("rejects tracked changes to protected quality configuration", () => {
    expect(
      verifyLessonSafety(
        "checkpoint/01-start",
        safetyRunner({ sourceStatus: "M\0apps/app/vitest.config.ts\0" }),
      ),
    ).toContain("依存関係または検証ファイルが開始時点から変更されています");
  });

  it.each(["apps/app/test/escape.test.ts", "apps/app/vite.config.ts", "scripts/lesson-verify.ts"])(
    "rejects untracked protected additions: %s",
    (path) => {
      expect(
        verifyLessonSafety(
          "checkpoint/01-start",
          safetyRunner({ untracked: `${path}\0` }),
          () => "",
        ),
      ).toContain(`${path}: 保護されたファイル`);
    },
  );

  it("throws for a Git diff execution error", () => {
    expect(() =>
      verifyLessonSafety(
        "checkpoint/01-start",
        safetyRunner({ errors: { "diff --relative": "fatal: bad revision" } }),
      ),
    ).toThrow("fatal: bad revision");
  });

  it.each([
    ["ls-files --others --exclude-standard", "管理外ファイル"],
    ["ls-files --others --ignored", "ignored環境変数ファイル"],
  ])("throws for a Git list execution error: %s", (command, action) => {
    expect(() =>
      verifyLessonSafety(
        "checkpoint/01-start",
        safetyRunner({ errors: { [command]: "fatal: git failed" } }),
      ),
    ).toThrow(action);
  });

  it("asks Git for paths relative to the VoC Board workspace", () => {
    const runner = vi.fn<Runner>(safetyRunner());
    verifyLessonSafety("checkpoint/01-start", runner);
    expect(runner).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["diff", "--relative", "--name-status"]),
      { capture: true },
    );
  });

  it.each(['fetch("/api")', "process.env.KEY", "import.meta.env.KEY", "https://example.com"])(
    "rejects runtime integration: %s",
    (source) => {
      const path = "apps/app/src/routes/index.tsx";
      expect(
        verifyLessonSafety(
          "checkpoint/01-start",
          safetyRunner({ sourceStatus: `M\0${path}\0` }),
          () => source,
        ),
      ).not.toHaveLength(0);
    },
  );

  it("rejects a secret in the allowed tracked source", () => {
    const path = "apps/app/src/routes/index.tsx";
    expect(
      verifyLessonSafety(
        "checkpoint/01-start",
        safetyRunner({ sourceStatus: `M\0${path}\0` }),
        () => 'const API_KEY = "abcdefgh";',
      ),
    ).toContain(`${path}: 秘密情報の可能性`);
  });

  it.each([
    ["D\0apps/app/src/routes/index.tsx\0", "削除または名前変更"],
    [
      "R100\0apps/app/src/routes/index.tsx\0apps/app/src/routes/renamed.tsx\0",
      "削除または名前変更",
    ],
  ])("rejects deleted or renamed source", (sourceStatus, message) => {
    expect(
      verifyLessonSafety("checkpoint/01-start", safetyRunner({ sourceStatus }), () => {
        throw new Error("deleted source must not be read");
      }),
    ).toEqual([expect.stringContaining(message)]);
  });

  it("describes a deleted non-source file without calling it source", () => {
    expect(
      verifyLessonSafety("checkpoint/01-start", safetyRunner({ sourceStatus: "D\0README.md\0" })),
    ).toContain("README.md: ファイルの削除または名前変更は許可されていません");
  });

  it("rejects secrets in untracked files", () => {
    const runner = safetyRunner({ untracked: ".env.local\0" });
    expect(
      verifyLessonSafety("checkpoint/01-start", runner, () => "API_KEY=abcdefgh"),
    ).not.toHaveLength(0);
  });

  it.each([".env.local", ".dev.vars.local", "apps/app/.env.local", "apps/app/.dev.vars.local"])(
    "rejects secrets in ignored environment files: %s",
    (path) => {
      expect(
        verifyLessonSafety(
          "checkpoint/01-start",
          safetyRunner({ ignored: `${path}\0` }),
          () => "API_KEY=abcdefgh",
        ),
      ).toContain(`${path}: 秘密情報の可能性`);
    },
  );

  it("rejects a secret in an ignored local config file", () => {
    const path = "apps/app/settings.local";
    const runner: Runner = (_command, args) => {
      if (args.includes("--name-status")) return result();
      if (args.includes("--ignored")) {
        return result(0, args.includes("apps/app/*.local") ? `${path}\0` : "");
      }
      return result();
    };

    expect(verifyLessonSafety("checkpoint/01-start", runner, () => "TOKEN=abcdefgh")).toContain(
      `${path}: 秘密情報の可能性`,
    );
  });

  it("accepts the requested UI-only change", () => {
    const path = "apps/app/src/routes/index.tsx";
    expect(
      verifyLessonSafety(
        "checkpoint/01-start",
        safetyRunner({ sourceStatus: `M\0${path}\0` }),
        () => '<main className="hero"><h1>次の一手</h1></main>',
      ),
    ).toEqual([]);
  });
});
