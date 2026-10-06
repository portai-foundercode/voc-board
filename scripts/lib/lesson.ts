import { spawnSync } from "node:child_process";

export const lessonIds = ["01", "02", "03"] as const;
export type LessonId = (typeof lessonIds)[number];

const qualityChecks = [
  { label: "型検査", command: "pnpm", args: ["typecheck"] },
  { label: "lint", command: "pnpm", args: ["lint"] },
  { label: "format検査", command: "pnpm", args: ["format:check"] },
  { label: "通常test", command: "pnpm", args: ["test"] },
] as const;

const e2eCheck = (id: LessonId) => ({
  label: `第${Number(id)}回のE2E`,
  command: "pnpm",
  args: ["exec", "playwright", "test", `e2e/lesson-${id}.spec.ts`],
});

const databaseChecks = [
  { label: "build", command: "pnpm", args: ["build"] },
  { label: "DBリセット", command: "pnpm", args: ["--filter", "@voc-board/app", "db:reset"] },
] as const;

export const lessons = {
  "01": { id: "01", verifyCommands: [...qualityChecks, e2eCheck("01")] },
  "02": { id: "02", verifyCommands: [...qualityChecks, e2eCheck("02")] },
  "03": { id: "03", verifyCommands: [...qualityChecks, ...databaseChecks, e2eCheck("03")] },
} as const;

export type RunResult = {
  status: number;
  stdout: string;
  stderr: string;
  failedToStart?: boolean;
};
export type Runner = (
  command: string,
  args: readonly string[],
  options?: { capture?: boolean },
) => RunResult;

export const run: Runner = (command, args, options = {}) => {
  const result = spawnSync(command, [...args], {
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
    failedToStart: result.error !== undefined,
  };
};

export function parseLessonId(argv: readonly string[]) {
  const id = lessonIds.find((lessonId) => lessonId === argv[0]);
  if (argv.length !== 1 || !id) {
    throw new Error(
      "講義番号は 01、02、03 のいずれかを1つ指定してください（例: pnpm lesson:verify 01）",
    );
  }
  return id;
}

export function getLesson(id: LessonId) {
  return lessons[id];
}
